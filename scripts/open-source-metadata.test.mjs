import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonicalAgplSha256 =
  "8486a10c4393cee1c25392769ddd3b2d6c242d6ec7928e1414efff7dfb2f07ef";

async function read(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("CT-OSS-001 preserves the canonical historical AGPLv3 license evidence", async () => {
  const license = await read("LICENSES/AGPL-3.0-or-later.txt");
  const digest = createHash("sha256").update(license).digest("hex");
  const licensing = await read("LICENSING.md");

  assert.equal(digest, canonicalAgplSha256);
  assert.match(license, /GNU AFFERO GENERAL PUBLIC LICENSE/);
  assert.match(license, /Version 3, 19 November 2007/);
  assert.match(licensing, /历史 AGPL 授权/);
  assert.match(licensing, /不撤销、收回或追溯限制/);
});

test("CT-OSS-001 keeps the original publication evidence archived", async () => {
  const change = await read("changes/CHG-2026-031-open-source-license/change.yaml");
  const archive = JSON.parse(await read("changes/archive.json"));

  assert.match(change, /^status: "Verified"$/m);
  assert.ok(
    JSON.stringify(archive).includes("CHG-2026-031-open-source-license"),
    "original AGPL publication Work must remain archived",
  );
});

test("CT-OSS-001 keeps exact historical secret-scan exceptions", async () => {
  const gitleaksIgnore = await read(".gitleaksignore");
  const ignoredFindings = gitleaksIgnore
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"));

  assert.equal(ignoredFindings.length, 13);
  for (const fingerprint of ignoredFindings) {
    assert.match(
      fingerprint,
      /^[0-9a-f]{40}:[^:*]+:(?:private-key|generic-api-key):\d+$/,
      "Gitleaks exceptions must be exact historical fingerprints",
    );
  }
});
