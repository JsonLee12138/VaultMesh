import assert from "node:assert/strict";
import test from "node:test";

import {
  validateDesktopOAuthBuildConfig,
  validateGoogleDesktopOAuthCredentials,
} from "./validate-desktop-oauth-build-config.mjs";

const configurationError =
  /VAULTMESH_GOOGLE_OAUTH_CLIENT_ID must be configured as a GitHub Actions repository secret before packaging/;

test("desktop packaging accepts configured Google Desktop OAuth build credentials", () => {
  assert.deepEqual(
    validateDesktopOAuthBuildConfig({
      VAULTMESH_GOOGLE_OAUTH_CLIENT_ID: "1234567890-example.apps.googleusercontent.com",
      VAULTMESH_GOOGLE_OAUTH_CLIENT_SECRET: "desktop-client-secret",
    }),
    {
      clientId: "1234567890-example.apps.googleusercontent.com",
      clientSecret: "desktop-client-secret",
    },
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
          value === undefined
            ? { VAULTMESH_GOOGLE_OAUTH_CLIENT_SECRET: "desktop-client-secret" }
            : {
                VAULTMESH_GOOGLE_OAUTH_CLIENT_ID: value,
                VAULTMESH_GOOGLE_OAUTH_CLIENT_SECRET: "desktop-client-secret",
              },
        ),
      configurationError,
    );
  });
}

for (const [name, value] of [
  ["missing", undefined],
  ["empty", ""],
  ["surrounding whitespace", " desktop-client-secret "],
  ["embedded whitespace", "desktop client secret"],
]) {
  test(`desktop packaging rejects a ${name} Google OAuth client secret`, () => {
    assert.throws(
      () =>
        validateDesktopOAuthBuildConfig({
          VAULTMESH_GOOGLE_OAUTH_CLIENT_ID: "1234567890-example.apps.googleusercontent.com",
          ...(value === undefined ? {} : { VAULTMESH_GOOGLE_OAUTH_CLIENT_SECRET: value }),
        }),
      /VAULTMESH_GOOGLE_OAUTH_CLIENT_SECRET must be configured as a GitHub Actions repository secret before packaging/,
    );
  });
}

const credentials = {
  clientId: "1234567890-example.apps.googleusercontent.com",
  clientSecret: "desktop-client-secret",
};

test("desktop packaging accepts a provider-confirmed Desktop credential pair", async () => {
  await assert.doesNotReject(() =>
    validateGoogleDesktopOAuthCredentials(credentials, async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
    ),
  );
});

for (const [name, error] of [
  ["invalid credential request", "invalid_request"],
  ["unknown, deleted, or mismatched client", "invalid_client"],
]) {
  test(`desktop packaging rejects a provider-confirmed ${name}`, async () => {
    await assert.rejects(
      () =>
        validateGoogleDesktopOAuthCredentials(credentials, async () =>
          new Response(JSON.stringify({ error }), { status: 400 }),
        ),
      /must form a provider-accepted client pair before packaging/,
    );
  });
}

test("desktop packaging fails closed when provider validation is unavailable", async () => {
  await assert.rejects(
    () =>
      validateGoogleDesktopOAuthCredentials(credentials, async () => {
        throw new Error("network detail must not be exposed");
      }),
    /Provider validation request failed/,
  );
});
