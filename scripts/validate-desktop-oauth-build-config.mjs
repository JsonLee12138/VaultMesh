import { pathToFileURL } from "node:url";

const googleDesktopClientIdPattern = /^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/;
const placeholderClientIds = new Set(["your-desktop-client.apps.googleusercontent.com"]);

export function validateDesktopOAuthBuildConfig(environment = process.env) {
  const clientId = environment.VAULTMESH_GOOGLE_OAUTH_CLIENT_ID ?? "";
  if (!googleDesktopClientIdPattern.test(clientId) || placeholderClientIds.has(clientId)) {
    throw new Error(
      "VAULTMESH_GOOGLE_OAUTH_CLIENT_ID must be configured as a GitHub Actions repository secret before packaging.",
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  validateDesktopOAuthBuildConfig();
}
