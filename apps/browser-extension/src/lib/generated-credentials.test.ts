import { describe, expect, it } from "vitest";

import {
  generatePassphrase,
  generatePassword,
  generateRandomLogin,
  generateUsername,
  generateUuid,
  passwordEntropy,
  type PasswordGeneratorOptions,
} from "./generated-credentials";

const passwordOptions: PasswordGeneratorOptions = {
  length: 24,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
  minimumNumbers: 3,
  minimumSymbols: 2,
  avoidAmbiguous: true,
};

describe("generateRandomLogin", () => {
  it("uses the configured username and password rules without inventing an email suffix", () => {
    const generated = Array.from({ length: 20 }, () => generateRandomLogin({
      username: { length: 14, prefix: "", style: "random", includeNumber: false },
      password: passwordOptions,
      emailRequired: false,
    }));

    for (const login of generated) {
      expect(login.username).toMatch(/^[a-z2-9]{14}$/);
      expect(login.username).not.toContain("@");
      expect(login.password).toHaveLength(24);
      expect(login.password).toMatch(/[a-z]/);
      expect(login.password).toMatch(/[A-Z]/);
      expect(login.password).toMatch(/[0-9]/);
      expect(login.password).toMatch(/[!@#$%*\-_+]/);
    }
    expect(new Set(generated.map((login) => `${login.username}:${login.password}`)).size).toBe(generated.length);
  });

  it("adds a reserved email domain only when the account field requires email", () => {
    const login = generateRandomLogin({
      username: { length: 12, prefix: "vm", style: "readable", includeNumber: true },
      password: passwordOptions,
      emailRequired: true,
    });

    expect(login.username).toMatch(/^vm_[a-z]+\d{2}@vaultmesh\.invalid$/);
  });
});

describe("credential generators", () => {
  it("honors password composition rules", () => {
    const generated = Array.from({ length: 20 }, () => generatePassword(passwordOptions));
    for (const password of generated) {
      expect(password).toHaveLength(24);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password.match(/[0-9]/g)?.length).toBeGreaterThanOrEqual(3);
      expect(password.match(/[!@#$%*\-_+]/g)?.length).toBeGreaterThanOrEqual(2);
      expect(password).not.toMatch(/[Il1O0o]/);
    }
    expect(passwordEntropy(passwordOptions)).toBeGreaterThan(120);
  });

  it("creates configurable readable passphrases", () => {
    const phrase = generatePassphrase({ wordCount: 5, separator: "-", capitalize: true, includeNumber: true });
    const words = phrase.split("-");
    expect(words).toHaveLength(5);
    expect(words.every((word) => /^[A-Z]/.test(word))).toBe(true);
    expect(words.at(-1)).toMatch(/\d{2}$/);
  });

  it("creates usernames with the requested shape", () => {
    const readable = generateUsername({ length: 18, prefix: "Vault Mesh!", style: "readable", includeNumber: true });
    const random = generateUsername({ length: 14, prefix: "", style: "random", includeNumber: false });
    expect(readable).toHaveLength(18);
    expect(readable).toMatch(/^vaultmes_/);
    expect(readable).toMatch(/\d{2}$/);
    expect(random).toMatch(/^[a-z2-9]{14}$/);
  });

  it("formats UUID v4 values without reducing their randomness", () => {
    const standard = generateUuid({ hyphens: true, uppercase: false, braces: false });
    const compact = generateUuid({ hyphens: false, uppercase: true, braces: true });
    expect(standard).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(compact).toMatch(/^\{[0-9A-F]{12}4[0-9A-F]{3}[89AB][0-9A-F]{15}\}$/);
  });
});
