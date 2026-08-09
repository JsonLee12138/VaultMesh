import { backgroundDesktopRpc, DesktopRpcError } from '@/lib/desktop-rpc';
import { rememberedLoginSelection } from '@/lib/autofill-preferences';

type WebAuthenticationProxyApi = typeof browser.webAuthenticationProxy;

/** Connect Chromium's WebAuthn proxy to the encrypted desktop vault. The
 * proxy is attached only while the extension session is unlocked, so locking
 * VaultMesh immediately restores the browser's normal platform authenticator. */
export function installPasskeyProxy() {
  const proxy = (browser as typeof browser & { webAuthenticationProxy?: WebAuthenticationProxyApi }).webAuthenticationProxy;
  let attached = false;
  const cancelled = new Set<number>();

  if (!proxy) return { sync: async () => undefined, detach: async () => undefined };

  proxy.onRequestCanceled.addListener((requestId) => { cancelled.add(requestId); });
  proxy.onIsUvpaaRequest.addListener((request) => {
    void proxy.completeIsUvpaaRequest({ requestId: request.requestId, isUvpaa: attached }).catch(() => undefined);
  });
  proxy.onCreateRequest.addListener((request) => {
    void completeCreate(request.requestId, request.requestDetailsJson, proxy.completeCreateRequest.bind(proxy));
  });
  proxy.onGetRequest.addListener((request) => {
    void complete(request.requestId, 'passkeys.get', request.requestDetailsJson, proxy.completeGetRequest.bind(proxy));
  });

  async function completeCreate(
    requestId: number,
    requestDetailsJson: string,
    finish: (details: { requestId: number; responseJson?: string; error?: { name: string; message: string } }) => Promise<void>,
  ) {
    const loginId = await defaultLoginIdForPasskeyRequest(requestDetailsJson);
    await complete(requestId, 'passkeys.create', requestDetailsJson, finish, loginId ? { loginId } : {});
  }

  async function complete(
    requestId: number,
    operation: 'passkeys.create' | 'passkeys.get',
    requestDetailsJson: string,
    finish: (details: { requestId: number; responseJson?: string; error?: { name: string; message: string } }) => Promise<void>,
    extraInput: Record<string, unknown> = {},
  ) {
    try {
      const result = await backgroundDesktopRpc(operation, { requestDetailsJson, ...extraInput }) as { responseJson?: unknown };
      if (cancelled.delete(requestId)) return;
      if (typeof result.responseJson !== 'string' || result.responseJson.length > 256 * 1024) throw new Error('Invalid Passkey response');
      await finish({ requestId, responseJson: result.responseJson });
    } catch (error) {
      if (cancelled.delete(requestId)) return;
      if (error instanceof DesktopRpcError && error.code === 'unlock-required') void detach();
      await finish({ requestId, error: domException(error) }).catch(() => undefined);
    }
  }

  async function attach() {
    if (attached) return;
    try {
      const error = await proxy.attach();
      attached = !error;
    } catch {
      attached = false;
    }
  }

  async function detach() {
    if (!attached) return;
    attached = false;
    try { await proxy.detach(); } catch { /* extension unload also detaches */ }
  }

  async function sync() {
    try {
      const status = await backgroundDesktopRpc('vault.status') as { unlocked?: unknown };
      if (status.unlocked === true) await attach();
      else await detach();
    } catch {
      await detach();
    }
  }

  return { sync, detach };
}

export async function defaultLoginIdForPasskeyRequest(requestDetailsJson: string): Promise<string | null> {
  if (requestDetailsJson.length < 2 || requestDetailsJson.length > 128 * 1024) return null;
  try {
    const request = JSON.parse(requestDetailsJson) as {
      extensions?: { remoteDesktopClientOverride?: { origin?: unknown } };
    };
    const origin = request.extensions?.remoteDesktopClientOverride?.origin;
    if (typeof origin !== 'string') return null;
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) return null;
    return rememberedLoginSelection(origin);
  } catch {
    return null;
  }
}

function domException(error: unknown) {
  const message = error instanceof Error ? error.message.slice(0, 256) : 'VaultMesh 无法完成 Passkey 请求。';
  if (/算法|安全密钥|largeBlob|不支持/i.test(message)) return { name: 'NotSupportedError', message };
  if (/已存在/i.test(message)) return { name: 'InvalidStateError', message };
  return { name: 'NotAllowedError', message };
}
