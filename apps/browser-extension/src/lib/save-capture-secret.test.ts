import { describe, expect, it } from "vitest";

import { capturedSecretAddInput } from "./save-capture-secret";

describe("captured secret save defaults", () => {
  it("keeps recognized secret metadata and leaves master-password re-prompt disabled", () => {
    const input = capturedSecretAddInput({
      title: "GitHub access token",
      kind: "access-token",
      secret: "test-only-captured-token",
      provider: "GitHub",
      account: "octocat",
      environment: "Development",
      scopes: ["repo:read"],
      expiresAt: "2030-12-31",
      website: "https://github.com/settings/tokens",
    });

    expect(input).toEqual({
      title: "GitHub access token",
      kind: "access-token",
      secret: "test-only-captured-token",
      provider: "GitHub",
      account: "octocat",
      environment: "Development",
      scopes: ["repo:read"],
      expiresAt: "2030-12-31",
      website: "https://github.com/settings/tokens",
      notes: null,
      folder: null,
      favorite: false,
      masterPasswordReprompt: false,
    });
  });
});
