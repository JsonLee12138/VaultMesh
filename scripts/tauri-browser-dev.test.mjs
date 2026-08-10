import assert from 'node:assert/strict';
import test from 'node:test';

import { developmentExtensionId, developmentExtensionKey, firefoxExtensionId } from './browser-identity.mjs';
import {
  browserDevelopmentEnvironment,
  defaultBrowserDevelopmentProfile,
  startBrowserDevelopment,
} from './tauri-browser-dev.mjs';
import { debugTauriHost, startTauriDevelopment } from './tauri-dev-launch.mjs';
import { tauriHostName, tauriMacOSBrowserHostPlan } from './tauri-macos-browser-host-config.mjs';

test('CT-BROWSER-001 propagates one fixed identity to WXT and the Tauri Host', () => {
  const environment = browserDevelopmentEnvironment({ PATH: '/usr/bin' });
  const plan = tauriMacOSBrowserHostPlan({
    userHome: '/Users/tester',
    temporaryDirectory: '/tmp',
    nativeHostPath: debugTauriHost,
    extensionId: environment.VAULTMESH_BROWSER_EXTENSION_ID,
    firefoxExtensionId,
    browserProfile: environment.VAULTMESH_BROWSER_PROFILE,
  });

  assert.equal(environment.WXT_CHROME_EXTENSION_KEY, developmentExtensionKey);
  assert.equal(environment.VAULTMESH_BROWSER_EXTENSION_ID, developmentExtensionId);
  assert.equal(environment.VAULTMESH_FIREFOX_EXTENSION_ID, firefoxExtensionId);
  assert.equal(environment.WXT_NATIVE_HOST_NAME, tauriHostName);
  assert.equal(environment.VAULTMESH_BROWSER_PROFILE, defaultBrowserDevelopmentProfile);
  assert.ok(plan.manifestDirectories.has(
    `${defaultBrowserDevelopmentProfile}/NativeMessagingHosts`,
  ));
  assert.deepEqual(JSON.parse(plan.manifest).allowed_origins, [
    `chrome-extension://${developmentExtensionId}/`,
  ]);
  assert.deepEqual(JSON.parse(plan.firefoxManifest).allowed_extensions, [firefoxExtensionId]);
  assert.match(plan.firefoxManifestPath, /Mozilla\/NativeMessagingHosts\/com\.vaultmesh\.browser\.json$/);
  assert.equal(JSON.parse(plan.config).version, 2);
});

test('CT-BROWSER-001 rejects an ID that does not derive from the configured key', () => {
  assert.throws(() => browserDevelopmentEnvironment({
    WXT_CHROME_EXTENSION_KEY: developmentExtensionKey,
    VAULTMESH_BROWSER_EXTENSION_ID: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  }), /VAULTMESH_BROWSER_EXTENSION_ID 与 manifest key 不匹配/);
});

test('CT-BROWSER-001 starts Tauri dev before WXT and cleans up both processes', async () => {
  const calls = [];
  const tauriCompletion = new Promise(() => {});
  const result = await startBrowserDevelopment({
    baseEnvironment: { PATH: '/usr/bin' },
    startTauri: async (options) => {
      calls.push(['tauri', options]);
      return {
        nativeHostPath: debugTauriHost,
        completion: tauriCompletion,
        stop: async () => { calls.push(['tauri-stop']); },
      };
    },
    verifyHost: async (options) => { calls.push(['verify', options]); },
    startExtension: (environment) => {
      calls.push(['extension', environment]);
      return {
        completion: Promise.resolve({ code: 0, signal: null }),
        stop: async () => { calls.push(['extension-stop']); },
      };
    },
    logger: { log() {} },
  });

  assert.equal(result, 0);
  assert.equal(calls[0][0], 'tauri');
  assert.equal(calls[1][0], 'verify');
  assert.equal(calls[2][0], 'extension');
  assert.equal(calls[3][0], 'extension-stop');
  assert.equal(calls[4][0], 'tauri-stop');
  assert.equal(calls[0][1].extensionId, developmentExtensionId);
  assert.equal(calls[0][1].environment, calls[1][1].environment);
  assert.equal(calls[1][1].environment, calls[2][1]);
  assert.equal(calls[1][1].nativeHostPath, debugTauriHost);
});

test('CT-BROWSER-001 prepares the debug Host before starting Tauri dev', async () => {
  const calls = [];
  const handle = {
    completion: new Promise(() => {}),
    exited: false,
    stop: async () => { calls.push('stop'); },
  };
  const result = await startTauriDevelopment({
    extensionId: developmentExtensionId,
    environment: { PATH: '/usr/bin' },
    logger: { log() {} },
    buildHost: async () => { calls.push('build-host'); },
    prepareRuntime: async () => { calls.push('prepare-runtime'); },
    startProcess: () => { calls.push('tauri:dev'); return handle; },
    waitForReady: async () => { calls.push('broker-ready'); },
    registerHost: async (options) => { calls.push(['register-host', options]); },
  });

  assert.deepEqual(calls.slice(0, 4), [
    'build-host',
    'prepare-runtime',
    'tauri:dev',
    'broker-ready',
  ]);
  assert.equal(calls[4][0], 'register-host');
  assert.equal(calls[4][1].extensionId, developmentExtensionId);
  assert.equal(result.nativeHostPath, debugTauriHost);
});
