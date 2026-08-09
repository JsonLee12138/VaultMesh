import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const supportedPlatforms = new Map([
  ["darwin-aarch64", { target: "aarch64-apple-darwin", bundleDirectories: ["macos", "dmg"] }],
  ["darwin-x86_64", { target: "x86_64-apple-darwin", bundleDirectories: ["macos", "dmg"] }],
  ["windows-x86_64", {
    target: "x86_64-pc-windows-msvc",
    bundleDirectories: ["nsis"],
    optionalBundleDirectories: ["msi"],
  }],
]);

export async function collectTauriUpdateArtifact({ workspace, platform, version, outputDirectory }) {
  const expected = supportedPlatforms.get(platform);
  if (!expected) throw new Error(`不支持的 updater platform：${platform}`);
  if (!isSemver(version)) throw new Error("更新版本必须是规范 SemVer。");
  const bundleRoot = path.join(workspace, "target", expected.target, "release", "bundle");
  const files = (
    await Promise.all([
      ...expected.bundleDirectories.map((directory) => listFiles(path.join(bundleRoot, directory))),
      ...(expected.optionalBundleDirectories ?? []).map(
        (directory) => listFiles(path.join(bundleRoot, directory), { optional: true }),
      ),
    ])
  ).flat();
  const updatePair = selectUpdatePair(files, platform);
  const installers = selectInstallers(files, platform, updatePair.artifact);
  await mkdir(outputDirectory, { recursive: true });

  const updateName = canonicalName(version, platform, updatePair.artifact);
  const signatureName = `${updateName}.sig`;
  await copyFile(updatePair.artifact, path.join(outputDirectory, updateName));
  await copyFile(updatePair.signature, path.join(outputDirectory, signatureName));
  const copiedInstallers = [];
  for (const installer of installers) {
    if (installer === updatePair.artifact) {
      copiedInstallers.push(updateName);
      continue;
    }
    const extension = path.extname(installer).toLowerCase();
    const installerName = platform === "windows-x86_64"
      ? extension === ".msi"
        ? `VaultMesh_${version}_${platform}-installer.msi`
        : `VaultMesh_${version}_${platform}-setup.exe`
      : `VaultMesh_${version}_${platform}${extension}`;
    await copyFile(installer, path.join(outputDirectory, installerName));
    copiedInstallers.push(installerName);
  }
  const descriptor = {
    platform,
    version,
    updateFile: updateName,
    signatureFile: signatureName,
    installers: copiedInstallers,
  };
  await writeFile(
    path.join(outputDirectory, `${platform}.update.json`),
    `${JSON.stringify(descriptor, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  return descriptor;
}

function selectUpdatePair(files, platform) {
  const signatures = files.filter((file) => file.endsWith(".sig"));
  const pairs = signatures
    .map((signature) => ({ signature, artifact: signature.slice(0, -4) }))
    .filter(pairExists(files));
  const preferred = platform.startsWith("darwin-")
    ? pairs.filter(({ artifact }) => artifact.endsWith(".app.tar.gz"))
    : pairs.filter(({ artifact }) => artifact.endsWith(".nsis.zip"));
  const fallback = platform === "windows-x86_64"
    ? pairs.filter(({ artifact }) => artifact.endsWith("-setup.exe"))
    : [];
  const selected = preferred.length ? preferred : fallback;
  if (selected.length !== 1) throw new Error(`必须且只能找到一个 ${platform} updater artifact/signature pair。`);
  return selected[0];
}

function pairExists(files) {
  const set = new Set(files);
  return ({ artifact }) => set.has(artifact);
}

function selectInstallers(files, platform, updateArtifact) {
  if (platform.startsWith("darwin-")) {
    const dmgs = files.filter((file) => file.endsWith(".dmg"));
    if (dmgs.length !== 1) throw new Error("必须且只能找到一个 macOS DMG installer。");
    return dmgs;
  }
  const executables = files.filter((file) => file.endsWith("-setup.exe"));
  if (executables.length !== 1) throw new Error("必须且只能找到一个 Windows NSIS installer。");
  const msis = files.filter((file) => file.toLowerCase().endsWith(".msi"));
  if (msis.length > 1) throw new Error("最多只能找到一个 Windows MSI installer。");
  return [updateArtifact.endsWith(".exe") ? updateArtifact : executables[0], ...msis];
}

function canonicalName(version, platform, artifact) {
  const suffix = artifact.endsWith(".app.tar.gz")
    ? ".app.tar.gz"
    : artifact.endsWith(".nsis.zip")
      ? ".nsis.zip"
      : artifact.endsWith(".exe")
        ? "-setup.exe"
        : null;
  if (!suffix) throw new Error("未知 updater artifact 格式。");
  return `VaultMesh_${version}_${platform}${suffix}`;
}

async function listFiles(root, { optional = false } = {}) {
  const result = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const item = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(item);
      else if (entry.isFile()) result.push(item);
    }
  }
  try {
    await visit(root);
  } catch (error) {
    if (optional && error?.code === "ENOENT") return [];
    throw new Error(`无法读取 Tauri bundle：${error instanceof Error ? error.message : error}`);
  }
  return result;
}

function isSemver(value) {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value);
}

function parseArguments(arguments_) {
  const options = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    const name = { "--workspace": "workspace", "--platform": "platform", "--version": "version", "--output": "outputDirectory" }[key];
    if (!name || !value || options[name]) throw new Error("用法：collect-tauri-update-artifact.mjs --workspace <path> --platform <key> --version <semver> --output <path>");
    options[name] = value;
  }
  if (!options.workspace || !options.platform || !options.version || !options.outputDirectory) throw new Error("缺少 artifact 收集参数。");
  return options;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const descriptor = await collectTauriUpdateArtifact(parseArguments(process.argv.slice(2)));
    console.log(`已收集 ${descriptor.platform} updater artifact。`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
