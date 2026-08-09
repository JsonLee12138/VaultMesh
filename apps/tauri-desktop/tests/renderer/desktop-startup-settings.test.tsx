// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DesktopStartupCard } from '../../src/renderer/src/components/DesktopStartupCard';
import type { VaultMeshApi } from '../../src/shared/api';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

describe('CT-DESKTOP-STARTUP-001 desktop startup setting', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'vaultMesh', {
      configurable: true,
      value: {
        desktop: {
          startupSettings: vi.fn().mockResolvedValue({ enabled: true }),
          updateStartupSettings: vi.fn().mockResolvedValue({ enabled: false }),
        },
      } as unknown as VaultMeshApi,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the actual system state and disables login startup', async () => {
    render(<DesktopStartupCard />);
    const control = await screen.findByRole('switch', { name: '登录时启动 VaultMesh' });
    await waitFor(() => expect(control.getAttribute('aria-checked')).toBe('true'));

    fireEvent.click(control);

    await waitFor(() => expect(window.vaultMesh.desktop.updateStartupSettings).toHaveBeenCalledWith({ enabled: false }));
    await waitFor(() => expect(control.getAttribute('aria-checked')).toBe('false'));
    expect(toast.success).toHaveBeenCalledWith('已关闭登录时启动。');
  });

  it('reports an OS failure and reloads the actual state', async () => {
    vi.mocked(window.vaultMesh.desktop.updateStartupSettings).mockRejectedValue(new Error('无法关闭登录时启动。'));
    render(<DesktopStartupCard />);
    const control = await screen.findByRole('switch', { name: '登录时启动 VaultMesh' });
    await waitFor(() => expect(control.getAttribute('aria-checked')).toBe('true'));

    fireEvent.click(control);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('无法关闭登录时启动。'));
    expect(window.vaultMesh.desktop.startupSettings).toHaveBeenCalledTimes(2);
    expect(control.getAttribute('aria-checked')).toBe('true');
  });
});
