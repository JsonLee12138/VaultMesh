import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { extendReviewWindowsManifest } from "./extend-review-windows-manifest.mjs";

const version = "0.0.2-review";
const baseUrl = "https://updates.example.test";

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "vaultmesh-review-windows-"));
  const currentManifestPath = path.join(directory, "current.json");
  const descriptorPath = path.join(directory, "windows-x86_64.update.json");
  const signaturePath = path.join(directory, "update.sig");
  const outputPath = path.join(directory, "publication", "latest.json");
  const current = {
    version,
    notes: "Existing staged Review.",
    pub_date: "2026-08-07T00:00:00.000Z",
    platforms: {
      "darwin-x86_64": {
        signature: "existing-macos-signature",
        url: `${baseUrl}/experimental/macos/darwin-x86_64/v${version}/VaultMesh.app.tar.gz`,
      },
    },
  };
  const descriptor = {
    platform: "windows-x86_64",
    version,
    updateFile: `VaultMesh_${version}_x64-setup.exe`,
    signatureFile: `VaultMesh_${version}_x64-setup.exe.sig`,
    installers: [`VaultMesh_${version}_x64-setup.exe`, `VaultMesh_${version}_x64_en-US.msi`],
  };
  await writeFile(currentManifestPath, JSON.stringify(current));
  await writeFile(descriptorPath, JSON.stringify(descriptor));
  await writeFile(signaturePath, "signed-windows-artifact\n");
  return { directory, currentManifestPath, descriptorPath, signaturePath, outputPath, current };
}

test("adds Windows x64 without changing the staged Review fields", async (context) => {
  const files = await fixture();
  context.after(() => rm(files.directory, { recursive: true, force: true }));
  const manifest = await extendReviewWindowsManifest({ ...files, version, baseUrl });

  assert.equal(manifest.version, files.current.version);
  assert.equal(manifest.notes, files.current.notes);
  assert.equal(manifest.pub_date, files.current.pub_date);
  assert.deepEqual(manifest.platforms["darwin-x86_64"], files.current.platforms["darwin-x86_64"]);
  assert.deepEqual(manifest.platforms["windows-x86_64"], {
    signature: "signed-windows-artifact",
    url: `${baseUrl}/experimental/windows/v${version}/VaultMesh_${version}_x64-setup.exe`,
  });
  assert.deepEqual(JSON.parse(await readFile(files.outputPath, "utf8")), manifest);
});

test("rejects version drift and an existing Windows platform", async (context) => {
  const files = await fixture();
  context.after(() => rm(files.directory, { recursive: true, force: true }));
  await assert.rejects(
    extendReviewWindowsManifest({ ...files, version: "0.0.3-review", baseUrl }),
    /同版本/,
  );
  files.current.platforms["windows-x86_64"] = {
    signature: "existing",
    url: `${baseUrl}/existing.exe`,
  };
  await writeFile(files.currentManifestPath, JSON.stringify(files.current));
  await assert.rejects(
    extendReviewWindowsManifest({ ...files, version, baseUrl }),
    /已包含 windows-x86_64/,
  );
});

test("rejects descriptor traversal, empty signatures and unsafe URLs", async (context) => {
  const files = await fixture();
  context.after(() => rm(files.directory, { recursive: true, force: true }));
  const descriptor = JSON.parse(await readFile(files.descriptorPath, "utf8"));
  descriptor.updateFile = "../VaultMesh-setup.exe";
  descriptor.signatureFile = "../VaultMesh-setup.exe.sig";
  await writeFile(files.descriptorPath, JSON.stringify(descriptor));
  await assert.rejects(
    extendReviewWindowsManifest({ ...files, version, baseUrl }),
    /artifact 文件名无效/,
  );
  descriptor.updateFile = "VaultMesh-setup.exe";
  descriptor.signatureFile = "VaultMesh-setup.exe.sig";
  await writeFile(files.descriptorPath, JSON.stringify(descriptor));
  await writeFile(files.signaturePath, "\n");
  await assert.rejects(
    extendReviewWindowsManifest({ ...files, version, baseUrl }),
    /signature 无效/,
  );
  await writeFile(files.signaturePath, "signed\n");
  await assert.rejects(
    extendReviewWindowsManifest({ ...files, version, baseUrl: "http://updates.example.test" }),
    /必须是.*HTTPS/,
  );
});
