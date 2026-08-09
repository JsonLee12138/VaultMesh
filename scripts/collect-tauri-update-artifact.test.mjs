import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { collectTauriUpdateArtifact } from "./collect-tauri-update-artifact.mjs";

test("normalizes a signed macOS updater artifact and installer", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "vaultmesh-collect-update-"));
  const bundleRoot = path.join(workspace, "target", "aarch64-apple-darwin", "release", "bundle");
  const bundle = path.join(bundleRoot, "macos");
  const dmgBundle = path.join(bundleRoot, "dmg");
  const outputDirectory = path.join(workspace, "collected");
  await mkdir(bundle, { recursive: true });
  await mkdir(dmgBundle, { recursive: true });
  await writeFile(path.join(bundle, "VaultMesh.app.tar.gz"), "update");
  await writeFile(path.join(bundle, "VaultMesh.app.tar.gz.sig"), "signature");
  await writeFile(path.join(dmgBundle, "VaultMesh_1.2.3_aarch64.dmg"), "installer");

  const descriptor = await collectTauriUpdateArtifact({ workspace, platform: "darwin-aarch64", version: "1.2.3", outputDirectory });
  assert.equal(descriptor.updateFile, "VaultMesh_1.2.3_darwin-aarch64.app.tar.gz");
  assert.deepEqual(descriptor.installers, ["VaultMesh_1.2.3_darwin-aarch64.dmg"]);
  assert.equal(await readFile(path.join(outputDirectory, descriptor.signatureFile), "utf8"), "signature");
});

test("keeps a Windows NSIS updater archive separate from its initial installer", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "vaultmesh-collect-update-windows-"));
  const bundle = path.join(workspace, "target", "x86_64-pc-windows-msvc", "release", "bundle", "nsis");
  const outputDirectory = path.join(workspace, "collected");
  await mkdir(bundle, { recursive: true });
  await writeFile(path.join(bundle, "VaultMesh.nsis.zip"), "update");
  await writeFile(path.join(bundle, "VaultMesh.nsis.zip.sig"), "signature");
  await writeFile(path.join(bundle, "VaultMesh-setup.exe"), "installer");

  const descriptor = await collectTauriUpdateArtifact({ workspace, platform: "windows-x86_64", version: "1.2.3", outputDirectory });
  assert.equal(descriptor.updateFile, "VaultMesh_1.2.3_windows-x86_64.nsis.zip");
  assert.deepEqual(descriptor.installers, ["VaultMesh_1.2.3_windows-x86_64-setup.exe"]);
});

test("adds a Windows MSI as a separate manual installer while keeping NSIS as updater", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "vaultmesh-collect-update-windows-msi-"));
  const bundleRoot = path.join(workspace, "target", "x86_64-pc-windows-msvc", "release", "bundle");
  const nsisBundle = path.join(bundleRoot, "nsis");
  const msiBundle = path.join(bundleRoot, "msi");
  const outputDirectory = path.join(workspace, "collected");
  await mkdir(nsisBundle, { recursive: true });
  await mkdir(msiBundle, { recursive: true });
  await writeFile(path.join(nsisBundle, "VaultMesh-setup.exe"), "nsis-updater");
  await writeFile(path.join(nsisBundle, "VaultMesh-setup.exe.sig"), "signature");
  await writeFile(path.join(msiBundle, "VaultMesh_1.2.3_x64_en-US.msi"), "msi-installer");

  const descriptor = await collectTauriUpdateArtifact({
    workspace,
    platform: "windows-x86_64",
    version: "1.2.3-test.4",
    outputDirectory,
  });
  assert.equal(descriptor.updateFile, "VaultMesh_1.2.3-test.4_windows-x86_64-setup.exe");
  assert.deepEqual(descriptor.installers, [
    "VaultMesh_1.2.3-test.4_windows-x86_64-setup.exe",
    "VaultMesh_1.2.3-test.4_windows-x86_64-installer.msi",
  ]);
  assert.equal(
    await readFile(path.join(outputDirectory, descriptor.installers[1]), "utf8"),
    "msi-installer",
  );
});
