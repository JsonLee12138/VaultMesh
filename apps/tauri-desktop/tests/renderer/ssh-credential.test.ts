import { describe, expect, it } from 'vitest';

import {
  formatSshEndpoint,
  isInstallableSshPublicKey,
  isReusableSshKey,
  sshInstallRequiresMasterPassword,
  sshCredentialMatchesSearch,
} from '../../src/renderer/src/lib/ssh-credential';
import type { SshCredentialSummary } from '../../src/shared/contracts';

const ssh: SshCredentialSummary = {
  id: '953370ec-4dc7-4c77-a6e0-f2a4f6e37f03', title: '生产服务器', host: 'server.example.test',
  port: 2222, username: 'deploy', hasPassword: true, hasPublicKey: true, hasPrivateKey: true,
  hasKeyPassphrase: true, keyAlgorithm: 'ssh-ed25519', publicKeyFingerprint: 'SHA256:safe-fingerprint',
  managedSshAlias: null, notes: '发布环境', masterPasswordReprompt: true, recordKind: 'account',
};

describe('SSH credential renderer behavior', () => {
  it('searches only safe SSH metadata', () => {
    expect(sshCredentialMatchesSearch(ssh, 'server.example')).toBe(true);
    expect(sshCredentialMatchesSearch(ssh, 'ed25519')).toBe(true);
    expect(sshCredentialMatchesSearch(ssh, 'private-material')).toBe(false);
  });

  it('searches the safe managed OpenSSH alias projection', () => {
    expect(sshCredentialMatchesSearch({ ...ssh, managedSshAlias: 'home-server' }, 'home-server')).toBe(true);
  });

  it('formats username, host and non-default port without secret fields', () => {
    expect(formatSshEndpoint(ssh)).toBe('deploy@server.example.test:2222');
    expect(ssh).not.toHaveProperty('password');
    expect(ssh).not.toHaveProperty('privateKey');
    expect(ssh).not.toHaveProperty('keyPassphrase');
  });

  it('supports reusable keys without a host', () => {
    expect(formatSshEndpoint({ host: null, port: 22, username: '' })).toBe('未指定主机');
  });

  it('separates private-only editable keys from public keys that can be installed', () => {
    const privateOnly = {
      ...ssh,
      host: null,
      username: '',
      hasPublicKey: false,
      hasPrivateKey: true,
      recordKind: 'key' as const,
    };
    expect(isReusableSshKey(privateOnly)).toBe(true);
    expect(isInstallableSshPublicKey(privateOnly)).toBe(false);
    expect(isInstallableSshPublicKey({ ...privateOnly, hasPublicKey: true })).toBe(true);
    expect(isReusableSshKey(ssh)).toBe(false);
  });

  it('requests the Vault master password when the upload key itself needs reauthentication', () => {
    const uploadKey = { ...ssh, recordKind: 'key' as const, host: null, username: '' };
    const account = { ...ssh, masterPasswordReprompt: false };
    expect(sshInstallRequiresMasterPassword('sshAgent', uploadKey, account, undefined)).toBe(true);
    expect(sshInstallRequiresMasterPassword(
      'sshAgent', { ...uploadKey, masterPasswordReprompt: false }, account, undefined,
    )).toBe(false);
  });
});
