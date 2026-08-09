import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../.github/workflows/r2-test-update.yml", import.meta.url);
const resumeWorkflowUrl = new URL("../.github/workflows/r2-resume-update.yml", import.meta.url);
const windowsExperimentalWorkflowUrl = new URL(
  "../.github/workflows/r2-windows-experimental-package.yml",
  import.meta.url,
);
const macosExperimentalWorkflowUrl = new URL(
  "../.github/workflows/r2-macos-experimental-package.yml",
  import.meta.url,
);
const windowsExperimentalFromRunWorkflowUrl = new URL(
  "../.github/workflows/r2-windows-experimental-from-run.yml",
  import.meta.url,
);

test("R2 updater installs pnpm before setup-node requests the pnpm cache", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  const pnpmSetup = workflow.indexOf("uses: pnpm/action-setup@v6");
  const nodeSetup = workflow.indexOf("uses: actions/setup-node@v7");

  assert.notEqual(pnpmSetup, -1);
  assert.notEqual(nodeSetup, -1);
  assert.ok(pnpmSetup < nodeSetup);
  assert.match(workflow, /version: 11\.1\.1/);
  assert.match(workflow, /cache: pnpm/);
});

test("R2 Windows build selects a complete Perl before compiling vendored OpenSSL", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  const perlSetup = workflow.indexOf("name: Select complete Perl for vendored OpenSSL");
  const releaseBuild = workflow.indexOf("name: Build signed updater artifact and unsigned test installer");

  assert.notEqual(perlSetup, -1);
  assert.notEqual(releaseBuild, -1);
  assert.ok(perlSetup < releaseBuild);
  assert.match(workflow, /C:\\Strawberry\\perl\\bin/);
  assert.match(workflow, /Locale::Maketext::Simple/);
  assert.match(workflow, /OPENSSL_SRC_PERL=\$perlExecutable/);
  assert.match(workflow, /GITHUB_ENV/);
  assert.doesNotMatch(workflow, /GITHUB_PATH/);
});

test("R2 updater artifact download declares one pattern", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  const patterns = workflow.match(/^\s+pattern: vaultmesh-update-\*$/gm) ?? [];

  assert.equal(patterns.length, 1);
});

test("R2 resume publication accepts only a completed three-platform build run", async () => {
  const workflow = await readFile(resumeWorkflowUrl, "utf8");

  assert.match(workflow, /runs-on: \[self-hosted, vaultmesh-local-publish\]/);
  assert.match(workflow, /SOURCE_RUN_ID: \$\{\{ inputs\.source_run_id \}\}/);
  assert.match(workflow, /\.name == "Publish R2 test update"/);
  for (const platform of ["darwin-aarch64", "darwin-x86_64", "windows-x86_64"]) {
    assert.match(workflow, new RegExp(platform));
  }
  assert.match(workflow, /github-token: \$\{\{ github\.token \}\}/);
  assert.match(workflow, /run-id: \$\{\{ inputs\.source_run_id \}\}/);
  assert.match(workflow, /merge-multiple: true/);
  assert.match(workflow, /awscli==1\.44\.87/);
  assert.doesNotMatch(workflow, /build-tauri\.mjs/);
});

