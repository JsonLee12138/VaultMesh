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
  assert.ok(prepare >= 0);
  assert.ok(bundle > prepare);
});

test("CT-BROWSER-PACKAGE-001: local package verifies Tauri-bundled sidecars before signing without patching them", () => {
  const prepare = script.indexOf('"prepare-agent-sidecar.mjs"');
  const bundle = script.indexOf('"tauri", "build", "--bundles", "app"');
  const verify = script.indexOf('await verifyPackagedMacOSSidecars(packagedApp);');
  const sign = script.indexOf('await run("codesign", ["--force", "--deep", "--sign", "-", packagedApp]);');
  assert.ok(prepare >= 0);
  assert.ok(bundle > prepare);
  assert.ok(verify > bundle);
  assert.ok(sign > verify);
  assert.doesNotMatch(script, /\b(?:cp|chmod)\([^\n]*vaultmesh-(?:native-host|agent-mcp)/);
  assert.doesNotMatch(script, /\bbuilt(?:Host|AgentMcp)\b/);
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
