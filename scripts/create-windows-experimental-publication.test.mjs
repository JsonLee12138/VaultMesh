import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createWindowsExperimentalPublication } from "./create-windows-experimental-publication.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "vaultmesh-windows-experimental-"));
  const inputDirectory = path.join(root, "input");
  const outputDirectory = path.join(root, "output");
  const version = "0.1.1-test.2.windows-experimental.1";
  await mkdir(inputDirectory);
  const descriptor = {
    platform: "windows-x86_64",
    version,
    updateFile: `VaultMesh_${version}_windows-x86_64-setup.exe`,
    signatureFile: `VaultMesh_${version}_windows-x86_64-setup.exe.sig`,
    installers: [
      `VaultMesh_${version}_windows-x86_64-setup.exe`,
      `VaultMesh_${version}_windows-x86_64-installer.msi`,
    ],
  };
  await writeFile(path.join(inputDirectory, descriptor.updateFile), "updater");
  await writeFile(path.join(inputDirectory, descriptor.signatureFile), "signature");
  await writeFile(path.join(inputDirectory, descriptor.installers[0]), "installer");
  await writeFile(path.join(inputDirectory, descriptor.installers[1]), "msi-installer");
  await writeFile(
    path.join(inputDirectory, "windows-x86_64.update.json"),
    `${JSON.stringify(descriptor)}\n`,
  );
  return { inputDirectory, outputDirectory, version, descriptor };
}

test("creates immutable Windows NSIS and MSI publication links without a channel manifest", async () => {
  const options = await fixture();
  const result = await createWindowsExperimentalPublication({
    ...options,
    baseUrl: "https://updates.example.test/vaultmesh/",
  });
  assert.equal(result.prefix, `experimental/windows/v${options.version}`);
  assert.match(result.links.installer, /experimental\/windows\/.*-setup\.exe$/);
  assert.match(result.links.msiInstaller, /experimental\/windows\/.*-installer\.msi$/);
  const plan = await readFile(path.join(options.outputDirectory, "immutable.tsv"), "utf8");
  assert.match(plan, /experimental\/windows\/v0\.1\.1-test\.2\.windows-experimental\.1/);
  assert.match(plan, /\t[0-9a-f]{64}\n/);
  assert.match(plan, /-installer\.msi\tapplication\/x-msi\t[0-9a-f]{64}/);
  assert.doesNotMatch(plan, /channels\/test|latest\.json/);
});

test("rejects unsafe, incomplete or mismatched Windows experimental input", async () => {
  const options = await fixture();
  await writeFile(
    path.join(options.inputDirectory, "windows-x86_64.update.json"),
    JSON.stringify({ ...options.descriptor, version: "0.1.1-test.2" }),
  );
  await assert.rejects(
    () => createWindowsExperimentalPublication({ ...options, baseUrl: "https://updates.example.test" }),
    /平台或版本不一致/,
  );
  await assert.rejects(
    () => createWindowsExperimentalPublication({ ...options, baseUrl: "http://updates.example.test" }),
    /HTTPS/,
  );
});

test("keeps legacy NSIS-only experimental input compatible", async () => {
  const options = await fixture();
  const descriptor = { ...options.descriptor, installers: [options.descriptor.installers[0]] };
  await writeFile(
    path.join(options.inputDirectory, "windows-x86_64.update.json"),
    `${JSON.stringify(descriptor)}\n`,
  );
  const result = await createWindowsExperimentalPublication({
    ...options,
    baseUrl: "https://updates.example.test",
  });
  assert.equal(result.links.msiInstaller, null);
});
