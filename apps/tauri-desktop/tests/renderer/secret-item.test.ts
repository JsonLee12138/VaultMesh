import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

const editorSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/pages/SecretItemEditorPage.tsx'), 'utf8');
const storeSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/stores/vault-store.ts'), 'utf8');

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

  it('can continue from API credential creation or editing into structured environment setup', () => {
    for (const marker of [
      '保存并配置 API 环境',
      "value=\"configure-api-environment\"",
      'queueApiEnvironmentSetup(created)',
      'queueApiEnvironmentSetup({',
      'secret: secret || null',
      "const canConfigureApiEnvironment = kind === 'api-key' || kind === 'access-token'",
      '(!item && !secret)',
      "to: '/vault/services'",
      '环境备注（非 API 配置）',
    ]) expect(editorSource).toContain(marker);

    for (const marker of ['PendingApiEnvironmentSetup', 'credentialId: secret.id', 'pendingApiEnvironmentSetup: null']) {
      expect(storeSource).toContain(marker);
    }
    expect(editorSource).not.toContain('localStorage');
    expect(editorSource).not.toContain('sessionStorage');
  });
});
