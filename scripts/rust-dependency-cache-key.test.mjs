import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

import {
  hashDependencyInputs,
  normalizeCargoLock,
  normalizeWorkspaceManifest,
} from "./rust-dependency-cache-key.mjs";

const execFileAsync = promisify(execFile);
const workspace = new URL("../", import.meta.url);
const scriptUrl = new URL("rust-dependency-cache-key.mjs", import.meta.url);

function fingerprint({ workspaceVersion, dependencyVersion = "1.0.0", toolchain = "1.95.0" }) {
  const manifest = normalizeWorkspaceManifest(`[workspace.package]\nversion = "${workspaceVersion}"\n\n[workspace.dependencies]\nexample = "${dependencyVersion}"\n`);
  const lock = normalizeCargoLock(
    `version = 4\n\n[[package]]\nname = "example"\nversion = "${dependencyVersion}"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n\n[[package]]\nname = "vaultmesh-core"\nversion = "${workspaceVersion}"\n`,
    ["vaultmesh-core"],
  );

  return hashDependencyInputs([
    { path: "Cargo.toml", content: manifest },
    { path: "Cargo.lock", content: lock },
    { path: "rust-toolchain.toml", content: `[toolchain]\nchannel = "${toolchain}"\n` },
  ]);
}

test("dependency fingerprint ignores workspace-only version changes", () => {
  assert.equal(
    fingerprint({ workspaceVersion: "0.0.5-review" }),
    fingerprint({ workspaceVersion: "0.0.6-review" }),
  );
});

test("dependency fingerprint changes with dependencies or the Rust toolchain", () => {
  const baseline = fingerprint({ workspaceVersion: "0.0.6-review" });
  assert.notEqual(baseline, fingerprint({ workspaceVersion: "0.0.6-review", dependencyVersion: "1.0.1" }));
  assert.notEqual(baseline, fingerprint({ workspaceVersion: "0.0.6-review", toolchain: "1.96.0" }));
});

test("repository dependency fingerprint is a stable SHA-256 value", async () => {
  const { stdout } = await execFileAsync(process.execPath, [scriptUrl.pathname], {
    cwd: workspace,
  });

  assert.match(stdout.trim(), /^[a-f0-9]{64}$/u);
});
