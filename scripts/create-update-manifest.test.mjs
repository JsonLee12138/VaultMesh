import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createUpdatePublication } from "./create-update-manifest.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "vaultmesh-update-manifest-"));
  const inputDirectory = path.join(root, "input");
  const outputDirectory = path.join(root, "output");
  await mkdir(inputDirectory);
  const version = "1.2.3-test.1";
  for (const platform of ["darwin-aarch64", "darwin-x86_64", "windows-x86_64"]) {
    const updateFile = `VaultMesh_${version}_${platform}${platform.startsWith("darwin") ? ".app.tar.gz" : "-setup.exe"}`;
    const signatureFile = `${updateFile}.sig`;
    const installer = platform.startsWith("darwin") ? `VaultMesh_${version}_${platform}.dmg` : updateFile;
    await writeFile(path.join(inputDirectory, updateFile), "artifact");
    await writeFile(path.join(inputDirectory, signatureFile), `signature-${platform}`);
    await writeFile(path.join(inputDirectory, installer), "installer");
    await writeFile(path.join(inputDirectory, `${platform}.update.json`), JSON.stringify({ platform, version, updateFile, signatureFile, installers: [installer] }));
  }
  return { inputDirectory, outputDirectory, version };
}

test("creates a complete static Tauri manifest and immutable upload plan", async () => {
  const options = await fixture();
  const result = await createUpdatePublication({
    ...options,
    baseUrl: "https://updates.example.test/vaultmesh/",
    notes: "Small test release",
    pubDate: "2026-08-05T00:00:00.000Z",
  });
  assert.deepEqual(Object.keys(result.manifest.platforms).sort(), ["darwin-aarch64", "darwin-x86_64", "windows-x86_64"]);
  assert.match(result.manifest.platforms["darwin-aarch64"].url, /^https:\/\/updates\.example\.test\/vaultmesh\/releases\/v1\.2\.3-test\.1\//);
  assert.equal(result.manifest.platforms["windows-x86_64"].signature, "signature-windows-x86_64");
  const uploadPlan = await readFile(path.join(options.outputDirectory, "immutable.tsv"), "utf8");
  assert.match(uploadPlan, /releases\/v1\.2\.3-test\.1\/VaultMesh_1\.2\.3-test\.1_windows-x86_64-setup\.exe/);
  assert.match(uploadPlan, /\t[0-9a-f]{64}\n/);
  assert.doesNotMatch(await readFile(result.manifestPath, "utf8"), /Secret|Access Key/);
});

test("rejects incomplete, duplicate-risk and insecure publications", async () => {
  const options = await fixture();
  await writeFile(path.join(options.inputDirectory, "darwin-x86_64.update.json"), JSON.stringify({
    platform: "darwin-aarch64",
    version: options.version,
    updateFile: "missing",
    signatureFile: "missing.sig",
    installers: ["missing.dmg"],
  }));
  await assert.rejects(() => createUpdatePublication({ ...options, baseUrl: "https://updates.example.test" }), /未知或重复/);
  await assert.rejects(() => createUpdatePublication({ ...options, baseUrl: "http://updates.example.test" }), /HTTPS/);
});

test("refuses to move a channel backward or republish the same version", async () => {
  const options = await fixture();
  const currentManifestPath = path.join(options.inputDirectory, "current.json");
  await writeFile(currentManifestPath, JSON.stringify({ version: "1.2.3-test.1" }));
  await assert.rejects(() => createUpdatePublication({ ...options, baseUrl: "https://updates.example.test", currentManifestPath }), /严格高于/);
});
