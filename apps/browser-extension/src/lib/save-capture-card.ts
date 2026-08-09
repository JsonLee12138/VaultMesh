import type { CapturedCard } from "@/lib/save-capture";

/**
 * Keep the sensitive comparison request pinned to the desktop contract.
 * CapturedCard also contains a website-derived title, which is intentionally
 * excluded because it is not part of card identity or change detection.
 */
export function cardCaptureStatusInput(card: CapturedCard) {
  return {
    ...(card.cardId ? { cardId: card.cardId } : {}),
    cardholderName: card.cardholderName,
    cardNumber: card.cardNumber,
    expirationMonth: card.expirationMonth,
    expirationYear: card.expirationYear,
    securityCode: card.securityCode,
    billingAddress: card.billingAddress,
  };
}
