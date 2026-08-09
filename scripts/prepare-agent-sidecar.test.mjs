import assert from "node:assert/strict";
import test from "node:test";

import { readFile } from "node:fs/promises";

import { parseArguments, sidecarPaths } from "./prepare-agent-sidecar.mjs";

test("Agent sidecar target parsing rejects ambiguous or path-like values", () => {
  assert.deepEqual(parseArguments([]), { target: undefined });
  assert.deepEqual(parseArguments(["--target", "aarch64-apple-darwin"]), {
    target: "aarch64-apple-darwin",
  });
  assert.throws(() => parseArguments(["--target"]));
  assert.throws(() => parseArguments(["--target", "one", "--target", "two"]));
  assert.throws(() => sidecarPaths("../escape"));
});

test("Agent sidecar follows Tauri target-triple naming on macOS and Windows", () => {
  const mac = sidecarPaths("aarch64-apple-darwin", "darwin");
  assert.match(mac.built, /target\/aarch64-apple-darwin\/release\/vaultmesh-agent-mcp$/);
  assert.match(mac.bundled, /binaries\/vaultmesh-agent-mcp-aarch64-apple-darwin$/);

  const windows = sidecarPaths("x86_64-pc-windows-msvc", "win32");
  assert.match(windows.built, /target\/x86_64-pc-windows-msvc\/release\/vaultmesh-agent-mcp\.exe$/);
  assert.match(windows.bundled, /binaries\/vaultmesh-agent-mcp-x86_64-pc-windows-msvc\.exe$/);
});

test("Tauri release overlay bundles the prepared privileged sidecars", async () => {
  const config = JSON.parse(await readFile(new URL(
    "../apps/tauri-desktop/src-tauri/tauri.agent.conf.json",
    import.meta.url,
  ), "utf8"));
  assert.deepEqual(config.bundle.externalBin, [
    "binaries/vaultmesh-agent-mcp",
  ]);
});
