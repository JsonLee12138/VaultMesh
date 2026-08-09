import { describe, expect, it } from "vitest";

import { cardCaptureStatusInput } from "./save-capture-card";

describe("card save capture planning", () => {
  it("sends exactly the strict desktop comparison fields", () => {
    const input = cardCaptureStatusInput({
      cardId: "153370ec-4dc7-4c77-a6e0-f2a4f6e37f03",
      title: "shop.example.test •••• 1111",
      cardholderName: "Ada Lovelace",
      cardNumber: "4111111111111111",
      expirationMonth: 12,
      expirationYear: 2030,
      securityCode: "123",
      billingAddress: "12 Example Street",
    });

    expect(input).toEqual({
      cardId: "153370ec-4dc7-4c77-a6e0-f2a4f6e37f03",
      cardholderName: "Ada Lovelace",
      cardNumber: "4111111111111111",
      expirationMonth: 12,
      expirationYear: 2030,
      securityCode: "123",
      billingAddress: "12 Example Street",
    });
    expect(input).not.toHaveProperty("title");
  });
});
