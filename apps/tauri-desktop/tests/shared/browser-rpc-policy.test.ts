import { describe, expect, it } from 'vitest';

import { BROWSER_RPC_VERSION, BrowserRpcOperationSchema, type BrowserRpcRequest } from '../../src/shared/browser-rpc';
import { authorizeBrowserRpc, BROWSER_RPC_POLICIES } from '../../src/shared/browser-rpc-policy';

function request(operation: BrowserRpcRequest['operation'], input: Record<string, unknown> = {}): BrowserRpcRequest {
  return {
    kind: 'vaultmesh.rpc', version: BROWSER_RPC_VERSION,
    requestId: '953370ec-4dc7-4c77-a6e0-f2a4f6e37f03',
    issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30_000).toISOString(),
    operation, input,
  };
}

describe('browser RPC command authorization', () => {
  it('assigns every operation an explicit capability policy', () => {
    expect(Object.keys(BROWSER_RPC_POLICIES).sort()).toEqual([...BrowserRpcOperationSchema.options].sort());
  });

  it('allows status and unlock history while locked but rejects protected metadata', () => {
    expect(authorizeBrowserRpc(request('vault.status'), false).authorized).toBe(true);
    expect(authorizeBrowserRpc(request('vault.unlock-history'), false).authorized).toBe(true);
    expect(authorizeBrowserRpc(request('items.list'), false)).toMatchObject({ authorized: false, code: 'unlock-required' });
    expect(authorizeBrowserRpc(request('confirmation.request', { operation: 'vault.create', userGestureId: crypto.randomUUID() }), false).authorized).toBe(true);
  });

  it('requires a fresh gesture identifier for mutations and copies', () => {
    expect(authorizeBrowserRpc(request('items.add'), true)).toMatchObject({ authorized: false, code: 'invalid-request' });
    expect(authorizeBrowserRpc(request('items.add', { userGestureId: crypto.randomUUID() }), true).authorized).toBe(true);
    expect(authorizeBrowserRpc(request('items.copy-password', { userGestureId: crypto.randomUUID() }), true).authorized).toBe(true);
    expect(authorizeBrowserRpc(request('vault.unlock'), false)).toMatchObject({ authorized: false, code: 'invalid-request' });
    expect(authorizeBrowserRpc(request('vault.unlock', { userGestureId: crypto.randomUUID() }), false).authorized).toBe(true);
    expect(authorizeBrowserRpc(request('pin.unlock', { pin: '123456', userGestureId: crypto.randomUUID() }), false).authorized).toBe(true);
    expect(authorizeBrowserRpc(request('pin.enable', { pin: '123456', failureLimit: 5, userGestureId: crypto.randomUUID() }), false)).toMatchObject({ authorized: false, code: 'unlock-required' });
  });

  it('allows automatic autofill without a synthetic gesture only while unlocked', () => {
    expect(authorizeBrowserRpc(request('browser.autofill.candidates'), true).authorized).toBe(true);
    expect(authorizeBrowserRpc(request('browser.autofill.execute'), true).authorized).toBe(true);
    expect(authorizeBrowserRpc(request('browser.card.capture-status'), true).authorized).toBe(true);
    expect(authorizeBrowserRpc(request('browser.login.password-changed'), true).authorized).toBe(true);
    expect(authorizeBrowserRpc(request('browser.fill.record'), true).authorized).toBe(true);
    expect(authorizeBrowserRpc(request('browser.fill.history'), true).authorized).toBe(true);
    expect(authorizeBrowserRpc(request('browser.autofill.execute'), false)).toMatchObject({ authorized: false, code: 'unlock-required' });
    expect(authorizeBrowserRpc(request('browser.card.capture-status'), false)).toMatchObject({ authorized: false, code: 'unlock-required' });
    expect(authorizeBrowserRpc(request('browser.login.password-changed'), false)).toMatchObject({ authorized: false, code: 'unlock-required' });
    expect(authorizeBrowserRpc(request('browser.fill.record'), false)).toMatchObject({ authorized: false, code: 'unlock-required' });
    expect(authorizeBrowserRpc(request('browser.fill.request'), true)).toMatchObject({ authorized: false, code: 'invalid-request' });
  });
});
