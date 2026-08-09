export type SelectableVaultItemKind = 'login' | 'paymentCard' | 'sshCredential' | 'secret' | 'identity';
export type VaultItemSelectionKey = `${SelectableVaultItemKind}:${string}`;

const SELECTABLE_KINDS = new Set<SelectableVaultItemKind>(['login', 'paymentCard', 'sshCredential', 'secret', 'identity']);

export function vaultItemSelectionKey(kind: SelectableVaultItemKind, id: string): VaultItemSelectionKey {
  return `${kind}:${id}`;
}

export function parseVaultItemSelectionKey(key: VaultItemSelectionKey): { kind: SelectableVaultItemKind; id: string } {
  const separatorIndex = key.indexOf(':');
  const kind = key.slice(0, separatorIndex) as SelectableVaultItemKind;
  const id = key.slice(separatorIndex + 1);
  if (separatorIndex <= 0 || !SELECTABLE_KINDS.has(kind) || !id) throw new Error(`Invalid vault item selection key: ${key}`);
  return { kind, id };
}
