// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SshCredentialEditorPage } from '../../src/renderer/src/pages/SshCredentialEditorPage';
import { useVaultStore } from '../../src/renderer/src/stores/vault-store';
import type { SshCredentialDetail } from '../../src/shared/contracts';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));

const initialStore = useVaultStore.getState();
const detail: SshCredentialDetail = {
  id: '953370ec-4dc7-4c77-a6e0-f2a4f6e37f03',
  title: '家庭服务器 · home-server',
  host: null,
  port: 22,
  username: '',
  hasPassword: false,
  hasPublicKey: true,
  hasPrivateKey: true,
  hasKeyPassphrase: false,
  keyAlgorithm: 'ssh-ed25519',
  publicKeyFingerprint: 'SHA256:safe-fingerprint',
  managedSshAlias: 'home-server',
  notes: null,
  folder: null,
  favorite: false,
  masterPasswordReprompt: false,
  recordKind: 'key',
};

describe('managed OpenSSH alias editor', () => {
  afterEach(() => {
    cleanup();
    useVaultStore.setState(initialStore, true);
    vi.clearAllMocks();
  });

  it('shows the alias as read-only and hides key replacement controls', async () => {
    useVaultStore.setState({
      getSshCredentialDetail: vi.fn().mockResolvedValue(detail),
      busy: false,
      error: null,
    });

    render(<SshCredentialEditorPage sshId={detail.id} />);

    const alias = await screen.findByLabelText('OpenSSH 别名');
    expect(alias.getAttribute('readonly')).not.toBeNull();
    expect(alias).toHaveProperty('value', 'home-server');
    expect(screen.getByText('ssh home-server')).toBeTruthy();
    expect(screen.getByText('VaultMesh 托管密钥')).toBeTruthy();
    expect(screen.queryByLabelText('公钥')).toBeNull();
    expect(screen.queryByLabelText('私钥')).toBeNull();
    expect(screen.queryByLabelText(/复制密码、私钥或口令前/)).toBeNull();
  });
});
