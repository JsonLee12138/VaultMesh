import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createReviewBaselineManifest } from "./create-review-baseline-manifest.mjs";

const version = "0.0.1-review";
const baseUrl = "https://updates.example.test";

async function fixture(fixtureVersion = version) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "vaultmesh-review-baseline-"));
  const descriptorPath = path.join(directory, "darwin-x86_64.update.json");
  const signaturePath = path.join(directory, "update.sig");
  const outputPath = path.join(directory, "publication", "latest.json");
  await writeFile(
    descriptorPath,
    JSON.stringify({
      platform: "darwin-x86_64",
      version: fixtureVersion,
      updateFile: `VaultMesh_${fixtureVersion}_darwin-x86_64.app.tar.gz`,
      signatureFile: `VaultMesh_${fixtureVersion}_darwin-x86_64.app.tar.gz.sig`,
      installers: [`VaultMesh_${fixtureVersion}_darwin-x86_64.dmg`],
    }),
  );
  await writeFile(signaturePath, "signed-review-artifact\n");
  return { directory, descriptorPath, signaturePath, outputPath };
}

test("creates a same-version Intel-only Review baseline manifest", async (context) => {
  const files = await fixture();
  context.after(() => rm(files.directory, { recursive: true, force: true }));
  const manifest = await createReviewBaselineManifest({
    ...files,
    version,
    baseUrl,
    pubDate: "2026-08-07T00:00:00.000Z",
  });

  assert.equal(manifest.version, version);
  assert.deepEqual(Object.keys(manifest.platforms), ["darwin-x86_64"]);
  assert.equal(manifest.platforms["darwin-x86_64"].signature, "signed-review-artifact");
  assert.equal(
    manifest.platforms["darwin-x86_64"].url,
    `${baseUrl}/experimental/macos/darwin-x86_64/v${version}/VaultMesh_${version}_darwin-x86_64.app.tar.gz`,
  );
  assert.deepEqual(JSON.parse(await readFile(files.outputPath, "utf8")), manifest);
});

test("rejects a version or descriptor outside the fixed Intel baseline", async (context) => {
  const files = await fixture();
  context.after(() => rm(files.directory, { recursive: true, force: true }));
  await assert.rejects(
    createReviewBaselineManifest({ ...files, version: "0.0.2-review", baseUrl }),
    /缺失 Review channel 必须从 0\.0\.1-review 开始/,
  );
  const descriptor = JSON.parse(await readFile(files.descriptorPath, "utf8"));
  descriptor.platform = "darwin-aarch64";
  await writeFile(files.descriptorPath, JSON.stringify(descriptor));
  await assert.rejects(
    createReviewBaselineManifest({ ...files, version, baseUrl }),
    /平台或版本不一致/,
  );
});

test("advances an existing Intel-only Review channel to a higher Review version", async (context) => {
  const updateVersion = "0.0.2-review";
  const files = await fixture(updateVersion);
  context.after(() => rm(files.directory, { recursive: true, force: true }));
  const currentManifestPath = path.join(files.directory, "current.json");
  await writeFile(currentManifestPath, JSON.stringify({ version }));

  const manifest = await createReviewBaselineManifest({
    ...files,
    version: updateVersion,
    baseUrl,
    currentManifestPath,
  });
  assert.equal(manifest.version, updateVersion);
  assert.match(manifest.platforms["darwin-x86_64"].url, /v0\.0\.2-review/);

  await writeFile(currentManifestPath, JSON.stringify({ version: updateVersion }));
  await assert.rejects(
    createReviewBaselineManifest({
      ...files,
      version: updateVersion,
      baseUrl,
      currentManifestPath,
    }),
    /严格高于当前 channel 版本/,
  );
});

test("rejects an unsafe public base URL or empty signature", async (context) => {
  const files = await fixture();
  context.after(() => rm(files.directory, { recursive: true, force: true }));
  await assert.rejects(
    createReviewBaselineManifest({ ...files, version, baseUrl: "http://updates.example.test" }),
    /必须是.*HTTPS/,
  );
  await writeFile(files.signaturePath, "\n");
  await assert.rejects(
    createReviewBaselineManifest({ ...files, version, baseUrl }),
    /signature 无效/,
  );
});
