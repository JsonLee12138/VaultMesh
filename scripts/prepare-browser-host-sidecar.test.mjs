import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { developmentExtensionId, developmentExtensionKey, firefoxExtensionId } from "./browser-identity.mjs";
import {
  browserHostBuildIdentity,
  browserHostSidecarPaths,
  parseArguments,
} from "./prepare-browser-host-sidecar.mjs";

test("Browser Host sidecar target parsing rejects ambiguous or path-like values", () => {
  assert.deepEqual(parseArguments([]), { target: undefined });
  assert.deepEqual(parseArguments(["--target", "x86_64-pc-windows-msvc"]), {
    target: "x86_64-pc-windows-msvc",
  });
  assert.throws(() => parseArguments(["--target"]));
  assert.throws(() => parseArguments(["--target", "one", "--target", "two"]));
  assert.throws(() => browserHostSidecarPaths("../escape"));
});

test("Browser Host sidecar follows Tauri target-triple naming on macOS and Windows", () => {
  const mac = browserHostSidecarPaths("aarch64-apple-darwin", "darwin");
  assert.match(mac.built, /target\/aarch64-apple-darwin\/release\/vaultmesh-native-host$/);
  assert.match(mac.bundled, /binaries\/vaultmesh-native-host-aarch64-apple-darwin$/);

  const windows = browserHostSidecarPaths("x86_64-pc-windows-msvc", "win32");
  assert.match(windows.built, /target\/x86_64-pc-windows-msvc\/release\/vaultmesh-native-host\.exe$/);
  assert.match(windows.bundled, /binaries\/vaultmesh-native-host-x86_64-pc-windows-msvc\.exe$/);
});

test("Browser Host build identity defaults consistently and rejects key mismatches", () => {
  assert.deepEqual(browserHostBuildIdentity({}), {
    chromeExtensionId: developmentExtensionId,
    firefoxExtensionId,
  });
  assert.deepEqual(browserHostBuildIdentity({
    WXT_CHROME_EXTENSION_KEY: developmentExtensionKey,
    VAULTMESH_BROWSER_EXTENSION_ID: developmentExtensionId,
  }), { chromeExtensionId: developmentExtensionId, firefoxExtensionId });
  assert.throws(() => browserHostBuildIdentity({
    WXT_CHROME_EXTENSION_KEY: developmentExtensionKey,
    VAULTMESH_BROWSER_EXTENSION_ID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  }), /manifest key 不匹配/);
  assert.throws(() => browserHostBuildIdentity({
    VAULTMESH_BROWSER_EXTENSION_ID: "invalid",
  }), /32 位 Chrome 扩展 ID/);
  const releaseKey = Buffer.from("vaultmesh-test-release-public-key").toString("base64");
  assert.notEqual(browserHostBuildIdentity({
    WXT_CHROME_EXTENSION_KEY: releaseKey,
  }).chromeExtensionId, developmentExtensionId);
});

test("CT-UPDATE-001 Windows installers register and remove the fixed Host while NSIS also stops it", async () => {
  const [configSource, nsisHooks, wixFragment] = await Promise.all([
    readFile(new URL(
      "../apps/tauri-desktop/src-tauri/tauri.conf.json",
      import.meta.url,
    ), "utf8"),
    readFile(new URL(
      "../apps/tauri-desktop/src-tauri/windows/browser-host-hooks.nsh",
      import.meta.url,
    ), "utf8"),
    readFile(new URL(
      "../apps/tauri-desktop/src-tauri/windows/browser-host.wxs",
      import.meta.url,
    ), "utf8"),
  ]);
  const config = JSON.parse(configSource);
  assert.equal(config.bundle.windows.wix.upgradeCode, "54591767-50d9-5adc-879b-58465ad2719e");
  assert.equal(config.bundle.windows.nsis.installMode, "currentUser");
  assert.equal(
    config.bundle.windows.nsis.installerHooks,
    "./windows/browser-host-hooks.nsh",
  );
  assert.deepEqual(config.bundle.windows.wix.fragmentPaths, ["./windows/browser-host.wxs"]);
  assert.deepEqual(config.bundle.windows.wix.componentRefs, [
    "BrowserNativeMessagingRegistration",
  ]);
  for (const source of [nsisHooks, wixFragment]) {
    assert.match(source, /Google\\Chrome\\NativeMessagingHosts\\com\.vaultmesh\.browser/);
    assert.match(source, /Microsoft\\Edge\\NativeMessagingHosts\\com\.vaultmesh\.browser/);
    assert.match(source, /Mozilla\\NativeMessagingHosts\\com\.vaultmesh\.browser/);
    assert.match(source, /com\.vaultmesh\.browser\.json/);
  }
  assert.match(nsisHooks, /!macro NSIS_HOOK_PREINSTALL/);
  assert.match(nsisHooks, /!insertmacro VAULTMESH_UNREGISTER_BROWSER_HOST/);
  assert.match(nsisHooks, /!insertmacro VAULTMESH_STOP_NATIVE_HOST/);
  assert.match(nsisHooks, /taskkill\.exe" \/F \/IM "vaultmesh-native-host\.exe"/);
  assert.equal(
    [...nsisHooks.matchAll(/!insertmacro VAULTMESH_STOP_NATIVE_HOST/g)].length,
    2,
    "NSIS must stop the Browser Host before both install and uninstall file changes",
  );
  assert.ok(
    nsisHooks.indexOf("!insertmacro VAULTMESH_UNREGISTER_BROWSER_HOST")
      < nsisHooks.indexOf("!insertmacro VAULTMESH_STOP_NATIVE_HOST"),
    "NSIS must unregister the Browser Host before terminating it to prevent reconnect races",
  );
  assert.match(nsisHooks, /DeleteRegKey HKCU/);
  assert.match(wixFragment, /createAndRemoveOnUninstall/);
  assert.match(wixFragment, /<DirectoryRef Id="TARGETDIR">\s*<Directory Id="AppDataFolder">/);
  assert.doesNotMatch(wixFragment, /<DirectoryRef Id="AppDataFolder">/);
  assert.match(wixFragment, /RemoveBrowserHostManifest/);
  assert.match(wixFragment, /RemoveFirefoxBrowserHostManifest/);
  assert.match(wixFragment, /RemoveBrowserHostConfig/);
});
