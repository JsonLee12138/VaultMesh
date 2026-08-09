export type VaultItemTypeFilter = 'all' | 'service' | 'login' | 'paymentCard' | 'sshCredential' | 'secret' | 'identity';

export const DEFAULT_VAULT_ITEM_TYPE_FILTER: VaultItemTypeFilter = 'all';
const VAULT_ITEM_TYPE_STORAGE_KEY = 'vaultmesh.vault.activeItemType';

export const VAULT_ITEM_TYPE_TABS: ReadonlyArray<{ id: VaultItemTypeFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'service', label: '网站/服务' },
  { id: 'login', label: '登录' },
  { id: 'paymentCard', label: '支付卡' },
  { id: 'sshCredential', label: 'SSH' },
  { id: 'secret', label: '密钥' },
  { id: 'identity', label: '身份' },
];

export function readVaultItemTypeFilter(): VaultItemTypeFilter {
  if (typeof window === 'undefined') return DEFAULT_VAULT_ITEM_TYPE_FILTER;
  try {
    const stored = window.localStorage.getItem(VAULT_ITEM_TYPE_STORAGE_KEY);
    return VAULT_ITEM_TYPE_TABS.some((tab) => tab.id === stored)
      ? stored as VaultItemTypeFilter
      : DEFAULT_VAULT_ITEM_TYPE_FILTER;
  } catch {
    return DEFAULT_VAULT_ITEM_TYPE_FILTER;
  }
}

export function writeVaultItemTypeFilter(value: VaultItemTypeFilter): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(VAULT_ITEM_TYPE_STORAGE_KEY, value); } catch { /* Storage may be unavailable. */ }
}

export function isVaultItemTypeVisible(active: VaultItemTypeFilter, itemType: Exclude<VaultItemTypeFilter, 'all'>): boolean {
  return active === 'all' || active === itemType;
}
