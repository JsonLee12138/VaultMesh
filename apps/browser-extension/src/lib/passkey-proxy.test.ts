import { beforeEach, describe, expect, it } from 'vitest';

import { rememberLoginSelection } from './autofill-preferences';
import { defaultLoginIdForPasskeyRequest } from './passkey-proxy';

const loginId = '953370ec-4dc7-4c77-a6e0-f2a4f6e37f03';

function createRequest(origin: unknown): string {
  return JSON.stringify({
    rp: { id: 'example.test', name: 'Example' },
    extensions: { remoteDesktopClientOverride: { origin, sameOriginWithAncestors: true } },
  });
}

describe('Passkey default Login routing', () => {
  beforeEach(async () => browser.storage.local.clear());

  it('forwards only the Login remembered for the exact WebAuthn origin', async () => {
    await rememberLoginSelection('https://example.test', loginId);

    await expect(defaultLoginIdForPasskeyRequest(createRequest('https://example.test'))).resolves.toBe(loginId);
    await expect(defaultLoginIdForPasskeyRequest(createRequest('https://example.test:8443'))).resolves.toBeNull();
  });

  it('does not derive a Login hint from malformed or non-origin request data', async () => {
    await rememberLoginSelection('https://example.test', loginId);

    await expect(defaultLoginIdForPasskeyRequest('{')).resolves.toBeNull();
    await expect(defaultLoginIdForPasskeyRequest(createRequest('https://example.test/path'))).resolves.toBeNull();
    await expect(defaultLoginIdForPasskeyRequest(createRequest('file:///tmp/passkey'))).resolves.toBeNull();
  });
});
