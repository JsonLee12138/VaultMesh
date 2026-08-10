import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { verifyBrowserHost, verifyFirefoxBrowserHost } from "./tauri-browser-host-probe.mjs";

const HOST_NAME = "com.vaultmesh.browser";
const registryKeys = {
  Chrome: `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
  Edge: `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`,
  Firefox: `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${HOST_NAME}`,
};

export function parseRegistryDefaultValue(output) {
  const match = output.match(/^\s*(?:\(Default\)|<NO NAME>|\(默认\))\s+REG_SZ\s+(.+)$/imu)
    ?? output.match(/^\s*REG_SZ\s+(.+)$/imu);
  const value = match?.[1]?.trim();
  if (!value || !path.win32.isAbsolute(value)) {
    throw new Error("Native Messaging 注册表默认值无效。");
  }
  return path.win32.normalize(value);
}

export function validateInstalledManifest(manifest, manifestPath) {
  if (!manifest || typeof manifest !== "object"
    || manifest.name !== HOST_NAME
    || manifest.type !== "stdio"
    || typeof manifest.path !== "string"
    || !path.win32.isAbsolute(manifest.path)
    || !Array.isArray(manifest.allowed_origins)
    || manifest.allowed_origins.length !== 1) {
    throw new Error(`Native Messaging manifest 无效：${manifestPath}`);
  }
  const origin = manifest.allowed_origins[0];
  const match = typeof origin === "string"
    ? origin.match(/^chrome-extension:\/\/([a-p]{32})\/$/)
    : null;
  if (!match) throw new Error("Native Messaging manifest 没有固定扩展 origin。");
  return { nativeHostPath: path.win32.normalize(manifest.path), extensionId: match[1] };
}

export function validateInstalledFirefoxManifest(manifest, manifestPath) {
  if (!manifest || typeof manifest !== "object"
    || manifest.name !== HOST_NAME
    || manifest.type !== "stdio"
    || typeof manifest.path !== "string"
    || !path.win32.isAbsolute(manifest.path)
    || !Array.isArray(manifest.allowed_extensions)
    || manifest.allowed_extensions.length !== 1
    || manifest.allowed_extensions[0] !== "vaultmesh@atlantis-mk.github.io") {
    throw new Error(`Firefox Native Messaging manifest 无效：${manifestPath}`);
  }
  return {
    nativeHostPath: path.win32.normalize(manifest.path),
    extensionId: manifest.allowed_extensions[0],
  };
}

export async function runWindowsBrowserHostAt({ uninstallCheck = false } = {}) {
  if (process.platform !== "win32") {
    throw new Error("该 AT 必须在目标 Windows 系统执行。");
  }
  const appData = process.env.APPDATA;
  if (!appData || !path.win32.isAbsolute(appData)) {
    throw new Error("APPDATA 不可用。");
  }
  const expectedManifest = path.win32.join(appData, "com.vaultmesh.desktop", `${HOST_NAME}.json`);
  const expectedFirefoxManifest = path.win32.join(appData, "com.vaultmesh.desktop", `${HOST_NAME}.firefox.json`);
  const expectedConfig = path.win32.join(appData, "com.vaultmesh.desktop", "browser-host-config.json");
  if (uninstallCheck) {
    for (const key of Object.values(registryKeys)) {
      if (await registryValueIfPresent(key)) {
        throw new Error(`卸载后仍残留 Native Messaging 注册：${key}`);
      }
    }
    for (const file of [expectedManifest, expectedFirefoxManifest, expectedConfig]) {
      if (await exists(file)) throw new Error(`卸载后仍残留 Browser Host 文件：${file}`);
    }
    return { status: "uninstall-clean" };
  }

  const registrations = Object.fromEntries(await Promise.all(
    Object.entries(registryKeys).map(async ([browser, key]) => [browser, await readRegistryValue(key)]),
  ));
  if (path.win32.normalize(registrations.Chrome) !== expectedManifest
    || path.win32.normalize(registrations.Edge) !== expectedManifest
    || path.win32.normalize(registrations.Firefox) !== expectedFirefoxManifest) {
    throw new Error("Chrome/Edge Native Messaging 注册未指向同一个当前用户 manifest。");
  }
  const manifest = JSON.parse(await readFile(expectedManifest, "utf8"));
  const { nativeHostPath, extensionId } = validateInstalledManifest(manifest, expectedManifest);
  const firefoxManifest = JSON.parse(await readFile(expectedFirefoxManifest, "utf8"));
  const firefox = validateInstalledFirefoxManifest(firefoxManifest, expectedFirefoxManifest);
  if (firefox.nativeHostPath !== nativeHostPath) throw new Error("Chrome 与 Firefox manifest 未指向同一 Host。");
  await Promise.all([access(nativeHostPath), access(expectedConfig)]);
  await verifyBrowserHost({ nativeHostPath, extensionId });
  await verifyFirefoxBrowserHost({ nativeHostPath, manifestPath: expectedFirefoxManifest, extensionId: firefox.extensionId });
  return {
    status: "pass",
    extensionId,
    manifestPath: expectedManifest,
    nativeHostPath,
    browsers: ["Chrome", "Edge", "Firefox"],
  };
}

async function readRegistryValue(key) {
  const result = await run("reg.exe", ["query", key, "/ve"]);
  if (result.code !== 0) throw new Error(`缺少 Native Messaging 注册：${key}`);
  return parseRegistryDefaultValue(result.stdout);
}

async function registryValueIfPresent(key) {
  const result = await run("reg.exe", ["query", key, "/ve"]);
  return result.code === 0 ? parseRegistryDefaultValue(result.stdout) : null;
}

function run(command, arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("exit", (code) => resolve({
      code: code ?? 1,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    }));
  });
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const result = await runWindowsBrowserHostAt({
      uninstallCheck: process.argv.includes("--uninstall-check"),
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
