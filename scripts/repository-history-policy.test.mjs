import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

const root = new URL("..", import.meta.url);
const removedCommits = new Set([
  "d4e6d9af86f7c57a7e60ae8726534ba345aac591",
  "210a7c1befc75c850d5ac82b21ba272c5976b805",
]);

function git(...args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

test("CT-HISTORY-001 excludes the AGPL publication commits from current refs", () => {
  const reachable = new Set(git("rev-list", "--all").split("\n").filter(Boolean));

  for (const commit of removedCommits) {
    assert.equal(reachable.has(commit), false, `${commit} remains reachable`);
  }
});

test("CT-HISTORY-001 keeps one PolyForm root for main", () => {
  const roots = git("rev-list", "--max-parents=0", "main")
    .split("\n")
    .filter(Boolean);

  assert.equal(roots.length, 1);
  const rootLicense = git("show", `${roots[0]}:LICENSE`);
  assert.match(rootLicense, /PolyForm Noncommercial License 1\.0\.0/);
});

test("CT-HISTORY-001 keeps current package licensing metadata", () => {
  const packageJson = JSON.parse(git("show", "main:package.json"));
  assert.equal(packageJson.license, "PolyForm-Noncommercial-1.0.0");
  assert.equal(packageJson.private, true);
});
