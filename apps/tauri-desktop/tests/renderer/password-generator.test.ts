import { describe, expect, it } from 'vitest';
import { generateEmailAlias, generatePassword, generateUsername } from '../../src/renderer/src/lib/password-generator';

describe('password generator', () => {
  it('uses the requested length and every enabled class', () => {
    let value = 0;
    const password = generatePassword({ length: 24, lowercase: true, uppercase: true, digits: true, symbols: true }, (array) => {
      array[0] = value++; return array;
    });
    expect(password).toHaveLength(24);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[0-9]/);
    expect(password).toMatch(/[^a-zA-Z0-9]/);
  });

  it('rejects an empty character selection', () => {
    expect(() => generatePassword({ length: 20, lowercase: false, uppercase: false, digits: false, symbols: false })).toThrow();
  });

  it('generates site-safe usernames with a letter prefix', () => {
    const username = generateUsername({ length: 16 }, (array) => { array[0] = 1; return array; });
    expect(username).toMatch(/^[a-z][a-z0-9]{15}$/);
  });

  it('generates aliases only for a valid domain', () => {
    const alias = generateEmailAlias({ length: 10, domain: 'Aliases.Example.com' }, (array) => { array[0] = 2; return array; });
    expect(alias).toMatch(/^[a-z][a-z0-9]{9}@aliases\.example\.com$/);
    expect(() => generateEmailAlias({ length: 10, domain: 'not a domain' })).toThrow();
  });
});
