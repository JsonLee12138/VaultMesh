import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootPackage = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
const removedRoots = [
  'apps/desktop',
  'apps/desktop-cli',
  'apps/macos',
  'apps/macos-cli',
  'apps/windows',
  'apps/native-host',
  'crates/electron-bridge',
];

for (const relativePath of removedRoots) {
  try {
    await access(path.join(projectRoot, relativePath));
    throw new Error(`已移除的源码目录仍存在：${relativePath}`);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
    throw error;
  }
}

const retiredCommands = [
  'electron:dev',
  'electron:build',
  'electron:make',
  'electron:test',
  'electron:typecheck',
  'native:macos:build',
  'native:macos:launch',
  'native:ffi:build',
  'native:ffi:check',
  'native:ffi:test',
  'desktop:make',
  'tauri:local:uninstall',
  'local:uninstall',
];
for (const command of retiredCommands) {
  if (Object.hasOwn(rootPackage.scripts, command)) throw new Error(`已退役命令仍存在：${command}`);
}
for (const [command, implementation] of Object.entries(rootPackage.scripts)) {
  const scriptMatch = implementation.match(/(?:^|\s)node (scripts\/[^\s]+)/);
  if (!scriptMatch) continue;
  try {
    await access(path.join(projectRoot, scriptMatch[1]));
  } catch {
    throw new Error(`命令 ${command} 引用不存在的脚本：${scriptMatch[1]}`);
  }
}

const localPackageScript = await readFile(path.join(projectRoot, 'scripts/tauri-local-package.mjs'), 'utf8');
for (const staleBehavior of ['sourceVault', 'destinationVault', 'electron-replacement-backup', 'Electron Vault']) {
  if (localPackageScript.includes(staleBehavior)) {
    throw new Error(`Tauri 本地打包脚本仍包含旧 replacement 行为：${staleBehavior}`);
  }
}

const tauriMain = await readFile(
  path.join(projectRoot, 'apps/tauri-desktop/src-tauri/src/main.rs'),
  'utf8',
);
if (!tauriMain.includes('#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]')) {
  throw new Error('Tauri Windows release 必须使用 GUI subsystem，避免启动时显示控制台窗口。');
}

const requiredTauriOwners = [
  'apps/tauri-desktop/src/renderer/src/bootstrap.tsx',
  'apps/tauri-desktop/src/shared/api.ts',
  'apps/tauri-desktop/src/shared/contracts.ts',
  'apps/tauri-desktop/src/shared/browser-rpc.ts',
  'apps/tauri-desktop/src/shared/browser-rpc-policy.ts',
  'apps/tauri-desktop/src/shared/agent-capabilities.json',
  'apps/tauri-desktop/src-tauri/src/agent_broker.rs',
  'crates/agent-mcp/src/main.rs',
  'apps/tauri-desktop/resources/icon.png',
  'apps/tauri-desktop/tests/shared/browser-rpc-policy.test.ts',
];
for (const relativePath of requiredTauriOwners) {
  await access(path.join(projectRoot, relativePath));
}

const tauriFiles = await collectFiles(path.join(projectRoot, 'apps/tauri-desktop'));
const stalePathPattern = /apps\/(?:desktop|macos|windows)|\.\.\/desktop|crates\/electron-bridge/;
for (const filePath of tauriFiles) {
  if (filePath.includes(`${path.sep}node_modules${path.sep}`)
    || filePath.includes(`${path.sep}dist${path.sep}`)) continue;
  const contents = await readFile(filePath, 'utf8').catch(() => undefined);
  if (contents && stalePathPattern.test(contents)) {
    throw new Error(`Tauri owner 仍引用已删除源码：${path.relative(projectRoot, filePath)}`);
  }
}

const manifests = await Promise.all([
  readFile(path.join(projectRoot, 'package.json'), 'utf8'),
  readFile(path.join(projectRoot, 'pnpm-workspace.yaml'), 'utf8'),
  readFile(path.join(projectRoot, 'pnpm-lock.yaml'), 'utf8'),
  readFile(path.join(projectRoot, 'Cargo.toml'), 'utf8'),
  readFile(path.join(projectRoot, 'Cargo.lock'), 'utf8'),
]);
const manifestText = manifests.join('\n');
const forbiddenOwnerPatterns = [
  /@electron\//,
  /electron-forge/,
  /electron-winstaller/,
  /vaultmesh-electron-bridge/,
  /name = "napi(?:-build|-derive)?"/,
  /crates\/electron-bridge/,
  /apps\/desktop(?:-cli)?/,
  /apps\/(?:macos|windows)/,
];
for (const pattern of forbiddenOwnerPatterns) {
  if (pattern.test(manifestText)) throw new Error(`workspace/lockfile 仍包含旧 owner：${pattern}`);
}

console.log(`CT-TAURI-SOURCE-001 Pass：${removedRoots.length} 个旧 root 已移除，${requiredTauriOwners.length} 个 Tauri owner 已定位，${retiredCommands.length} 个旧命令已退役。`);

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(entryPath));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}
