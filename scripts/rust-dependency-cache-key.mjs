import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultWorkspaceRoot = path.resolve(path.dirname(scriptPath), "..");
const normalizedWorkspaceVersion = 'version = "<workspace-version>"';

export function normalizeWorkspaceManifest(source) {
  let table = "";

  return source
    .split(/(?<=\n)/u)
    .map((line) => {
      const tableMatch = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?(?:\r?\n)?$/u);
      if (tableMatch) {
        table = tableMatch[1];
        return line;
      }

      if ((table === "package" || table === "workspace.package") && /^\s*version\s*=\s*"[^"]+"/u.test(line)) {
        const newline = line.endsWith("\r\n") ? "\r\n" : line.endsWith("\n") ? "\n" : "";
        return `${normalizedWorkspaceVersion}${newline}`;
      }

      return line;
    })
    .join("");
}

export function normalizeCargoLock(source, workspacePackageNames) {
  const workspaceNames = new Set(workspacePackageNames);

  return source
    .split(/(?=^\[\[package\]\]\s*$)/mu)
    .map((block) => {
      const name = block.match(/^name = "([^"]+)"\s*$/mu)?.[1];
      const hasExternalSource = /^source = /mu.test(block);
      if (!name || hasExternalSource || !workspaceNames.has(name)) {
        return block;
      }
      return block.replace(/^version = "[^"]+"\s*$/mu, normalizedWorkspaceVersion);
    })
    .join("");
}

export function hashDependencyInputs(entries) {
  const hash = createHash("sha256");
  for (const entry of [...entries].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))) {
    hash.update(entry.path);
    hash.update("\0");
    hash.update(entry.content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function computeDependencyCacheKey(workspaceRoot = defaultWorkspaceRoot) {
  const metadata = JSON.parse(
    execFileSync("cargo", ["metadata", "--locked", "--no-deps", "--format-version", "1"], {
      cwd: workspaceRoot,
      encoding: "utf8",
    }),
  );
  const workspaceMembers = new Set(metadata.workspace_members);
  const workspacePackages = metadata.packages.filter((candidate) => workspaceMembers.has(candidate.id));
  const workspacePackageNames = workspacePackages.map((candidate) => candidate.name);
  const manifestPaths = new Set([
    path.join(workspaceRoot, "Cargo.toml"),
    ...workspacePackages.map((candidate) => candidate.manifest_path),
  ]);
  const entries = [...manifestPaths].map((manifestPath) => ({
    path: path.relative(workspaceRoot, manifestPath).split(path.sep).join("/"),
    content: normalizeWorkspaceManifest(readFileSync(manifestPath, "utf8")),
  }));

  const lockPath = path.join(workspaceRoot, "Cargo.lock");
  entries.push({
    path: "Cargo.lock",
    content: normalizeCargoLock(readFileSync(lockPath, "utf8"), workspacePackageNames),
  });

  for (const relativePath of ["rust-toolchain.toml", ".cargo/config.toml"]) {
    const inputPath = path.join(workspaceRoot, relativePath);
    if (existsSync(inputPath)) {
      entries.push({ path: relativePath, content: readFileSync(inputPath, "utf8") });
    }
  }

  return hashDependencyInputs(entries);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const digest = computeDependencyCacheKey();
  if (process.argv.includes("--github-output")) {
    if (!process.env.GITHUB_OUTPUT) {
      throw new Error("GITHUB_OUTPUT is required with --github-output.");
    }
    appendFileSync(process.env.GITHUB_OUTPUT, `hash=${digest}\n`, "utf8");
  } else {
    process.stdout.write(`${digest}\n`);
  }
}
