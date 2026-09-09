// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NearbyDevicesPage } from '../../src/renderer/src/pages/NearbyDevicesPage';
import { keepsIndependentPageOnVaultLock } from '../../src/renderer/src/App';
import type { VaultMeshApi } from '../../src/shared/api';
import type { LanPairingStatus } from '../../src/shared/contracts';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const emptyStatus: LanPairingStatus = {
  discoverable: false,
  expiresAt: null,
  nearby: [],
  pending: [],
  trusted: [],
};

describe('CT-LAN-PAIRING-001 nearby devices UI', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'vaultMesh', {
      configurable: true,
      value: {
        lan: {
          status: vi.fn().mockResolvedValue(emptyStatus),
          startDiscovery: vi.fn().mockResolvedValue({
            ...emptyStatus,
            discoverable: true,
            expiresAt: Date.now() + 600_000,
          }),
          stopDiscovery: vi.fn().mockResolvedValue(emptyStatus),
          scan: vi.fn().mockResolvedValue(emptyStatus),
          listTrusted: vi.fn().mockResolvedValue([]),
          begin: vi.fn().mockResolvedValue({ started: true }),
          confirm: vi.fn().mockResolvedValue({ resolved: true }),
          cancel: vi.fn().mockResolvedValue({ resolved: true }),
          rename: vi.fn().mockResolvedValue({ renamed: true }),
          revoke: vi.fn().mockResolvedValue({ revoked: true }),
        },
      } as unknown as VaultMeshApi,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('keeps only the non-secret nearby page mounted when the Vault locks', () => {
    expect(keepsIndependentPageOnVaultLock('/nearby')).toBe(true);
    expect(keepsIndependentPageOnVaultLock('/vault')).toBe(false);
    expect(keepsIndependentPageOnVaultLock('/vault/security')).toBe(false);
  });

  it('starts only on explicit action and stops discovery when the page closes', async () => {
    const view = render(<NearbyDevicesPage />);
    const start = await screen.findByRole('button', { name: '开启 10 分钟' });
    expect(window.vaultMesh.lan.startDiscovery).not.toHaveBeenCalled();

    fireEvent.click(start);
    await waitFor(() => expect(window.vaultMesh.lan.startDiscovery).toHaveBeenCalledOnce());

    view.unmount();
    await waitFor(() => expect(window.vaultMesh.lan.stopDiscovery).toHaveBeenCalledOnce());
  });

  it('shows only the six-digit comparison code and routes both decisions by opaque peer ref', async () => {
    const pairingRef = 'lan-peer-00112233445566778899aabbccddeeff';
    vi.mocked(window.vaultMesh.lan.status).mockResolvedValue({
      ...emptyStatus,
      discoverable: true,
      expiresAt: Date.now() + 60_000,
      pending: [{ pairingRef, safetyCode: '482913', expiresAt: Date.now() + 60_000 }],
    });
    render(<NearbyDevicesPage />);

    expect(await screen.findByText('482913')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '短码一致' }));
    await waitFor(() => expect(window.vaultMesh.lan.confirm).toHaveBeenCalledWith(pairingRef));

    vi.mocked(window.vaultMesh.lan.status).mockResolvedValue({
      ...emptyStatus,
      discoverable: true,
      expiresAt: Date.now() + 60_000,
      pending: [{ pairingRef, safetyCode: '482913', expiresAt: Date.now() + 60_000 }],
    });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(window.vaultMesh.lan.cancel).toHaveBeenCalledWith(pairingRef));

    expect(document.body.textContent).not.toMatch(/192\.168\.|证书指纹|公钥|TLS exporter/i);
  });
});
