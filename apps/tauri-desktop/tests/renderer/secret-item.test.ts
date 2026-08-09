import { describe, expect, it } from 'vitest';

import { SECRET_ITEM_KIND_OPTIONS, secretItemKindLabel, secretItemMatchesSearch } from '../../src/renderer/src/lib/secret-item';
import type { SecretItemSummary } from '../../src/shared/contracts';

const item: SecretItemSummary = {
  id: '953370ec-4dc7-4c77-a6e0-f2a4f6e37f03',
  title: 'Production AI key',
  kind: 'api-key',
  provider: 'OpenAI',
  account: 'platform-team',
  environment: 'Production',
  expiresAt: null,
  website: 'https://platform.openai.com/api-keys',
  notes: 'Used by gateway',
  favorite: true,
  masterPasswordReprompt: true,
  isPasskey: false,
  loginId: null,
};

describe('developer secret renderer behavior', () => {
  it('offers platform-neutral secret kinds for common credential shapes', () => {
    expect(SECRET_ITEM_KIND_OPTIONS.map((option) => option.value)).toEqual([
      'api-key', 'access-token', 'authenticator-key', 'client-secret', 'webhook-secret', 'database-credential',
      'recovery-codes', 'certificate', 'software-license', 'identity-document', 'secure-note', 'crypto-wallet', 'other',
    ]);
    expect(secretItemKindLabel('access-token')).toBe('访问令牌');
  });

  it('searches only summary metadata and never needs the secret value', () => {
    expect(secretItemMatchesSearch(item, 'openai')).toBe(true);
    expect(secretItemMatchesSearch(item, 'production')).toBe(true);
    expect(secretItemMatchesSearch(item, 'api key')).toBe(true);
    expect(item).not.toHaveProperty('secret');
  });
});