test("Windows native package publishes only immutable experimental objects", async () => {
  const workflow = await readFile(windowsExperimentalWorkflowUrl, "utf8");
  const runnerDeclarations = workflow.match(/^\s{4}runs-on:/gm) ?? [];

  assert.equal(runnerDeclarations.length, 1);
  assert.match(workflow, /runs-on: \[self-hosted, Windows, X64, vaultmesh-windows-native\]/);
  assert.doesNotMatch(workflow, /vaultmesh-windows-cross|runs-on: \[self-hosted, Linux/);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /options:\n\s+- test\n\s+- review/);
  assert.match(workflow, /source_ref:/);
  assert.match(workflow, /publish_review_platform:/);
  assert.match(workflow, /ref: \$\{\{ inputs\.source_ref \|\| github\.sha \}\}/);
  assert.match(workflow, /UPDATER_CHANNEL: \$\{\{ inputs\.channel \}\}/);
  assert.match(workflow, /channels\/\$\{\{ inputs\.channel \}\}\/latest\.json/);
  assert.match(workflow, /Review channel requires a review prerelease version/);
  assert.match(workflow, /does not match source metadata/);
  assert.match(workflow, /Overlay reviewed MSI build compatibility on frozen source/);
  assert.match(workflow, /git checkout \$env:WORKFLOW_SOURCE_SHA -- scripts\/build-tauri\.mjs/);
  assert.match(workflow, /Frozen Review source overlay changed an unexpected file/);
  assert.match(workflow, /Select complete Perl for vendored OpenSSL/);
  assert.match(
    workflow,
    /defaults:\n\s+run:\n\s+shell: powershell -NoProfile -ExecutionPolicy Bypass -Command/,
  );
  assert.doesNotMatch(workflow, /shell: (?:bash|pwsh)/);
  assert.doesNotMatch(workflow, /cache: pnpm/);
  assert.match(workflow, /pnpm\.cmd install --frozen-lockfile/);
  assert.match(workflow, /"\$env:RELEASE_VERSION"/);
  assert.match(workflow, /C:\\Strawberry\\perl\\bin/);
  const wixProbe = workflow.indexOf("name: Verify WiX ICE VBScript engine");
  const releaseBuild = workflow.indexOf("name: Build signed updater artifact and unsigned NSIS\/MSI installers");
  assert.ok(wixProbe > 0 && wixProbe < releaseBuild);
  assert.match(workflow, /cscript\.exe/);
  assert.match(workflow, /Windows VBScript optional feature/);
  assert.match(workflow, /build-tauri\.mjs\s+--verbose/);
  assert.match(workflow, /--bundles nsis,msi/);
  assert.match(workflow, /Verify Windows x64 PE executable and MSI package/);
  assert.match(workflow, /0x8664/);
  assert.match(workflow, /0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1/);
  assert.match(workflow, /links\.msiInstaller/);
  assert.match(workflow, /Windows x64 MSI installer/);
  assert.doesNotMatch(workflow, /actions\/setup-python|python -m venv|awscli==/);
  assert.doesNotMatch(workflow, /actions\/(?:upload|download)-artifact|needs: build/);
  assert.match(workflow, /experimental\/windows/);
  assert.match(workflow, /curl\.exe --help all/);
  assert.match(workflow, /--aws-sigv4 "aws:amz:auto:s3"/);
  assert.equal((workflow.match(/secrets\.R2_ACCESS_KEY_ID/g) ?? []).length, 2);
  assert.match(
    workflow,
    /name: Publish and verify immutable experimental objects\n\s+env:\n\s+AWS_ACCESS_KEY_ID:/,
  );
  assert.match(workflow, /Get-FileHash -LiteralPath \$downloaded -Algorithm SHA256/);
  assert.match(workflow, /The test update channel changed/);
  assert.match(workflow, /The selected updater channel changed/);
  assert.match(workflow, /extend-review-windows-manifest\.mjs/);
  assert.match(workflow, /Review channel state changed during Windows platform publication/);
  assert.match(workflow, /Cache-Control: no-store, max-age=0/);
  assert.match(workflow, /Public Review channel did not converge/);
  assert.doesNotMatch(workflow, /windows-2025|ubuntu-24\.04|docker|cargo-xwin/);
  assert.doesNotMatch(workflow, /s3:\/\/\$\{?R2_BUCKET\}?\/channels\/test\/latest\.json/);
  assert.doesNotMatch(workflow, /channels\/test\/latest\.json.*(?:PUT|upload-file)/);
});

