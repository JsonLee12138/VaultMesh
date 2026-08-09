import { describe, expect, it } from 'vitest';

import { secretItemDisplayTitle } from './secret-item';

describe('CT-ITEM-005 developer/service secret website presentation', () => {
  it('presents an associated website like a Login card while preserving a title fallback', () => {
    expect(secretItemDisplayTitle({ title: 'GitHub work token', website: 'https://www.github.com/settings/tokens' })).toBe('github.com');
    expect(secretItemDisplayTitle({ title: 'Local token', website: null })).toBe('Local token');
  });
});
