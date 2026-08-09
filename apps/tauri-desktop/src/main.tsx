const root = document.getElementById('root');
if (!root) throw new Error('未找到应用根节点');

document.documentElement.classList.add('dark');
root.innerHTML =
  '<div class="grid min-h-svh place-items-center text-sm text-muted-foreground">正在打开 VaultMesh…</div>';

const surface = new URLSearchParams(window.location.search).get('surface');

void (surface === 'agent-pairing'
  ? import('./agent-pairing').then(({ bootstrapAgentPairing }) => bootstrapAgentPairing(root))
  : surface === 'agent-unlock'
    ? import('./agent-unlock').then(({ bootstrapAgentUnlock }) => bootstrapAgentUnlock(root))
  : surface === 'agent-authorization'
    ? import('./agent-authorization').then(({ bootstrapAgentAuthorization }) => bootstrapAgentAuthorization(root))
    : import('./tauri-api')
    .then(({ installTauriVaultMeshApi }) => installTauriVaultMeshApi())
    .then(() => import('./renderer/src/bootstrap'))
    .then(({ bootstrap }) => bootstrap(root)))
  .catch((error: unknown) => {
    console.error('Failed to bootstrap VaultMesh', error);
    root.textContent = error instanceof Error ? error.message : 'VaultMesh 启动失败';
  });