test("Intel macOS runner publishes native x86_64 or explicitly cross-built ARM64 packages", async () => {
  const workflow = await readFile(macosExperimentalWorkflowUrl, "utf8");
  const runnerDeclarations = workflow.match(/^\s{4}runs-on:/gm) ?? [];

  assert.equal(runnerDeclarations.length, 1);
  assert.match(workflow, /runs-on: \[self-hosted, macOS, X64, vaultmesh-macos-native\]/);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /\[\[ "\$\(uname -m\)" == "x86_64" \]\]/);
  assert.match(workflow, /options:\n\s+- darwin-x86_64\n\s+- darwin-aarch64/);
  assert.match(workflow, /options:\n\s+- test\n\s+- review/);
  assert.match(workflow, /UPDATER_CHANNEL: \$\{\{ inputs\.channel \}\}/);
  assert.match(workflow, /channels\/\$\{\{ inputs\.channel \}\}\/latest\.json/);
  assert.match(workflow, /Review channel requires a review prerelease version/);
  assert.match(workflow, /does not match source metadata/);
  assert.match(workflow, /aarch64-apple-darwin/);
  assert.match(workflow, /x86_64-apple-darwin/);
  assert.match(workflow, /--target "\$TARGET_TRIPLE"/);
  assert.match(workflow, /--bundles app,dmg/);
  assert.match(workflow, /--platform "\$TARGET_PLATFORM"/);
  assert.match(workflow, /Mach-O 64-bit executable \$MACHO_ARCH/);
  assert.match(workflow, /vtool -show-build/);
  assert.match(workflow, /minos 12\.0/);
  assert.match(workflow, /codesign --verify --deep --strict/);
  assert.match(workflow, /hdiutil imageinfo/);
  assert.match(workflow, /create-macos-experimental-publication\.mjs/);
  assert.match(workflow, /experimental\/macos\/"\$TARGET_PLATFORM"/);
  assert.match(workflow, /macOS ARM64 cross-built on Intel/);
  assert.match(workflow, /not native Apple Silicon package or macOS ARM AT evidence/);
  assert.match(workflow, /--aws-sigv4 "aws:amz:auto:s3"/);
  assert.match(workflow, /shasum -a 256/);
  assert.match(workflow, /cmp "\$RUNNER_TEMP\/channel-before\.status" "\$RUNNER_TEMP\/channel-after\.status"/);
  assert.match(workflow, /if \[\[ "\$status" == "200" \]\]; then\n\s+cmp "\$RUNNER_TEMP\/channel-before\.json" "\$RUNNER_TEMP\/channel-after\.json"/);
  assert.match(workflow, /if \[\[ "\$status" == "404" \]\]; then/);
  assert.doesNotMatch(workflow, /actions\/(?:upload|download)-artifact|needs: build/);
  assert.doesNotMatch(workflow, /macos-15|ubuntu-24\.04|windows-2025|channels\/(?:test|review)\/latest\.json.*--request PUT/);
});

test("Windows experimental resume accepts only a successful native Windows build", async () => {
  const workflow = await readFile(windowsExperimentalFromRunWorkflowUrl, "utf8");

  assert.match(workflow, /runs-on: \[self-hosted, linux, x64, vaultmesh-windows-cross\]/);
  assert.match(workflow, /\.name == "Publish R2 test update"/);
  assert.match(workflow, /\.name == "Build windows-x86_64"/);
  assert.match(workflow, /\.conclusion == "success"/);
  assert.match(workflow, /name: vaultmesh-update-windows-x86_64/);
  assert.match(workflow, /run-id: \$\{\{ inputs\.source_run_id \}\}/);
  assert.match(workflow, /experimental\/windows/);
  assert.match(workflow, /cmp "\$RUNNER_TEMP\/channel-before\.json" "\$RUNNER_TEMP\/channel-after\.json"/);
  assert.doesNotMatch(workflow, /build-tauri\.mjs|channels\/test\/latest\.json" \\\n+\s+--endpoint-url/);
});
