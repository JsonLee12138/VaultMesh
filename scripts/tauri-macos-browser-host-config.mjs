import path from "node:path";

export const tauriHostName = "com.vaultmesh.browser";
export const tauriPairingService = "com.vaultmesh.desktop.browser-pairing";
export const tauriPairingAccount = "native-host-hmac-v1";

export function tauriMacOSBrowserHostPlan({
  userHome,
  temporaryDirectory,
  nativeHostPath,
  extensionId,
  browserProfile,
}) {
  if (!/^[a-p]{32}$/.test(extensionId)) {
    throw new Error("VAULTMESH_BROWSER_EXTENSION_ID 必须是 32 位 Chrome 扩展 ID。");
  }
  if (!path.isAbsolute(nativeHostPath)) {
    throw new Error("Tauri Native Host 必须使用绝对路径。");
  }
  const integrationRoot = path.join(
    userHome, "Library", "Application Support", "com.vaultmesh.desktop",
  );
  const configPath = path.join(integrationRoot, "browser-host-config.json");
  const brokerSocket = path.join(temporaryDirectory, "vaultmesh-tauri-browser.sock");
  if (Buffer.byteLength(brokerSocket, "utf8") > 103) {
    throw new Error("Tauri broker socket 超过 macOS 路径上限。");
  }
  const manifestDirectories = new Set([
    path.join(userHome, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts"),
    path.join(userHome, "Library", "Application Support", "Microsoft Edge", "NativeMessagingHosts"),
    ...(browserProfile ? [path.join(browserProfile, "NativeMessagingHosts")] : []),
  ]);
  const allowedOrigin = `chrome-extension://${extensionId}/`;
  const config = JSON.stringify({
    version: 1,
    brokerSocket,
    keychainService: tauriPairingService,
    keychainAccount: tauriPairingAccount,
    allowedOrigin,
  });
  const manifest = JSON.stringify({
    name: tauriHostName,
    description: "VaultMesh Tauri protocol v2 native messaging host",
    path: nativeHostPath,
    type: "stdio",
    allowed_origins: [allowedOrigin],
  });
  return {
    integrationRoot,
    configPath,
    brokerSocket,
    nativeHostPath,
    manifestDirectories,
    config,
    manifest,
  };
}
