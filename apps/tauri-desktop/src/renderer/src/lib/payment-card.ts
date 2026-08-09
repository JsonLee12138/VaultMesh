import type { PaymentCardSummary } from '../../../shared/contracts';

export function paymentCardMatchesSearch(card: PaymentCardSummary, query: string): boolean {
  const searchTerm = query.trim().toLocaleLowerCase();
  if (!searchTerm) return true;
  return [card.title, card.cardholderName, card.maskedNumber, card.issuer, card.network, card.notes]
    .some((value) => value?.toLocaleLowerCase().includes(searchTerm));
}

export function formatCardExpiration(month: number, year: number): string {
  return `${String(month).padStart(2, '0')}/${year}`;
}

export function paymentCardVisualIndex(cardId: string, visualCount: number): number {
  if (!Number.isSafeInteger(visualCount) || visualCount <= 0) {
    throw new RangeError('visualCount must be a positive integer');
  }

  let hash = 2_166_136_261;
  for (let index = 0; index < cardId.length; index += 1) {
    hash ^= cardId.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % visualCount;
}
