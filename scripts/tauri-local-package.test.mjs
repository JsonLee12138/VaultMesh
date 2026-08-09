import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const script = await readFile(new URL("./tauri-local-package.mjs", import.meta.url), "utf8");

test("local package asks Tauri for the app bundle only", () => {
  assert.match(
    script,
    /"tauri", "build", "--bundles", "app",\s+"--config", "src-tauri\/tauri\.agent\.conf\.json"/,
    "local packaging must finish the signed app before creating its verified DMG",
  );
});

test("local package prepares the Browser Host sidecar before Tauri bundles the app", () => {
  const prepare = script.indexOf('"prepare-browser-host-sidecar.mjs"');
  const bundle = script.indexOf('"tauri", "build", "--bundles", "app"');
  const host = script.indexOf('const builtHost = path.join(workspace, "target", agentTarget, "release", "vaultmesh-native-host");');
  assert.ok(prepare >= 0);
  assert.ok(host > prepare);
  assert.ok(bundle > host);
});

test("local package bundles the non-secret Agent MCP shim before signing", () => {
  const build = script.indexOf('"prepare-agent-sidecar.mjs"');
  const bundled = script.indexOf('await access(path.join(packagedApp, "Contents", "MacOS", "vaultmesh-agent-mcp"));');
  const sign = script.indexOf('await run("codesign", ["--force", "--deep", "--sign", "-", packagedApp]);');
  assert.ok(build >= 0);
  assert.ok(bundled > build);
  assert.ok(sign > bundled);
  assert.match(
    script,
    /const builtAgentMcp = path\.join\(workspace, "target", agentTarget, "release", "vaultmesh-agent-mcp"\);/,
    "the sidecar verification path must be defined for the host target",
  );
});

test("local package verifies artifacts before replacing the installed app", () => {
  const verifyDmg = script.indexOf('await run("hdiutil", ["verify", localDmg]);');
  const verifyZip = script.indexOf('await run("unzip", ["-tq", extensionZip]);');
  const moveInstalledApp = script.indexOf("await rename(installedTauriApp, backupApp);");

  assert.ok(verifyDmg >= 0);
  assert.ok(verifyZip > verifyDmg);
  assert.ok(moveInstalledApp > verifyZip);
});

test("local package cleans up a failed first-time installation", () => {
  assert.match(script, /installAttempted = true;\s+await run\("ditto", \[packagedApp, installedTauriApp\]\);/);
  assert.match(script, /if \(installAttempted \|\| movedExistingApp\)/);
  assert.match(script, /await rm\(installedTauriApp, \{ recursive: true, force: true \}\)/);
});
