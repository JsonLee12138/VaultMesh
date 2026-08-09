import { describe, expect, it } from 'vitest';

import { ADD_ITEM_TYPES } from '../../src/renderer/src/lib/add-item-types';
import { formatCardExpiration, paymentCardMatchesSearch, paymentCardVisualIndex } from '../../src/renderer/src/lib/payment-card';
import { PAYMENT_CARD_NETWORK_OPTIONS, paymentCardNetworkOptions } from '../../src/renderer/src/lib/payment-card-networks';
import { VAULT_CARD_VISUALS, vaultCardVisualFor } from '../../src/renderer/src/lib/vault-card-visual';
import type { PaymentCardSummary } from '../../src/shared/contracts';

const card: PaymentCardSummary = {
  id: '953370ec-4dc7-4c77-a6e0-f2a4f6e37f03',
  title: '日常消费卡',
  cardholderName: 'Ada Lovelace',
  maskedNumber: '•••• 1111',
  expirationMonth: 3,
  expirationYear: 2030,
  hasSecurityCode: true,
  hasPin: true,
  issuer: 'Example Bank',
  network: 'Visa',
  notes: '差旅使用',
  masterPasswordReprompt: false,
};

describe('payment-card renderer behavior', () => {
  it('offers login, payment-card, SSH, secret and identity creation routes', () => {
    expect(ADD_ITEM_TYPES).toEqual([
      { id: 'login', label: '登录', route: '/vault/items/new' },
      { id: 'paymentCard', label: '支付卡', route: '/vault/cards/new' },
      { id: 'sshCredential', label: 'SSH 账号或密钥', route: '/vault/ssh/new' },
      { id: 'secret', label: '密钥', route: '/vault/secrets/new' },
      { id: 'identity', label: '身份', route: '/vault/identities/new' },
    ]);
  });

  it('searches only renderer-safe card metadata including last four digits', () => {
    expect(paymentCardMatchesSearch(card, '1111')).toBe(true);
    expect(paymentCardMatchesSearch(card, 'example bank')).toBe(true);
    expect(paymentCardMatchesSearch(card, 'Ada')).toBe(true);
    expect(paymentCardMatchesSearch(card, '4111111111111111')).toBe(false);
  });

  it('formats a stable masked-card expiration display', () => {
    expect(formatCardExpiration(card.expirationMonth, card.expirationYear)).toBe('03/2030');
    expect(card.maskedNumber).toBe('•••• 1111');
    expect(card).not.toHaveProperty('cardNumber');
  });

  it('assigns a stable visual while distributing cards across available designs', () => {
    const ids = [card.id, 'c51ea0c6-cb7e-4db0-bf80-c588f10ea786', 'a303eb86-33dc-46fe-9756-c8330c418f11'];
    const assignments = ids.map((id) => paymentCardVisualIndex(id, 6));

    expect(paymentCardVisualIndex(card.id, 6)).toBe(assignments[0]);
    expect(new Set(assignments).size).toBeGreaterThan(1);
    expect(assignments.every((index) => index >= 0 && index < 6)).toBe(true);
    expect(() => paymentCardVisualIndex(card.id, 0)).toThrow(RangeError);
  });

  it('makes the bank-card visual palette reusable by non-payment vault items', () => {
    const visual = vaultCardVisualFor('ssh-item-id', 2);

    expect(VAULT_CARD_VISUALS).toContain(visual);
    expect(visual).toEqual(vaultCardVisualFor('ssh-item-id', 2));
    expect(visual).toHaveProperty('surface');
    expect(visual).toHaveProperty('pattern');
  });

  it('offers common card networks while preserving a historical custom value', () => {
    expect(PAYMENT_CARD_NETWORK_OPTIONS.map((option) => option.value)).toEqual([
      'UnionPay', 'Visa', 'Mastercard', 'American Express', 'JCB', 'Discover', 'Diners Club',
    ]);
    expect(paymentCardNetworkOptions('Visa')).toBe(PAYMENT_CARD_NETWORK_OPTIONS);
    expect(paymentCardNetworkOptions('Legacy Network').at(-1)).toEqual({
      value: 'Legacy Network',
      label: 'Legacy Network（现有值）',
    });
  });
});
