import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createMacosExperimentalPublication } from "./create-macos-experimental-publication.mjs";

async function fixture(platform = "darwin-x86_64") {
  const root = await mkdtemp(path.join(os.tmpdir(), "vaultmesh-macos-experimental-"));
  const inputDirectory = path.join(root, "input");
  const outputDirectory = path.join(root, "output");
  const version = "0.1.1-test.5";
  await mkdir(inputDirectory);
  const descriptor = {
    platform,
    version,
    updateFile: `VaultMesh_${version}_${platform}.app.tar.gz`,
    signatureFile: `VaultMesh_${version}_${platform}.app.tar.gz.sig`,
    installers: [`VaultMesh_${version}_${platform}.dmg`],
  };
  await writeFile(path.join(inputDirectory, descriptor.updateFile), "updater");
  await writeFile(path.join(inputDirectory, descriptor.signatureFile), "signature");
  await writeFile(path.join(inputDirectory, descriptor.installers[0]), "installer");
  await writeFile(
    path.join(inputDirectory, `${platform}.update.json`),
    `${JSON.stringify(descriptor)}\n`,
  );
  return { inputDirectory, outputDirectory, version, descriptor };
}

test("creates immutable Intel macOS DMG and updater links without a channel manifest", async () => {
  const options = await fixture();
  const result = await createMacosExperimentalPublication({
    ...options,
    baseUrl: "https://updates.example.test/vaultmesh/",
  });
  assert.equal(result.prefix, `experimental/macos/darwin-x86_64/v${options.version}`);
  assert.match(result.links.installer, /experimental\/macos\/darwin-x86_64\/.*\.dmg$/);
  assert.match(result.links.updaterArtifact, /\.app\.tar\.gz$/);
  assert.match(result.links.updaterSignature, /\.app\.tar\.gz\.sig$/);
  assert.match(result.links.descriptor, /darwin-x86_64\.update\.json$/);
  const plan = await readFile(path.join(options.outputDirectory, "immutable.tsv"), "utf8");
  assert.match(plan, /\.dmg\tapplication\/x-apple-diskimage\t[0-9a-f]{64}/);
  assert.match(plan, /\.app\.tar\.gz\tapplication\/gzip\t[0-9a-f]{64}/);
  assert.doesNotMatch(plan, /channels\/test|latest\.json/);
});

test("creates immutable ARM64 cross-build links in a distinct platform prefix", async () => {
  const options = await fixture("darwin-aarch64");
  const result = await createMacosExperimentalPublication({
    ...options,
    platform: "darwin-aarch64",
    baseUrl: "https://updates.example.test/vaultmesh",
  });
  assert.equal(result.prefix, `experimental/macos/darwin-aarch64/v${options.version}`);
  assert.match(result.links.installer, /darwin-aarch64\/.*\.dmg$/);
  assert.match(result.links.descriptor, /darwin-aarch64\.update\.json$/);
  const plan = await readFile(path.join(options.outputDirectory, "immutable.tsv"), "utf8");
  assert.doesNotMatch(plan, /darwin-x86_64|channels\/test|latest\.json/);
});

test("rejects unsafe, incomplete or mismatched Intel macOS input", async () => {
  const options = await fixture();
  await writeFile(
    path.join(options.inputDirectory, "darwin-x86_64.update.json"),
    JSON.stringify({ ...options.descriptor, platform: "darwin-aarch64" }),
  );
  await assert.rejects(
    () => createMacosExperimentalPublication({ ...options, baseUrl: "https://updates.example.test" }),
    /平台或版本不一致/,
  );
  await assert.rejects(
    () => createMacosExperimentalPublication({ ...options, baseUrl: "http://updates.example.test" }),
    /HTTPS/,
  );
  await assert.rejects(
    () => createMacosExperimentalPublication({
      ...options,
      platform: "darwin-universal",
      baseUrl: "https://updates.example.test",
    }),
    /darwin-aarch64 或 darwin-x86_64/,
  );
});
