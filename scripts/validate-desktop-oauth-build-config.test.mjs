import assert from "node:assert/strict";
import test from "node:test";

import { validateDesktopOAuthBuildConfig } from "./validate-desktop-oauth-build-config.mjs";

const configurationError =
  /VAULTMESH_GOOGLE_OAUTH_CLIENT_ID must be configured as a GitHub Actions repository secret before packaging/;

test("desktop packaging accepts a configured Google Desktop OAuth client ID", () => {
  assert.doesNotThrow(() =>
    validateDesktopOAuthBuildConfig({
      VAULTMESH_GOOGLE_OAUTH_CLIENT_ID: "1234567890-example.apps.googleusercontent.com",
    }),
  );
});

for (const [name, value] of [
  ["missing", undefined],
  ["empty", ""],
  ["placeholder", "your-desktop-client.apps.googleusercontent.com"],
  ["wrong provider", "desktop-client.example.com"],
  ["surrounding whitespace", " 1234567890-example.apps.googleusercontent.com "],
]) {
  test(`desktop packaging rejects a ${name} Google OAuth client ID`, () => {
    assert.throws(
      () =>
        validateDesktopOAuthBuildConfig(
          value === undefined ? {} : { VAULTMESH_GOOGLE_OAUTH_CLIENT_ID: value },
        ),
      configurationError,
    );
  });
}
