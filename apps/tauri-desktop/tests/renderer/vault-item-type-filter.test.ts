import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VAULT_ITEM_TYPE_FILTER,
  VAULT_ITEM_TYPE_TABS,
  isVaultItemTypeVisible,
} from '../../src/renderer/src/lib/vault-item-type-filter';
import { parseVaultItemSelectionKey, vaultItemSelectionKey } from '../../src/renderer/src/lib/vault-item-selection';

describe('vault item type tabs', () => {
  it('defaults to all and exposes the requested tab order', () => {
    expect(DEFAULT_VAULT_ITEM_TYPE_FILTER).toBe('all');
    expect(VAULT_ITEM_TYPE_TABS).toEqual([
      { id: 'all', label: '全部' },
      { id: 'service', label: '网站/服务' },
      { id: 'login', label: '登录' },
      { id: 'paymentCard', label: '支付卡' },
      { id: 'sshCredential', label: 'SSH' },
      { id: 'secret', label: '密钥' },
      { id: 'identity', label: '身份' },
    ]);
  });

  it('shows every type for all and only the selected type otherwise', () => {
    expect(isVaultItemTypeVisible('all', 'service')).toBe(true);
    expect(isVaultItemTypeVisible('all', 'login')).toBe(true);
    expect(isVaultItemTypeVisible('all', 'paymentCard')).toBe(true);
    expect(isVaultItemTypeVisible('all', 'sshCredential')).toBe(true);
    expect(isVaultItemTypeVisible('all', 'identity')).toBe(true);
    expect(isVaultItemTypeVisible('all', 'secret')).toBe(true);
    expect(isVaultItemTypeVisible('identity', 'identity')).toBe(true);
    expect(isVaultItemTypeVisible('sshCredential', 'sshCredential')).toBe(true);
    expect(isVaultItemTypeVisible('sshCredential', 'login')).toBe(false);
    expect(isVaultItemTypeVisible('paymentCard', 'sshCredential')).toBe(false);
    expect(isVaultItemTypeVisible('secret', 'secret')).toBe(true);
    expect(isVaultItemTypeVisible('service', 'service')).toBe(true);
    expect(isVaultItemTypeVisible('service', 'login')).toBe(false);
  });

  it('keeps selections distinct across vault item types', () => {
    const loginKey = vaultItemSelectionKey('login', 'shared-id');
    const cardKey = vaultItemSelectionKey('paymentCard', 'shared-id');

    expect(loginKey).not.toBe(cardKey);
    expect(parseVaultItemSelectionKey(cardKey)).toEqual({ kind: 'paymentCard', id: 'shared-id' });
  });
});
