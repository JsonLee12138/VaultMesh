import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const SUPPORTED_PLATFORMS = new Set(["darwin-aarch64", "darwin-x86_64"]);

export async function createMacosExperimentalPublication({
  inputDirectory,
  outputDirectory,
  version,
  baseUrl,
  platform = "darwin-x86_64",
}) {
  if (!isSemver(version)) throw new Error("macOS experimental 版本必须是规范 SemVer。");
  validatePlatform(platform);
  const normalizedBaseUrl = validateBaseUrl(baseUrl);
  const descriptorFiles = (await readdir(inputDirectory)).filter((file) => file.endsWith(".update.json"));
  if (descriptorFiles.length !== 1 || descriptorFiles[0] !== `${platform}.update.json`) {
    throw new Error(`macOS experimental package 必须且只能包含一个 ${platform} descriptor。`);
  }
  const descriptorPath = path.join(inputDirectory, descriptorFiles[0]);
  const descriptor = JSON.parse(await readFile(descriptorPath, "utf8"));
  validateDescriptor(descriptor, version, platform);

  const files = new Map();
  files.set(descriptorFiles[0], descriptorPath);
  files.set(descriptor.updateFile, await validatedFile(inputDirectory, descriptor.updateFile));
  files.set(descriptor.signatureFile, await validatedFile(inputDirectory, descriptor.signatureFile));
  files.set(descriptor.installers[0], await validatedFile(inputDirectory, descriptor.installers[0]));
  const signature = (await readFile(files.get(descriptor.signatureFile), "utf8")).trim();
  if (!signature || signature.length > 16_384) throw new Error("macOS updater signature 无效。");

  const prefix = `experimental/macos/${platform}/v${version}`;
  const lines = [];
  for (const [name, source] of [...files.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`${source}\t${prefix}/${name}\t${contentType(name)}\t${await sha256File(source)}`);
  }
  const links = {
    installer: `${normalizedBaseUrl}/${prefix}/${encodeURIComponent(descriptor.installers[0])}`,
    updaterArtifact: `${normalizedBaseUrl}/${prefix}/${encodeURIComponent(descriptor.updateFile)}`,
    updaterSignature: `${normalizedBaseUrl}/${prefix}/${encodeURIComponent(descriptor.signatureFile)}`,
    descriptor: `${normalizedBaseUrl}/${prefix}/${encodeURIComponent(descriptorFiles[0])}`,
  };
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, "immutable.tsv"), `${lines.join("\n")}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await writeFile(path.join(outputDirectory, "links.json"), `${JSON.stringify(links, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return { descriptor, links, prefix };
}

function validateDescriptor(descriptor, version, platform) {
  if (descriptor?.platform !== platform || descriptor.version !== version) {
    throw new Error("macOS experimental package descriptor 平台或版本不一致。");
  }
  if (!safeName(descriptor.updateFile) || !descriptor.updateFile.endsWith(".app.tar.gz")) {
    throw new Error("macOS updater artifact 必须是安全的 app.tar.gz 文件名。");
  }
  if (descriptor.signatureFile !== `${descriptor.updateFile}.sig`) {
    throw new Error("macOS updater signature 文件名不匹配。");
  }
  if (
    !Array.isArray(descriptor.installers)
    || descriptor.installers.length !== 1
    || !safeName(descriptor.installers[0])
    || !descriptor.installers[0].endsWith(".dmg")
  ) {
    throw new Error("macOS experimental package 必须且只能包含一个 DMG installer。");
  }
}

function validatePlatform(platform) {
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    throw new Error("macOS experimental platform 必须是 darwin-aarch64 或 darwin-x86_64。");
  }
}

function validateBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("R2 public base URL 无效。");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("R2 public base URL 必须是不含凭据、query 或 fragment 的 HTTPS URL。");
  }
  return url.toString().replace(/\/$/, "");
}

async function validatedFile(directory, name) {
  if (!safeName(name)) throw new Error("macOS experimental package 文件名无效。");
  const file = path.join(directory, name);
  if (!(await stat(file)).isFile()) throw new Error(`macOS experimental package 文件不是普通文件：${name}`);
  return file;
}

function safeName(name) {
  return typeof name === "string" && name === path.basename(name) && /^[A-Za-z0-9._-]+$/.test(name);
}

function contentType(name) {
  if (name.endsWith(".json")) return "application/json";
  if (name.endsWith(".dmg")) return "application/x-apple-diskimage";
  if (name.endsWith(".tar.gz")) return "application/gzip";
  return "application/octet-stream";
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function isSemver(value) {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value);
}

function parseArguments(arguments_) {
  const options = {};
  const names = {
    "--input": "inputDirectory",
    "--output": "outputDirectory",
    "--version": "version",
    "--base-url": "baseUrl",
    "--platform": "platform",
  };
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = names[arguments_[index]];
    const value = arguments_[index + 1];
    if (!name || !value || options[name]) {
      throw new Error("用法：create-macos-experimental-publication.mjs --input <path> --output <path> --version <semver> --base-url <https-url> [--platform <darwin-aarch64|darwin-x86_64>]");
    }
    options[name] = value;
  }
  if (!options.inputDirectory || !options.outputDirectory || !options.version || !options.baseUrl) {
    throw new Error("缺少 macOS experimental package 发布参数。");
  }
  options.platform ??= "darwin-x86_64";
  return options;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const result = await createMacosExperimentalPublication(parseArguments(process.argv.slice(2)));
    console.log(`已生成 ${result.descriptor.platform} experimental immutable publication。`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
