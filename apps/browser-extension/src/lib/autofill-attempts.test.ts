import { describe, expect, it } from "vitest";

import { AutofillAttemptRegistry } from "./autofill-attempts";

describe("AutofillAttemptRegistry", () => {
  it("suppresses duplicate document signatures until navigation reset", () => {
    const attempts = new AutofillAttemptRegistry();
    expect(attempts.begin(1, "https://example.test", "login:password")).toBe(true);
    expect(attempts.begin(1, "https://example.test", "login:password")).toBe(false);
    expect(attempts.begin(1, "https://example.test", "login:username")).toBe(true);
    attempts.reset(1);
    expect(attempts.begin(1, "https://example.test", "login:password")).toBe(true);
  });

  it("allows the same form signature once in each same-origin iframe document", () => {
    const attempts = new AutofillAttemptRegistry();
    expect(attempts.begin(1, "https://example.test", "username:password", "top-document")).toBe(true);
    expect(attempts.begin(1, "https://example.test", "username:password", "iframe-document")).toBe(true);
    expect(attempts.begin(1, "https://example.test", "username:password", "iframe-document")).toBe(false);
  });
});
