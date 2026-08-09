import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const requiredPlatforms = ["darwin-aarch64", "darwin-x86_64", "windows-x86_64"];

export async function createUpdatePublication({ inputDirectory, outputDirectory, version, baseUrl, notes = "VaultMesh update", pubDate = new Date().toISOString(), currentManifestPath }) {
  if (!isSemver(version)) throw new Error("更新版本必须是规范 SemVer。");
  if (typeof notes !== "string" || notes.length > 4_000) throw new Error("更新说明无效或过长。");
  if (Number.isNaN(Date.parse(pubDate))) throw new Error("pub_date 必须是 RFC 3339 时间。");
  const normalizedBaseUrl = validateBaseUrl(baseUrl);
  if (currentManifestPath) {
    const current = JSON.parse(await readFile(currentManifestPath, "utf8"));
    if (!isSemver(current.version) || compareSemver(version, current.version) <= 0) {
      throw new Error("新更新版本必须严格高于当前 channel 版本。");
    }
  }
  const descriptorFiles = (await readdir(inputDirectory)).filter((file) => file.endsWith(".update.json"));
  const descriptors = [];
  for (const file of descriptorFiles) {
    descriptors.push(JSON.parse(await readFile(path.join(inputDirectory, file), "utf8")));
  }
  validateDescriptors(descriptors, version);

  const platforms = {};
  const immutableFiles = new Map();
  for (const descriptor of descriptors) {
    const updatePath = await validatedFile(inputDirectory, descriptor.updateFile);
    const signaturePath = await validatedFile(inputDirectory, descriptor.signatureFile);
    const signature = (await readFile(signaturePath, "utf8")).trim();
    if (!signature || signature.length > 16_384) throw new Error(`${descriptor.platform} updater signature 无效。`);
    const releasePrefix = `releases/v${version}`;
    platforms[descriptor.platform] = {
      signature,
      url: `${normalizedBaseUrl}/${releasePrefix}/${encodeURIComponent(descriptor.updateFile)}`,
    };
    immutableFiles.set(descriptor.updateFile, updatePath);
    immutableFiles.set(descriptor.signatureFile, signaturePath);
    for (const installer of descriptor.installers) {
      immutableFiles.set(installer, await validatedFile(inputDirectory, installer));
    }
  }

  const manifest = { version, notes, pub_date: pubDate, platforms };
  await mkdir(outputDirectory, { recursive: true });
  const manifestPath = path.join(outputDirectory, "latest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  const lines = [];
  for (const [name, source] of [...immutableFiles.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`${source}\treleases/v${version}/${name}\t${contentType(name)}\t${await sha256File(source)}`);
  }
  await writeFile(path.join(outputDirectory, "immutable.tsv"), `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
  return { manifest, manifestPath, immutableFiles: [...immutableFiles.keys()] };
}

function validateDescriptors(descriptors, version) {
  if (descriptors.length !== requiredPlatforms.length) throw new Error("更新发布必须恰好包含三个目标平台。");
  const seen = new Set();
  for (const descriptor of descriptors) {
    if (!requiredPlatforms.includes(descriptor.platform) || seen.has(descriptor.platform)) throw new Error("更新平台未知或重复。");
    seen.add(descriptor.platform);
    if (descriptor.version !== version) throw new Error(`${descriptor.platform} artifact 版本不一致。`);
    if (!safeName(descriptor.updateFile) || !safeName(descriptor.signatureFile)) throw new Error("Artifact 文件名无效。");
    if (!Array.isArray(descriptor.installers) || descriptor.installers.length < 1 || descriptor.installers.some((name) => !safeName(name))) {
      throw new Error(`${descriptor.platform} installer 清单无效。`);
    }
  }
}

function validateBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("R2 public base URL 无效。");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("R2 public base URL 必须是不含凭据、query 或 fragment 的 HTTPS URL。");
  return url.toString().replace(/\/$/, "");
}

async function validatedFile(directory, name) {
  if (!safeName(name)) throw new Error("Artifact 文件名无效。");
  const file = path.join(directory, name);
  if (!(await stat(file)).isFile()) throw new Error(`Artifact 不是普通文件：${name}`);
  return file;
}

function safeName(name) {
  return typeof name === "string" && name === path.basename(name) && /^[A-Za-z0-9._-]+$/.test(name);
}

function contentType(name) {
  if (name.endsWith(".json")) return "application/json";
  if (name.endsWith(".dmg")) return "application/x-apple-diskimage";
  if (name.endsWith(".exe")) return "application/vnd.microsoft.portable-executable";
  if (name.endsWith(".gz")) return "application/gzip";
  if (name.endsWith(".zip")) return "application/zip";
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

function compareSemver(left, right) {
  const parse = (value) => {
    const [core, prerelease] = value.split("-", 2);
    return { core: core.split(".").map(Number), prerelease: prerelease?.split(".") };
  };
  const leftVersion = parse(left);
  const rightVersion = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftVersion.core[index] !== rightVersion.core[index]) return leftVersion.core[index] > rightVersion.core[index] ? 1 : -1;
  }
  if (!leftVersion.prerelease && !rightVersion.prerelease) return 0;
  if (!leftVersion.prerelease) return 1;
  if (!rightVersion.prerelease) return -1;
  const count = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length);
  for (let index = 0; index < count; index += 1) {
    const leftPart = leftVersion.prerelease[index];
    const rightPart = rightVersion.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) > Number(rightPart) ? 1 : -1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

function parseArguments(arguments_) {
  const options = {};
  const names = { "--input": "inputDirectory", "--output": "outputDirectory", "--version": "version", "--base-url": "baseUrl", "--notes": "notes", "--current": "currentManifestPath" };
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = names[arguments_[index]];
    const value = arguments_[index + 1];
    if (!name || value === undefined || options[name] !== undefined) throw new Error("用法：create-update-manifest.mjs --input <path> --output <path> --version <semver> --base-url <https-url> [--notes <text>]");
    options[name] = value;
  }
  if (!options.inputDirectory || !options.outputDirectory || !options.version || !options.baseUrl) throw new Error("缺少更新清单参数。");
  return options;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const result = await createUpdatePublication(parseArguments(process.argv.slice(2)));
    console.log(`已生成 ${Object.keys(result.manifest.platforms).length} 平台更新清单。`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
