import type { SshCredentialSummary } from '../../../shared/contracts';

export function sshCredentialMatchesSearch(item: SshCredentialSummary, query: string): boolean {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return true;
  return [item.title, item.host, item.username, item.keyAlgorithm, item.publicKeyFingerprint, item.managedSshAlias, item.notes]
    .some((value) => value?.toLocaleLowerCase().includes(term));
}

export function formatSshEndpoint(item: Pick<SshCredentialSummary, 'host' | 'port' | 'username'>): string {
  const host = item.host ?? '未指定主机';
  return `${item.username ? `${item.username}@` : ''}${host}${item.port === 22 ? '' : `:${item.port}`}`;
}

export function isReusableSshKey(item: SshCredentialSummary): boolean {
  return item.recordKind === 'key' && (item.hasPublicKey || item.hasPrivateKey);
}

export function isInstallableSshPublicKey(item: SshCredentialSummary): boolean {
  return isReusableSshKey(item) && item.hasPublicKey;
}

export function sshInstallRequiresMasterPassword(
  authentication: 'storedPassword' | 'sshAgent' | 'authenticationKey',
  uploadKey: SshCredentialSummary | undefined,
  account: SshCredentialSummary | null,
  authenticationKey: SshCredentialSummary | undefined,
): boolean {
  const verificationNeedsReprompt = Boolean(
    uploadKey?.hasPrivateKey && uploadKey.masterPasswordReprompt,
  );
  const authenticationNeedsReprompt = Boolean(
    authentication === 'storedPassword' && account?.masterPasswordReprompt
      || authentication === 'authenticationKey' && authenticationKey?.masterPasswordReprompt,
  );
  return verificationNeedsReprompt || authenticationNeedsReprompt;
}
