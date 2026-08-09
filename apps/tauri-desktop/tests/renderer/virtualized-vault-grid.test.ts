import { describe, expect, it } from 'vitest';

import { vaultGridColumnCount } from '../../src/renderer/src/components/VirtualizedVaultGrid';

describe('vaultGridColumnCount', () => {
  it('matches the responsive columns used by the vault grid', () => {
    expect(vaultGridColumnCount(767)).toBe(1);
    expect(vaultGridColumnCount(768)).toBe(2);
    expect(vaultGridColumnCount(1_119)).toBe(2);
    expect(vaultGridColumnCount(1_120)).toBe(3);
    expect(vaultGridColumnCount(1_180)).toBe(3);
  });
});
