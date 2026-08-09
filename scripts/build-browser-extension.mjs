import { spawn } from "node:child_process";
import path from "node:path";

import {
  browserIdentityEnvironment,
} from "./browser-identity.mjs";

const workspace = path.resolve(import.meta.dirname, "..");
const allowedCommands = new Set(["build", "zip"]);

export function browserExtensionBuildEnvironment(baseEnvironment = process.env, options = {}) {
  const identityEnvironment = browserIdentityEnvironment(baseEnvironment, options);
  const hostName = baseEnvironment.WXT_NATIVE_HOST_NAME ?? "com.vaultmesh.browser";
  if (hostName !== "com.vaultmesh.browser") {
    throw new Error("WXT_NATIVE_HOST_NAME 必须为 com.vaultmesh.browser。");
  }
  return {
    ...identityEnvironment,
    WXT_NATIVE_HOST_NAME: hostName,
  };
}

export function browserExtensionBuildInvocation(command, platform = process.platform, environment = process.env) {
  const pnpmArguments = ["--filter", "@vaultmesh/browser-extension", command];
  if (platform !== "win32") {
    return { command: "pnpm", arguments: pnpmArguments };
  }
  return {
    command: environment.ComSpec ?? environment.COMSPEC ?? "cmd.exe",
    arguments: ["/d", "/s", "/c", "pnpm.cmd", ...pnpmArguments],
  };
}

export async function buildBrowserExtension(command, baseEnvironment = process.env, options = {}) {
  if (!allowedCommands.has(command)) {
    throw new Error("用法：build-browser-extension.mjs <build|zip>");
  }
  const environment = browserExtensionBuildEnvironment(baseEnvironment, options);
  const invocation = browserExtensionBuildInvocation(command, process.platform, environment);
  await new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.arguments, {
      cwd: workspace,
      env: environment,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${invocation.command} ${signal ? `被 ${signal} 终止` : `退出码 ${code ?? 1}`}`));
    });
  });
  return environment.VAULTMESH_BROWSER_EXTENSION_ID;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const extraArguments = process.argv.slice(3);
    if (extraArguments.some((argument) => argument !== "--release-identity")) {
      throw new Error("用法：build-browser-extension.mjs <build|zip> [--release-identity]");
    }
    const extensionId = await buildBrowserExtension(process.argv[2], process.env, {
      requireRelease: extraArguments.includes("--release-identity"),
    });
    console.log(`Browser extension 已使用固定 ID 构建：${extensionId}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
