import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  developmentExtensionKey,
  extensionIdFromKey,
} from './browser-identity.mjs';
import { verifyBrowserHost } from './tauri-browser-host-probe.mjs';
import { startManagedProcess } from './development-process.mjs';
import { startTauriDevelopment } from './tauri-dev-launch.mjs';
import { tauriHostName } from './tauri-macos-browser-host-config.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const defaultBrowserDevelopmentProfile = path.join(
  process.platform === 'win32'
    ? (process.env.APPDATA ?? path.join(homedir(), 'AppData', 'Roaming'))
    : path.join(homedir(), 'Library', 'Application Support'),
  'com.vaultmesh.desktop',
  'browser-development-profile',
);

export function browserDevelopmentEnvironment(baseEnvironment = process.env) {
  const extensionKey = baseEnvironment.WXT_CHROME_EXTENSION_KEY ?? developmentExtensionKey;
  const derivedExtensionId = extensionIdFromKey(extensionKey);
  const extensionId = baseEnvironment.VAULTMESH_BROWSER_EXTENSION_ID ?? derivedExtensionId;
  if (extensionId !== derivedExtensionId) {
    throw new Error('VAULTMESH_BROWSER_EXTENSION_ID 与 manifest key 不匹配。');
  }

  const hostName = baseEnvironment.WXT_NATIVE_HOST_NAME ?? tauriHostName;
  if (hostName !== tauriHostName) {
    throw new Error(`WXT_NATIVE_HOST_NAME 必须为 ${tauriHostName}。`);
  }

  return {
    ...baseEnvironment,
    VAULTMESH_BROWSER_PROFILE:
      baseEnvironment.VAULTMESH_BROWSER_PROFILE ?? defaultBrowserDevelopmentProfile,
    WXT_CHROME_EXTENSION_KEY: extensionKey,
    WXT_NATIVE_HOST_NAME: hostName,
    VAULTMESH_BROWSER_EXTENSION_ID: extensionId,
  };
}

export async function startBrowserDevelopment({
  baseEnvironment = process.env,
  signal,
  startTauri = startTauriDevelopment,
  verifyHost = ({ extensionId, nativeHostPath }) => verifyBrowserHost({
    nativeHostPath,
    extensionId,
  }),
  startExtension = startExtensionProcess,
  logger = console,
} = {}) {
  const environment = browserDevelopmentEnvironment(baseEnvironment);
  const tauri = await startTauri({
    extensionId: environment.VAULTMESH_BROWSER_EXTENSION_ID,
    environment,
    logger,
  });
  let extension;
  try {
    await verifyHost({
      extensionId: environment.VAULTMESH_BROWSER_EXTENSION_ID,
      environment,
      nativeHostPath: tauri.nativeHostPath,
    });
    logger.log(`Tauri dev 与 Rust Host 已就绪；正在启动固定 ID 扩展：${environment.VAULTMESH_BROWSER_EXTENSION_ID}`);
    extension = startExtension(environment);
    const outcome = await Promise.race([
      processOutcome('tauri:dev', tauri.completion),
      processOutcome('extension:dev', extension.completion),
      abortOutcome(signal),
    ]);
    if (outcome.kind === 'abort') return 130;
    return exitCodeFor(outcome.result);
  } finally {
    await Promise.allSettled([
      extension?.stop(),
      tauri.stop(),
    ]);
  }
}

function startExtensionProcess(environment) {
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  return startManagedProcess(pnpm, ['extension:dev'], {
    cwd: projectRoot,
    environment,
    label: 'extension:dev',
  });
}

async function processOutcome(processName, completion) {
  return { kind: 'process', processName, result: await completion };
}

function abortOutcome(signal) {
  if (!signal) return new Promise(() => {});
  if (signal.aborted) return Promise.resolve({ kind: 'abort' });
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve({ kind: 'abort' }), { once: true });
  });
}

function exitCodeFor(result) {
  if (typeof result.code === 'number') return result.code;
  return result.signal === 'SIGINT' ? 130 : 1;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort('SIGINT'));
  process.once('SIGTERM', () => controller.abort('SIGTERM'));
  try {
    process.exitCode = await startBrowserDevelopment({ signal: controller.signal });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
