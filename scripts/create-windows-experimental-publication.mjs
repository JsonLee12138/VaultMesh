import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const PLATFORM = "windows-x86_64";

export async function createWindowsExperimentalPublication({ inputDirectory, outputDirectory, version, baseUrl }) {
  if (!isSemver(version)) throw new Error("Windows experimental 版本必须是规范 SemVer。");
  const normalizedBaseUrl = validateBaseUrl(baseUrl);
  const descriptorFiles = (await readdir(inputDirectory)).filter((file) => file.endsWith(".update.json"));
  if (descriptorFiles.length !== 1 || descriptorFiles[0] !== `${PLATFORM}.update.json`) {
    throw new Error("Windows experimental package 必须且只能包含一个 windows-x86_64 descriptor。");
  }
  const descriptorPath = path.join(inputDirectory, descriptorFiles[0]);
  const descriptor = JSON.parse(await readFile(descriptorPath, "utf8"));
  validateDescriptor(descriptor, version);

  const files = new Map();
  files.set(descriptorFiles[0], descriptorPath);
  files.set(descriptor.updateFile, await validatedFile(inputDirectory, descriptor.updateFile));
  files.set(descriptor.signatureFile, await validatedFile(inputDirectory, descriptor.signatureFile));
  for (const installer of descriptor.installers) {
    files.set(installer, await validatedFile(inputDirectory, installer));
  }
  const signature = (await readFile(files.get(descriptor.signatureFile), "utf8")).trim();
  if (!signature || signature.length > 16_384) throw new Error("Windows updater signature 无效。");

  const prefix = `experimental/windows/v${version}`;
  const lines = [];
  for (const [name, source] of [...files.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`${source}\t${prefix}/${name}\t${contentType(name)}\t${await sha256File(source)}`);
  }
  const links = {
    installer: `${normalizedBaseUrl}/${prefix}/${encodeURIComponent(nsisInstaller(descriptor))}`,
    msiInstaller: descriptor.installers.find((installer) => installer.endsWith(".msi"))
      ? `${normalizedBaseUrl}/${prefix}/${encodeURIComponent(descriptor.installers.find((installer) => installer.endsWith(".msi")))}`
      : null,
    updaterArtifact: `${normalizedBaseUrl}/${prefix}/${encodeURIComponent(descriptor.updateFile)}`,
    updaterSignature: `${normalizedBaseUrl}/${prefix}/${encodeURIComponent(descriptor.signatureFile)}`,
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

function validateDescriptor(descriptor, version) {
  if (descriptor?.platform !== PLATFORM || descriptor.version !== version) {
    throw new Error("Windows experimental package descriptor 平台或版本不一致。");
  }
  const updaterIsArchive = safeName(descriptor.updateFile) && descriptor.updateFile.endsWith(".nsis.zip");
  const updaterIsInstaller = safeName(descriptor.updateFile) && descriptor.updateFile.endsWith("-setup.exe");
  if (!updaterIsArchive && !updaterIsInstaller) {
    throw new Error("Windows updater artifact 必须是安全的 NSIS archive 或 setup EXE 文件名。");
  }
  if (descriptor.signatureFile !== `${descriptor.updateFile}.sig`) {
    throw new Error("Windows updater signature 文件名不匹配。");
  }
  if (!Array.isArray(descriptor.installers) || ![1, 2].includes(descriptor.installers.length)) {
    throw new Error("Windows experimental package 必须包含 NSIS installer，并且最多包含一个 MSI installer。");
  }
  if (descriptor.installers.some((installer) => !safeName(installer))) {
    throw new Error("Windows experimental installer 文件名无效。");
  }
  const nsisInstallers = descriptor.installers.filter((installer) => installer.endsWith("-setup.exe"));
  const msiInstallers = descriptor.installers.filter((installer) => installer.endsWith(".msi"));
  if (nsisInstallers.length !== 1 || msiInstallers.length !== descriptor.installers.length - 1) {
    throw new Error("Windows experimental package 必须包含一个 NSIS installer，并且最多包含一个 MSI installer。");
  }
  if (updaterIsInstaller && nsisInstallers[0] !== descriptor.updateFile) {
    throw new Error("Windows setup EXE updater 必须与 NSIS installer 是同一文件。");
  }
}

function nsisInstaller(descriptor) {
  return descriptor.installers.find((installer) => installer.endsWith("-setup.exe"));
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
  if (!safeName(name)) throw new Error("Windows experimental package 文件名无效。");
  const file = path.join(directory, name);
  if (!(await stat(file)).isFile()) throw new Error(`Windows experimental package 文件不是普通文件：${name}`);
  return file;
}

function safeName(name) {
  return typeof name === "string" && name === path.basename(name) && /^[A-Za-z0-9._-]+$/.test(name);
}

function contentType(name) {
  if (name.endsWith(".json")) return "application/json";
  if (name.endsWith(".exe")) return "application/vnd.microsoft.portable-executable";
  if (name.endsWith(".msi")) return "application/x-msi";
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

function parseArguments(arguments_) {
  const options = {};
  const names = {
    "--input": "inputDirectory",
    "--output": "outputDirectory",
    "--version": "version",
    "--base-url": "baseUrl",
  };
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = names[arguments_[index]];
    const value = arguments_[index + 1];
    if (!name || !value || options[name]) {
      throw new Error("用法：create-windows-experimental-publication.mjs --input <path> --output <path> --version <semver> --base-url <https-url>");
    }
    options[name] = value;
  }
  if (!options.inputDirectory || !options.outputDirectory || !options.version || !options.baseUrl) {
    throw new Error("缺少 Windows experimental package 发布参数。");
  }
  return options;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const result = await createWindowsExperimentalPublication(parseArguments(process.argv.slice(2)));
    console.log(`已生成 ${result.descriptor.platform} experimental immutable publication。`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
