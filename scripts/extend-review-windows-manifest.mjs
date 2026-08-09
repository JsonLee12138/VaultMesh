import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const PLATFORM = "windows-x86_64";

export async function extendReviewWindowsManifest({
  currentManifestPath,
  descriptorPath,
  signaturePath,
  outputPath,
  version,
  baseUrl,
}) {
  if (!isReviewVersion(version)) {
    throw new Error("Windows 阶段性 Review 版本必须使用 <major>.<minor>.<patch>-review[.<n>] 格式。");
  }
  const current = JSON.parse(await readFile(currentManifestPath, "utf8"));
  validateCurrentManifest(current, version);
  const descriptor = JSON.parse(await readFile(descriptorPath, "utf8"));
  validateDescriptor(descriptor, version);
  const signature = (await readFile(signaturePath, "utf8")).trim();
  if (!signature || signature.length > 16_384) {
    throw new Error("Windows Review updater signature 无效。");
  }
  const normalizedBaseUrl = validateBaseUrl(baseUrl);
  const artifactPrefix = `experimental/windows/v${version}`;
  const manifest = {
    ...current,
    platforms: {
      ...current.platforms,
      [PLATFORM]: {
        signature,
        url: `${normalizedBaseUrl}/${artifactPrefix}/${encodeURIComponent(descriptor.updateFile)}`,
      },
    },
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return manifest;
}

function validateCurrentManifest(current, version) {
  if (!current || typeof current !== "object" || Array.isArray(current)) {
    throw new Error("当前 Review manifest 必须是 JSON object。");
  }
  if (current.version !== version || !isReviewVersion(current.version)) {
    throw new Error("Windows 平台只能追加到同版本的当前 Review manifest。");
  }
  if (typeof current.notes !== "string" || Number.isNaN(Date.parse(current.pub_date))) {
    throw new Error("当前 Review manifest 的 notes 或 pub_date 无效。");
  }
  if (!current.platforms || typeof current.platforms !== "object" || Array.isArray(current.platforms)) {
    throw new Error("当前 Review manifest 的 platforms 无效。");
  }
  if (Object.hasOwn(current.platforms, PLATFORM)) {
    throw new Error("当前 Review manifest 已包含 windows-x86_64，拒绝覆盖。");
  }
  if (Object.keys(current.platforms).length === 0) {
    throw new Error("Windows 平台追加前必须已有至少一个阶段性 Review 平台。");
  }
  for (const [platform, entry] of Object.entries(current.platforms)) {
    if (!platform || !entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("当前 Review manifest 包含无效平台 entry。");
    }
    if (typeof entry.signature !== "string" || !entry.signature || typeof entry.url !== "string") {
      throw new Error("当前 Review manifest 包含无效平台签名或 URL。");
    }
    let url;
    try {
      url = new URL(entry.url);
    } catch {
      throw new Error("当前 Review manifest 包含无效平台 URL。");
    }
    if (url.protocol !== "https:") {
      throw new Error("当前 Review manifest 平台 URL 必须使用 HTTPS。");
    }
  }
}

function validateDescriptor(descriptor, version) {
  if (descriptor?.platform !== PLATFORM || descriptor.version !== version) {
    throw new Error("Windows Review descriptor 平台或版本不一致。");
  }
  const updateFile = descriptor.updateFile;
  const isArchive = safeName(updateFile) && updateFile.endsWith(".nsis.zip");
  const isInstaller = safeName(updateFile) && updateFile.endsWith("-setup.exe");
  if (!isArchive && !isInstaller) {
    throw new Error("Windows Review updater artifact 文件名无效。");
  }
  if (descriptor.signatureFile !== `${updateFile}.sig`) {
    throw new Error("Windows Review updater signature 文件名不匹配。");
  }
}

function safeName(name) {
  return typeof name === "string" && name === path.basename(name) && /^[A-Za-z0-9._-]+$/.test(name);
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

function isReviewVersion(value) {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-review(?:\.(0|[1-9]\d*))?$/.test(value);
}

function parseArguments(arguments_) {
  const options = {};
  const names = {
    "--current": "currentManifestPath",
    "--descriptor": "descriptorPath",
    "--signature": "signaturePath",
    "--output": "outputPath",
    "--version": "version",
    "--base-url": "baseUrl",
  };
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = names[arguments_[index]];
    const value = arguments_[index + 1];
    if (!name || value === undefined || options[name] !== undefined) {
      throw new Error("用法：extend-review-windows-manifest.mjs --current <latest.json> --descriptor <path> --signature <path> --output <path> --version <semver> --base-url <https-url>");
    }
    options[name] = value;
  }
  if (Object.keys(names).some((flag) => !options[names[flag]])) {
    throw new Error("缺少 Windows Review manifest 追加参数。");
  }
  return options;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    await extendReviewWindowsManifest(parseArguments(process.argv.slice(2)));
    console.log("已把 Windows x64 追加到阶段性 Review manifest。");
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
