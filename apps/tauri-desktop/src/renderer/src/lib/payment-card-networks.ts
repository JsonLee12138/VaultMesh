export const PAYMENT_CARD_NETWORK_OPTIONS = [
  { value: 'UnionPay', label: '银联（UnionPay）' },
  { value: 'Visa', label: 'Visa' },
  { value: 'Mastercard', label: 'Mastercard' },
  { value: 'American Express', label: '美国运通（American Express）' },
  { value: 'JCB', label: 'JCB' },
  { value: 'Discover', label: 'Discover' },
  { value: 'Diners Club', label: '大来卡（Diners Club）' },
] as const;

export function paymentCardNetworkOptions(currentNetwork: string) {
  const trimmed = currentNetwork.trim();
  if (!trimmed || PAYMENT_CARD_NETWORK_OPTIONS.some((option) => option.value === trimmed)) {
    return PAYMENT_CARD_NETWORK_OPTIONS;
  }

  return [...PAYMENT_CARD_NETWORK_OPTIONS, { value: trimmed, label: `${trimmed}（现有值）` }];
}
