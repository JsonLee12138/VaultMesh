import { pathToFileURL } from "node:url";

const googleDesktopClientIdPattern = /^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/;
const placeholderClientIds = new Set(["your-desktop-client.apps.googleusercontent.com"]);
const googleTokenEndpoint = "https://oauth2.googleapis.com/token";
const oauthCredentialError =
  "Google Desktop OAuth build credentials must form a provider-accepted client pair before packaging.";

export function validateDesktopOAuthBuildConfig(environment = process.env) {
  const clientId = environment.VAULTMESH_GOOGLE_OAUTH_CLIENT_ID ?? "";
  if (!googleDesktopClientIdPattern.test(clientId) || placeholderClientIds.has(clientId)) {
    throw new Error(
      "VAULTMESH_GOOGLE_OAUTH_CLIENT_ID must be configured as a GitHub Actions repository secret before packaging.",
    );
  }
  const clientSecret = environment.VAULTMESH_GOOGLE_OAUTH_CLIENT_SECRET ?? "";
  if (!clientSecret || clientSecret.trim() !== clientSecret || /\s/.test(clientSecret)) {
    throw new Error(
      "VAULTMESH_GOOGLE_OAUTH_CLIENT_SECRET must be configured as a GitHub Actions repository secret before packaging.",
    );
  }
  return { clientId, clientSecret };
}

export async function validateGoogleDesktopOAuthCredentials(credentials, request = fetch) {
  const form = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    redirect_uri: "http://127.0.0.1:49152",
    grant_type: "authorization_code",
    code: "vaultmesh-invalid-desktop-client-probe",
    code_verifier: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~",
  });
  let response;
  try {
    response = await request(googleTokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
    });
  } catch {
    throw new Error(`${oauthCredentialError} Provider validation request failed.`);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${oauthCredentialError} Provider returned an invalid validation response.`);
  }
  // The probe deliberately submits a malformed one-time code. Google Desktop
  // credentials accept the client pair and reject only that code. Unknown,
  // deleted, or mismatched credentials fail before the invalid-code branch.
  if (response.status === 400 && payload?.error === "invalid_grant") {
    return;
  }
  throw new Error(oauthCredentialError);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const credentials = validateDesktopOAuthBuildConfig();
  await validateGoogleDesktopOAuthCredentials(credentials);
}
