import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const BASELINE_VERSION = "0.0.1-review";
const BASELINE_PLATFORM = "darwin-x86_64";

export async function createReviewBaselineManifest({
  descriptorPath,
  signaturePath,
  outputPath,
  version,
  baseUrl,
  notes = "VaultMesh Intel macOS Review baseline.",
  pubDate = new Date().toISOString(),
  currentManifestPath,
}) {
  if (!isReviewVersion(version)) {
    throw new Error("阶段性 Review 版本必须使用 <major>.<minor>.<patch>-review[.<n>] 格式。");
  }
  if (currentManifestPath) {
    const current = JSON.parse(await readFile(currentManifestPath, "utf8"));
    if (!isReviewVersion(current.version) || compareSemver(version, current.version) <= 0) {
      throw new Error("阶段性 Review 更新版本必须严格高于当前 channel 版本。");
    }
  } else if (version !== BASELINE_VERSION) {
    throw new Error(`缺失 Review channel 必须从 ${BASELINE_VERSION} 开始。`);
  }
  if (typeof notes !== "string" || notes.length === 0 || notes.length > 4_000) {
    throw new Error("Review baseline 更新说明无效或过长。");
  }
  if (Number.isNaN(Date.parse(pubDate))) {
    throw new Error("Review baseline pub_date 必须是 RFC 3339 时间。");
  }
  const normalizedBaseUrl = validateBaseUrl(baseUrl);
  const descriptor = JSON.parse(await readFile(descriptorPath, "utf8"));
  validateDescriptor(descriptor, version);
  const signature = (await readFile(signaturePath, "utf8")).trim();
  if (!signature || signature.length > 16_384) {
    throw new Error("Review baseline updater signature 无效。");
  }

  const artifactPrefix = `experimental/macos/${BASELINE_PLATFORM}/v${version}`;
  const manifest = {
    version,
    notes,
    pub_date: pubDate,
    platforms: {
      [BASELINE_PLATFORM]: {
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

function validateDescriptor(descriptor, version) {
  if (descriptor?.platform !== BASELINE_PLATFORM || descriptor.version !== version) {
    throw new Error("Review baseline descriptor 平台或版本不一致。");
  }
  if (!safeName(descriptor.updateFile) || !descriptor.updateFile.endsWith(".app.tar.gz")) {
    throw new Error("Review baseline updater artifact 文件名无效。");
  }
  if (descriptor.signatureFile !== `${descriptor.updateFile}.sig`) {
    throw new Error("Review baseline updater signature 文件名不匹配。");
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

function compareSemver(left, right) {
  const parse = (value) => {
    const [core, prerelease] = value.split("-", 2);
    return { core: core.split(".").map(Number), prerelease: prerelease.split(".") };
  };
  const leftVersion = parse(left);
  const rightVersion = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftVersion.core[index] !== rightVersion.core[index]) {
      return leftVersion.core[index] > rightVersion.core[index] ? 1 : -1;
    }
  }
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
  const names = {
    "--descriptor": "descriptorPath",
    "--signature": "signaturePath",
    "--output": "outputPath",
    "--version": "version",
    "--base-url": "baseUrl",
    "--notes": "notes",
    "--current": "currentManifestPath",
  };
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = names[arguments_[index]];
    const value = arguments_[index + 1];
    if (!name || value === undefined || options[name] !== undefined) {
      throw new Error("用法：create-review-baseline-manifest.mjs --descriptor <path> --signature <path> --output <path> --version <semver> --base-url <https-url> [--notes <text>] [--current <latest.json>]");
    }
    options[name] = value;
  }
  if (!options.descriptorPath || !options.signaturePath || !options.outputPath || !options.version || !options.baseUrl) {
    throw new Error("缺少 Review baseline manifest 参数。");
  }
  return options;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    await createReviewBaselineManifest(parseArguments(process.argv.slice(2)));
    console.log("已生成 Intel macOS 阶段性 Review manifest。");
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
