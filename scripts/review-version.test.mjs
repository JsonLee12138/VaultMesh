import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspace = new URL("../", import.meta.url);
const expectedVersion = "0.0.2-review";

async function json(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, workspace), "utf8"));
}

test("Review product manifests use one prerelease version", async () => {
  for (const relativePath of [
    "package.json",
    "apps/tauri-desktop/package.json",
    "apps/browser-extension/package.json",
    "packages/ssh-command-parser/package.json",
    "apps/tauri-desktop/src-tauri/tauri.conf.json",
  ]) {
    assert.equal((await json(relativePath)).version, expectedVersion, relativePath);
  }

  const cargoManifest = await readFile(new URL("Cargo.toml", workspace), "utf8");
  assert.match(cargoManifest, new RegExp(`^version = "${expectedVersion.replaceAll(".", "\\.")}"$`, "m"));
});

test("Review publication is isolated from the existing test channel", async () => {
  const workflow = await readFile(new URL(".github/workflows/r2-review-release.yml", workspace), "utf8");
  assert.match(workflow, /name: Publish R2 review release/);
  assert.match(workflow, /default: "0\.0\.2-review"/);
  assert.match(workflow, /channels\/review\/latest\.json/);
  assert.doesNotMatch(workflow, /channels\/test\/latest\.json/);
  assert.match(workflow, /Review version matches source metadata/);
  assert.match(workflow, /process\.env\.REVIEW_VERSION !== sourceVersion/);
  assert.match(workflow, /--updater-version "\$\{\{ inputs\.version \}\}"/);
  assert.match(workflow, /Publish immutable artifacts then review channel/);
});

test("Intel macOS baseline can embed Review without publishing the channel", async () => {
  const workflow = await readFile(
    new URL(".github/workflows/r2-macos-experimental-package.yml", workspace),
    "utf8",
  );

  assert.match(workflow, /runs-on: \[self-hosted, macOS, X64, vaultmesh-macos-native\]/);
  assert.match(workflow, /options:\n\s+- test\n\s+- review/);
  assert.match(workflow, /channels\/\$\{\{ inputs\.channel \}\}\/latest\.json/);
  assert.match(workflow, /Review channel requires a review prerelease version/);
  assert.match(workflow, /does not match source metadata/);
  assert.match(workflow, /The \$\{UPDATER_CHANNEL\} update channel was not modified/);
  assert.doesNotMatch(workflow, /channels\/(?:test|review)\/latest\.json.*--request PUT/);
});

test("Intel staged Review channel starts at the baseline and then advances strictly", async () => {
  const workflow = await readFile(
    new URL(".github/workflows/r2-review-intel-baseline.yml", workspace),
    "utf8",
  );

  assert.match(workflow, /runs-on: \[self-hosted, macOS, X64, vaultmesh-macos-native\]/);
  assert.match(workflow, /default: "0\.0\.2-review"/);
  assert.match(workflow, /RELEASE_VERSION.*-review/);
  assert.match(workflow, /create-review-baseline-manifest\.mjs/);
  assert.match(workflow, /arguments\+?=\(/);
  assert.match(workflow, /--current "\$RUNNER_TEMP\/review-channel-before\.json"/);
  assert.match(workflow, /experimental\/macos\/darwin-x86_64\/v\$\{RELEASE_VERSION\}/);
  assert.match(workflow, /Review channel state changed during publication/);
  assert.match(workflow, /review-channel-authoritative-before\.json/);
  assert.match(workflow, /channels\/review\/latest\.json/);
  assert.match(workflow, /cmp "\$RUNNER_TEMP\/test-channel-before\.json" "\$RUNNER_TEMP\/test-channel-after\.json"/);
  assert.doesNotMatch(workflow, /macos-15|ubuntu-24\.04|windows-2025/);
  assert.doesNotMatch(workflow, /channels\/test\/latest\.json.*--request PUT/);
});

test("Windows Review packages use a frozen source and append only a same-version platform", async () => {
  const workflow = await readFile(
    new URL(".github/workflows/r2-windows-experimental-package.yml", workspace),
    "utf8",
  );

  assert.match(workflow, /runs-on: \[self-hosted, Windows, X64, vaultmesh-windows-native\]/);
  assert.match(workflow, /options:\n\s+- test\n\s+- review/);
  assert.match(workflow, /ref: \$\{\{ inputs\.source_ref \|\| github\.sha \}\}/);
  assert.match(workflow, /channels\/\$\{\{ inputs\.channel \}\}\/latest\.json/);
  assert.match(workflow, /extend-review-windows-manifest\.mjs/);
  assert.match(workflow, /if: inputs\.publish_review_platform && inputs\.channel == 'review'/);
  assert.match(workflow, /Review channel state changed during Windows platform publication/);
  assert.match(workflow, /The test update channel changed/);
  assert.doesNotMatch(workflow, /runs-on: \[self-hosted, (?:Linux|macOS)/);
  assert.doesNotMatch(workflow, /actions\/(?:upload|download)-artifact|needs: build/);
});
