// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SshKeyScanDialog } from '../../src/renderer/src/components/SshKeyScanDialog';
import { useVaultStore } from '../../src/renderer/src/stores/vault-store';
import type { VaultMeshApi } from '../../src/shared/api';
import type { SshKeyScanPreview } from '../../src/shared/contracts';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock('lucide-react', () => ({
  KeyRoundIcon: (props: HTMLAttributes<HTMLSpanElement>) => <span {...props} />,
  RadarIcon: (props: HTMLAttributes<HTMLSpanElement>) => <span {...props} />,
}));
vi.mock('@/components/ui/button', () => ({
  Button: ({ variant: _variant, size: _size, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => <button {...props} />,
}));
vi.mock('@/components/ui/spinner', () => ({
  Spinner: (props: HTMLAttributes<HTMLSpanElement>) => <span {...props} />,
}));
vi.mock('@/components/ui/textarea', () => ({
  Textarea: (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, onOpenChange, children }: { open: boolean; onOpenChange(open: boolean): void; children: ReactNode }) => open ? <div role="dialog"><button aria-label="Close" onClick={() => onOpenChange(false)} />{children}</div> : null,
  DialogContent: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  DialogDescription: ({ children, ...props }: HTMLAttributes<HTMLParagraphElement>) => <p {...props}>{children}</p>,
  DialogFooter: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  DialogHeader: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  DialogTitle: ({ children, ...props }: HTMLAttributes<HTMLHeadingElement>) => <h2 {...props}>{children}</h2>,
}));

const sessionId = '953370ec-4dc7-4c77-a6e0-f2a4f6e37f03';
const entryId = '3edaf140-8f87-4c5f-9294-d6ad6f153a78';
const originalRefresh = useVaultStore.getState().refresh;
const scanPreview = {
  sessionId,
  scannedCount: 2,
  skippedCount: 1,
  items: [{
    entryId,
    name: 'id_ed25519',
    kind: 'keyPair',
    algorithm: 'ssh-ed25519',
    fingerprint: 'SHA256:test-fingerprint',
    duplicate: false,
  }],
} satisfies SshKeyScanPreview;

describe('SSH key scan top-bar dialog', () => {
  const scanLocalKeys = vi.fn();
  const importScannedKeys = vi.fn();
  const cancelKeyScan = vi.fn();
  const refresh = vi.fn();

  beforeEach(() => {
    scanLocalKeys.mockResolvedValue(scanPreview);
    importScannedKeys.mockResolvedValue({ importedCount: 1, skippedCount: 0 });
    cancelKeyScan.mockResolvedValue(undefined);
    refresh.mockResolvedValue(undefined);
    useVaultStore.setState({ busy: false, refresh });
    Object.defineProperty(window, 'vaultMesh', {
      configurable: true,
      value: {
        ssh: { scanLocalKeys, importScannedKeys, cancelKeyScan },
      } as unknown as VaultMeshApi,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    useVaultStore.setState({ refresh: originalRefresh });
  });

  it('opens from the top bar, previews safe metadata and imports the selection', async () => {
    render(<SshKeyScanDialog />);

    fireEvent.click(screen.getByRole('button', { name: '扫描 SSH 密钥' }));

    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(await screen.findByText('id_ed25519')).toBeTruthy();
    expect(screen.getByText('已跳过 1 项')).toBeTruthy();
    expect(screen.getByText(/ssh-ed25519 · SHA256:test-fingerprint/)).toBeTruthy();
    expect(scanLocalKeys).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: '导入所选 1 项' }));

    await waitFor(() => {
      expect(importScannedKeys).toHaveBeenCalledWith(sessionId, [{ entryId, publicKey: null }]);
      expect(refresh).toHaveBeenCalledOnce();
    });
  });

  it('lets a private-key-only candidate add an optional public key before import', async () => {
    scanLocalKeys.mockResolvedValueOnce({
      ...scanPreview,
      items: [{
        ...scanPreview.items[0],
        name: 'id_private_only',
        kind: 'privateKey',
        algorithm: 'OpenSSH',
        fingerprint: null,
      }],
    });
    render(<SshKeyScanDialog />);

    fireEvent.click(screen.getByRole('button', { name: '扫描 SSH 密钥' }));
    const publicKey = await screen.findByLabelText('为 id_private_only 添加公钥（可选）');
    fireEvent.change(publicKey, {
      target: { value: '  ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGV4YW1wbGU= manual@test  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '导入所选 1 项' }));

    await waitFor(() => expect(importScannedKeys).toHaveBeenCalledWith(sessionId, [{
      entryId,
      publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGV4YW1wbGU= manual@test',
    }]));
  });

  it('discards a scan session that finishes after the dialog is closed', async () => {
    let resolveScan!: (preview: SshKeyScanPreview) => void;
    scanLocalKeys.mockReturnValueOnce(new Promise((resolve) => { resolveScan = resolve; }));
    render(<SshKeyScanDialog />);

    fireEvent.click(screen.getByRole('button', { name: '扫描 SSH 密钥' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    resolveScan(scanPreview);

    await waitFor(() => expect(cancelKeyScan).toHaveBeenCalledWith(sessionId));
  });
});
