// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnlockPage } from '../../src/renderer/src/pages/UnlockPage';
import { useVaultStore } from '../../src/renderer/src/stores/vault-store';
import type { DesktopAuthenticationEvent, VaultMeshApi } from '../../src/shared/api';
const navigate = vi.fn();
const originalRefresh = useVaultStore.getState().refresh;
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
const lockedStatus = { hasVault: true, unlocked: false, vaultPath: '/tmp/vaultmesh-test.vault', itemCount: 0 };
let listeners: Set<(event: DesktopAuthenticationEvent) => void>;
let desktop: VaultMeshApi['desktop'];
function event(status: DesktopAuthenticationEvent['status'], sessionId?: string) {
  const id = sessionId ?? vi.mocked(desktop.beginAuthentication).mock.calls.at(-1)![0];
  act(() => listeners.forEach((listener) => listener({ sessionId: id, status })));
}
describe('CT-TAURI-DESKTOP-001 desktop platform authentication', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 100, y: 100, width: 64, height: 64 } as DOMRect);
    listeners = new Set();
    desktop = {
      authenticationStatus: vi.fn().mockResolvedValue({ supported: true, label: 'Touch ID' }),
      beginAuthentication: vi.fn().mockResolvedValue(undefined),
      layoutAuthentication: vi.fn().mockResolvedValue(undefined),
      cancelAuthentication: vi.fn().mockResolvedValue(undefined),
      onAuthentication: vi.fn(async (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }),
    } as unknown as VaultMeshApi['desktop'];
    Object.defineProperty(window, 'vaultMesh', { configurable: true, value: {
      desktop,
      vault: {
        unlock: vi.fn().mockResolvedValue({ cancelled: true, status: lockedStatus }),
        unlockWithBiometrics: vi.fn(),
      },
    } as unknown as VaultMeshApi });
    useVaultStore.setState({ status: lockedStatus, biometric: null,
      pin: { enabled: false, locked: false, failureLimit: 5, failedAttempts: 0, remainingAttempts: 5 }, busy: false, error: null });
  });
  afterEach(() => { useVaultStore.setState({ refresh: originalRefresh }); cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
  async function ready() {
    render(<StrictMode><UnlockPage /></StrictMode>);
    act(() => useVaultStore.setState({ biometric: { available: true, enabled: true, kind: 'touchId' } }));
    await waitFor(() => expect(desktop.beginAuthentication).toHaveBeenCalledOnce());
  }
  it('waits without occupying busy or requesting a modal, and does not restart on rerender', async () => {
    await ready();
    event('listening');
    expect(screen.getByRole('status', { name: '解锁状态' }).textContent).toContain('触碰 Touch ID');
    expect(useVaultStore.getState().busy).toBe(false);
    expect(window.vaultMesh.vault.unlockWithBiometrics).not.toHaveBeenCalled();
    act(() => useVaultStore.setState({ error: '另一状态更新' }));
    expect(desktop.beginAuthentication).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText('主密码'), { target: { value: 'test-password' } });
    expect((screen.getByRole('button', { name: '使用主密码解锁' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('reconciles the same session when the DOM regains focus after a paused event', async () => {
    await ready();
    const id = vi.mocked(desktop.beginAuthentication).mock.calls[0][0];
    event('paused');
    fireEvent.focus(window);
    await waitFor(() => expect(desktop.beginAuthentication).toHaveBeenCalledTimes(2));
    expect(vi.mocked(desktop.beginAuthentication).mock.calls[1][0]).toBe(id);
    event('listening');
    expect(screen.getByRole('status', { name: '解锁状态' }).textContent).toContain('触碰 Touch ID');
  });
  it('does not cancel the desktop wait after 60 seconds', async () => {
    await ready();
    event('listening');
    const cancellations = vi.mocked(desktop.cancelAuthentication).mock.calls.length;
    vi.useFakeTimers();
    try {
      act(() => vi.advanceTimersByTime(120_000));
      expect(desktop.cancelAuthentication).toHaveBeenCalledTimes(cancellations);
      expect(screen.getByRole('status', { name: '解锁状态' }).textContent).toContain('触碰 Touch ID');
      expect(useVaultStore.getState().busy).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it('cancels native authentication before submitting a password', async () => {
    await ready();
    event('listening');
    fireEvent.change(screen.getByLabelText('主密码'), { target: { value: 'test-password' } });
    fireEvent.click(screen.getByRole('button', { name: '使用主密码解锁' }));
    await waitFor(() => expect(window.vaultMesh.vault.unlock).toHaveBeenCalledWith({ masterPassword: 'test-password' }));
    const cancelled = vi.mocked(desktop.cancelAuthentication).mock.invocationCallOrder.at(-1)!;
    const submitted = vi.mocked(window.vaultMesh.vault.unlock).mock.invocationCallOrder[0];
    expect(cancelled).toBeLessThan(submitted);
    event('unlocked');
    expect(navigate).not.toHaveBeenCalled();
  });
  it('submits only once while native cancellation is pending', async () => {
    await ready();
    let release!: () => void;
    vi.mocked(desktop.cancelAuthentication).mockReturnValue(new Promise<void>((resolve) => { release = resolve; }));
    fireEvent.change(screen.getByLabelText('主密码'), { target: { value: 'test-password' } });
    fireEvent.click(screen.getByRole('button', { name: '使用主密码解锁' }));
    fireEvent.click(screen.getByRole('button', { name: '使用主密码解锁' }));
    expect(window.vaultMesh.vault.unlock).not.toHaveBeenCalled();
    await act(async () => { release(); });
    await waitFor(() => expect(window.vaultMesh.vault.unlock).toHaveBeenCalledOnce());
  });
  it('keeps password fallback when native cancellation fails', async () => {
    await ready();
    vi.mocked(desktop.cancelAuthentication).mockRejectedValue(new Error('transport unavailable'));
    fireEvent.change(screen.getByLabelText('主密码'), { target: { value: 'test-password' } });
    fireEvent.click(screen.getByRole('button', { name: '使用主密码解锁' }));
    await waitFor(() => expect(window.vaultMesh.vault.unlock).toHaveBeenCalledOnce());
  });
  it('refreshes the Vault after native success before navigating', async () => {
    let finishRefresh!: () => void;
    const refresh = vi.fn(() => new Promise<void>((resolve) => { finishRefresh = resolve; }));
    useVaultStore.setState({ refresh });
    await ready();
    fireEvent.change(screen.getByLabelText('主密码'), { target: { value: 'test-password' } });
    event('opening');
    expect(screen.getByRole('status', { name: '解锁状态' }).textContent).toContain('正在打开保险库');
    expect(useVaultStore.getState().busy).toBe(false);
    event('unlocked');
    expect(screen.getByRole('status', { name: '解锁状态' }).textContent).toContain('正在打开保险库');
    expect(refresh).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
    expect((screen.getByLabelText('主密码') as HTMLInputElement).value).toBe('');
    await act(async () => { useVaultStore.setState({ status: { ...lockedStatus, unlocked: true } }); finishRefresh(); });
    expect(navigate).toHaveBeenCalledWith({ to: '/vault', replace: true });
  });
  it('leaves opening state on summary refresh failure and keeps password usable', async () => {
    useVaultStore.setState({ refresh: vi.fn().mockResolvedValue(undefined) });
    await ready();
    await act(async () => { event('unlocked'); });
    expect(screen.getByRole('status', { name: '解锁状态' }).textContent).toContain('摘要加载失败');
    fireEvent.change(screen.getByLabelText('主密码'), { target: { value: 'test-password' } });
    expect((screen.getByRole('button', { name: '使用主密码解锁' }) as HTMLButtonElement).disabled).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
  it('cancels native authentication before submitting a PIN', async () => {
    desktop.cancelAuthentication = vi.fn().mockResolvedValue(undefined);
    window.vaultMesh.vault.unlockWithPin = vi.fn().mockResolvedValue({ cancelled: true, status: lockedStatus });
    window.vaultMesh.vault.pinStatus = vi.fn().mockResolvedValue({ enabled: true, locked: false, remainingAttempts: 5 });
    useVaultStore.setState({ pin: { enabled: true, locked: false, failureLimit: 5, failedAttempts: 0, remainingAttempts: 5 } });
    await ready();
    event('listening');
    fireEvent.change(screen.getByLabelText('6 位 PIN'), { target: { value: '123456' } });
    await waitFor(() => expect(window.vaultMesh.vault.unlockWithPin).toHaveBeenCalledWith({ pin: '123456' }));
    expect(vi.mocked(desktop.cancelAuthentication).mock.invocationCallOrder.at(-1)!).toBeLessThan(vi.mocked(window.vaultMesh.vault.unlockWithPin).mock.invocationCallOrder[0]);
  });
  it('keeps password fallback after failure and ignores a previous attempt after retry', async () => {
    await ready();
    const old = vi.mocked(desktop.beginAuthentication).mock.calls[0][0];
    event('failed');
    expect(screen.getByRole('status', { name: '解锁状态' }).textContent).toContain('验证未完成');
    fireEvent.click(screen.getByRole('button', { name: '重试 Touch ID' }));
    await waitFor(() => expect(desktop.beginAuthentication).toHaveBeenCalledTimes(2));
    event('unlocked', old);
    expect(navigate).not.toHaveBeenCalled();
  });
  it('displays a safe post-authentication error rather than hiding the failure stage', async () => {
    await ready();
    const sessionId = vi.mocked(desktop.beginAuthentication).mock.calls.at(-1)![0];
    act(() => listeners.forEach((listener) => listener({ sessionId, status: 'failed', message: '无法读取 Touch ID 快速解锁凭据，请使用主密码重新启用。' })));
    expect(screen.getByRole('status', { name: '解锁状态' }).textContent).toContain('无法读取 Touch ID');
    expect(navigate).not.toHaveBeenCalled();
  });
  it('cancels and removes event subscriptions on unmount', async () => {
    await ready();
    const id = vi.mocked(desktop.beginAuthentication).mock.calls[0][0];
    cleanup();
    expect(desktop.cancelAuthentication).toHaveBeenCalledWith(id);
    expect(listeners.size).toBe(0);
  });
  it('explicitly reports Windows as unsupported and leaves password available', async () => {
    vi.mocked(desktop.authenticationStatus).mockResolvedValue({ supported: false, label: 'Windows Hello 暂不支持' });
    render(<UnlockPage />);
    expect(await screen.findByText('Windows Hello 暂不支持，请使用主密码或 PIN。')).toBeTruthy();
    expect(screen.getByLabelText('主密码')).toBeTruthy();
    expect(desktop.beginAuthentication).not.toHaveBeenCalled();
    expect(window.vaultMesh.vault.unlockWithBiometrics).not.toHaveBeenCalled();
  });
});
