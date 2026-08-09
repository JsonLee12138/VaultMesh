import { access, readFile, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startManagedProcess, runOneShot } from './development-process.mjs';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
export const debugTauriHost = path.join(
  workspaceRoot,
  'target',
  'debug',
  process.platform === 'win32' ? 'vaultmesh-native-host.exe' : 'vaultmesh-native-host',
);

export async function startTauriDevelopment({
  extensionId,
  environment = process.env,
  logger = console,
  buildHost = buildDebugNativeHost,
  prepareRuntime = prepareDevelopmentRuntime,
  startProcess = startTauriProcess,
  registerHost = registerDebugNativeHost,
  waitForReady = waitForDevelopmentBroker,
} = {}) {
  await buildHost(environment);
  await prepareRuntime(environment);
  const startedAt = Date.now();
  const processHandle = startProcess(environment);
  try {
    await waitForReady({ processHandle, startedAt });
    await registerHost({ extensionId, environment });
    logger.log(`Tauri 开发 Broker 已就绪；debug Native Host：${debugTauriHost}`);
    return { ...processHandle, nativeHostPath: debugTauriHost };
  } catch (error) {
    await processHandle.stop();
    throw error;
  }
}

async function buildDebugNativeHost(environment) {
  await runOneShot('cargo', [
    'build',
    '-p',
    'vaultmesh-tauri-desktop',
    '--bin',
    'vaultmesh-native-host',
  ], { cwd: workspaceRoot, environment });
  await access(debugTauriHost);
}

async function prepareDevelopmentRuntime(environment) {
  if (process.platform === 'darwin') {
    await runOneShot('/usr/bin/osascript', [
      '-e',
      'tell application "VaultMesh" to quit',
    ], { environment, ignoreFailure: true, stdio: 'ignore' });
    await new Promise((resolve) => setTimeout(resolve, 750));
    await runOneShot('/usr/bin/security', [
      'delete-generic-password',
      '-s',
      'com.vaultmesh.desktop.browser-pairing',
      '-a',
      'native-host-hmac-v1',
    ], { environment, ignoreFailure: true, stdio: 'ignore' });
  } else if (process.platform === 'win32') {
    await runOneShot('taskkill.exe', [
      '/IM',
      'VaultMesh.exe',
      '/F',
    ], { environment, ignoreFailure: true, stdio: 'ignore' });
    await new Promise((resolve) => setTimeout(resolve, 500));
  } else {
    throw new Error('browser:dev 的 Tauri/Native Host 编排仅支持 macOS 和 Windows。');
  }
  await rm(path.join(
    platformAppDataRoot(),
    'com.vaultmesh.desktop',
    'browser-pairing.json',
  ), { force: true });
}

function startTauriProcess(environment) {
  return startManagedProcess(pnpm, ['tauri:dev'], {
    cwd: workspaceRoot,
    environment,
    label: 'tauri:dev',
  });
}

async function registerDebugNativeHost({ extensionId, environment }) {
  if (process.platform === 'win32') return;
  await runOneShot(process.execPath, [
    path.resolve(import.meta.dirname, 'tauri-macos-browser-host.mjs'),
  ], {
    cwd: workspaceRoot,
    environment: {
      ...environment,
      VAULTMESH_BROWSER_EXTENSION_ID: extensionId,
      VAULTMESH_TAURI_NATIVE_HOST: debugTauriHost,
    },
  });
}

async function waitForDevelopmentBroker({ processHandle, startedAt }) {
  const appData = path.join(
    platformAppDataRoot(),
    'com.vaultmesh.desktop',
  );
  const pairingRecord = path.join(appData, 'browser-pairing.json');
  const hostConfig = path.join(appData, 'browser-host-config.json');
  const hostManifest = path.join(appData, 'com.vaultmesh.browser.json');
  const socket = path.join(tmpdir(), 'vaultmesh-tauri-browser.sock');
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (processHandle.exited) throw new Error('tauri:dev 在 Broker 就绪前退出。');
    try {
      const [record, metadata, config] = await Promise.all([
        readFile(pairingRecord, 'utf8').then(JSON.parse),
        stat(pairingRecord),
        process.platform === 'win32'
          ? readFile(hostConfig, 'utf8').then(JSON.parse)
          : access(socket).then(() => null),
        ...(process.platform === 'win32' ? [access(hostManifest)] : []),
      ]);
      if (record.version === 1
        && record.enabled === true
        && (process.platform !== 'win32'
          || config.brokerPipe === '\\\\.\\pipe\\VaultMesh.BrowserBroker.v2')
        && metadata.mtimeMs >= startedAt - 1_000) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('tauri:dev 已启动，但浏览器 Broker 未在 60 秒内就绪。');
}

function platformAppDataRoot() {
  if (process.platform === 'win32') {
    return process.env.APPDATA ?? path.join(homedir(), 'AppData', 'Roaming');
  }
  return path.join(homedir(), 'Library', 'Application Support');
}
