import { beforeEach, describe, expect, it } from "vitest";

import { rememberedLoginSelection, rememberLoginSelection } from "./autofill-preferences";

const loginId = "953370ec-4dc7-4c77-a6e0-f2a4f6e37f03";

describe("autofill preferences", () => {
  beforeEach(async () => browser.storage.local.clear());

  it("remembers only the selected login id for an exact origin", async () => {
    await rememberLoginSelection("https://example.test:8443", loginId);

    expect(await rememberedLoginSelection("https://example.test:8443")).toBe(loginId);
    expect(await rememberedLoginSelection("https://example.test")).toBeNull();
  });

  it("ignores invalid origins and stored values", async () => {
    await rememberLoginSelection("file:///tmp/login.html", loginId);
    await rememberLoginSelection("https://example.test", "not-a-uuid");

    expect(await rememberedLoginSelection("file:///tmp/login.html")).toBeNull();
    expect(await rememberedLoginSelection("https://example.test")).toBeNull();
  });
});
