import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { developmentExtensionId } from "./browser-identity.mjs";
import { tauriHostName, tauriMacOSBrowserHostPlan } from "./tauri-macos-browser-host-config.mjs";

const extensionId = process.env.VAULTMESH_BROWSER_EXTENSION_ID ?? developmentExtensionId;
const nativeHostPath = process.env.VAULTMESH_TAURI_NATIVE_HOST
  ?? "/Applications/VaultMesh.app/Contents/MacOS/vaultmesh-native-host";
const plan = tauriMacOSBrowserHostPlan({
  userHome: homedir(),
  temporaryDirectory: tmpdir(),
  nativeHostPath,
  extensionId,
  browserProfile: process.env.VAULTMESH_BROWSER_PROFILE,
});

if (process.argv.includes("--uninstall")) {
  for (const directory of plan.manifestDirectories) {
    const manifestPath = path.join(directory, `${tauriHostName}.json`);
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      if (manifest.name === tauriHostName && manifest.path === plan.nativeHostPath) {
        await rm(manifestPath);
      }
    } catch {}
  }
  try {
    const config = JSON.parse(await readFile(plan.configPath, "utf8"));
    if (config.version === 1 && config.brokerSocket === plan.brokerSocket) {
      await rm(plan.configPath);
    }
  } catch {}
  console.log("已移除 VaultMesh Tauri 本机浏览器注册；应用和保险库均保留。");
  process.exit(0);
}

const hostMetadata = await stat(plan.nativeHostPath);
if (!hostMetadata.isFile() || (hostMetadata.mode & 0o111) === 0) {
  throw new Error(`Tauri Native Host 不可执行：${plan.nativeHostPath}`);
}
await mkdir(plan.integrationRoot, { recursive: true, mode: 0o700 });
await chmod(plan.integrationRoot, 0o700);
await writeFile(plan.configPath, plan.config, { mode: 0o600 });
await chmod(plan.configPath, 0o600);
for (const directory of plan.manifestDirectories) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const manifestPath = path.join(directory, `${tauriHostName}.json`);
  await writeFile(manifestPath, plan.manifest, { mode: 0o600 });
  await chmod(manifestPath, 0o600);
}
console.log(`已安装 Tauri Rust browser host；扩展 ID：${extensionId}`);
