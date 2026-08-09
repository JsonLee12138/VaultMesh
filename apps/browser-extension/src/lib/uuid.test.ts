import { describe, expect, it, vi } from "vitest";

import { createUuid } from "./uuid";

describe("createUuid", () => {
  it("uses the native generator when the context provides it", () => {
    const randomUUID = vi.fn(() => "953370ec-4dc7-4c77-a6e0-f2a4f6e37f03" as `${string}-${string}-${string}-${string}-${string}`);
    const source = { randomUUID } as unknown as Crypto;

    expect(createUuid(source)).toBe("953370ec-4dc7-4c77-a6e0-f2a4f6e37f03");
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it("generates a valid UUID v4 when randomUUID is unavailable on HTTP", () => {
    const source = {
      getRandomValues(array: Uint8Array) {
        array.set(Array.from({ length: 16 }, (_, index) => index));
        return array;
      },
    } as unknown as Crypto;

    expect(createUuid(source)).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
  });
});
