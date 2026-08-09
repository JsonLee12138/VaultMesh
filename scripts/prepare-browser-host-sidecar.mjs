import { spawn } from "node:child_process";
import { chmod, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

import {
  browserIdentityEnvironment,
} from "./browser-identity.mjs";

const workspace = path.resolve(import.meta.dirname, "..");

export function parseArguments(arguments_) {
  let target;
  for (let index = 0; index < arguments_.length; index += 1) {
    if (arguments_[index] !== "--target" || !arguments_[index + 1] || target) {
      throw new Error("用法：prepare-browser-host-sidecar.mjs [--target <Rust target triple>]");
    }
    target = arguments_[index + 1];
    index += 1;
  }
  return { target };
}

export function browserHostSidecarPaths(target, platform = process.platform) {
  if (!/^[A-Za-z0-9_.-]+$/.test(target) || target.includes("..")) {
    throw new Error("Rust target triple 无效。");
  }
  const extension = platform === "win32" || target.includes("windows") ? ".exe" : "";
  return {
    built: path.join(workspace, "target", target, "release", `vaultmesh-native-host${extension}`),
    bundled: path.join(
      workspace,
      "apps",
      "tauri-desktop",
      "src-tauri",
      "binaries",
      `vaultmesh-native-host-${target}${extension}`,
    ),
  };
}

export function browserHostBuildIdentity(environment = process.env) {
  const identityEnvironment = browserIdentityEnvironment(environment);
  const extensionId = identityEnvironment.VAULTMESH_BROWSER_EXTENSION_ID;
  if (!/^[a-p]{32}$/.test(extensionId)) {
    throw new Error("VAULTMESH_BROWSER_EXTENSION_ID 必须是 32 位 Chrome 扩展 ID。");
  }
  return extensionId;
}

export async function prepareBrowserHostSidecar({ target, environment = process.env } = {}) {
  const resolvedTarget = target ?? (await capture("rustc", ["--print", "host-tuple"])).trim();
  const extensionId = browserHostBuildIdentity(environment);
  const paths = browserHostSidecarPaths(resolvedTarget);
  await run("cargo", [
    "build",
    "--release",
    "--target",
    resolvedTarget,
    "-p",
    "vaultmesh-tauri-desktop",
    "--bin",
    "vaultmesh-native-host",
  ], {
    ...environment,
    VAULTMESH_BROWSER_EXTENSION_ID: extensionId,
  });
  await mkdir(path.dirname(paths.bundled), { recursive: true });
  await copyFile(paths.built, paths.bundled);
  if (!paths.bundled.endsWith(".exe")) await chmod(paths.bundled, 0o755);
  return { target: resolvedTarget, extensionId, ...paths };
}

function run(command, arguments_, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: workspace,
      env: environment,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${signal ? `被 ${signal} 终止` : `退出码 ${code ?? 1}`}`));
    });
  });
}

function capture(command, arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: workspace,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(Buffer.concat(stdout).toString("utf8"));
      else reject(new Error(Buffer.concat(stderr).toString("utf8") || `${command} 退出码 ${code ?? 1}`));
    });
  });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const result = await prepareBrowserHostSidecar(parseArguments(process.argv.slice(2)));
    console.log(`Browser Native Host sidecar 已准备：${result.bundled}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
