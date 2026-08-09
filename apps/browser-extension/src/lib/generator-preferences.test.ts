import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_GENERATOR_PREFERENCES,
  DEFAULT_PASSWORD_GENERATOR_OPTIONS,
  DEFAULT_USERNAME_GENERATOR_OPTIONS,
  loadGeneratorPreferences,
  loadPasswordGeneratorOptions,
  loadUsernameGeneratorOptions,
  saveGeneratorPreferences,
} from "./generator-preferences";

const PREFERENCES_KEY = "vaultmesh.generator.preferences.v2";
const PASSWORD_V1_KEY = "vaultmesh.generator.password-options.v1";
const USERNAME_V1_KEY = "vaultmesh.generator.username-options.v1";

describe("generator preferences", () => {
  beforeEach(async () => browser.storage.local.clear());

  it("persists the selected mode and every generator option group", async () => {
    const configured = {
      mode: "uuid" as const,
      password: { ...DEFAULT_GENERATOR_PREFERENCES.password, length: 32, symbols: true, minimumSymbols: 3 },
      passphrase: { wordCount: 8, separator: "_" as const, capitalize: true, includeNumber: false },
      username: { ...DEFAULT_GENERATOR_PREFERENCES.username, length: 22, prefix: "", style: "random" as const, includeNumber: false },
      uuid: { hyphens: false, uppercase: true, braces: true },
    };

    await expect(saveGeneratorPreferences(configured)).resolves.toBe(true);
    await expect(loadGeneratorPreferences()).resolves.toEqual(configured);
    await expect(loadPasswordGeneratorOptions()).resolves.toEqual(configured.password);
    await expect(loadUsernameGeneratorOptions()).resolves.toEqual(configured.username);
  });

  it("migrates valid v1 password and username options without losing them", async () => {
    const password = { ...DEFAULT_PASSWORD_GENERATOR_OPTIONS, length: 28, symbols: true };
    const username = { ...DEFAULT_USERNAME_GENERATOR_OPTIONS, prefix: "old", style: "random" as const };
    await browser.storage.local.set({
      [PASSWORD_V1_KEY]: password,
      [USERNAME_V1_KEY]: username,
    });

    await expect(loadGeneratorPreferences()).resolves.toEqual({
      ...DEFAULT_GENERATOR_PREFERENCES,
      password,
      username,
    });
    const stored = await browser.storage.local.get(PREFERENCES_KEY);
    expect(stored[PREFERENCES_KEY]).toEqual({
      ...DEFAULT_GENERATOR_PREFERENCES,
      password,
      username,
    });
  });

  it("dual-writes v1 generator keys for rollback compatibility", async () => {
    const configured = {
      ...DEFAULT_GENERATOR_PREFERENCES,
      password: { ...DEFAULT_GENERATOR_PREFERENCES.password, length: 40 },
      username: { ...DEFAULT_GENERATOR_PREFERENCES.username, prefix: "next" },
    };

    await saveGeneratorPreferences(configured);
    const stored = await browser.storage.local.get([PASSWORD_V1_KEY, USERNAME_V1_KEY]);
    expect(stored[PASSWORD_V1_KEY]).toEqual(configured.password);
    expect(stored[USERNAME_V1_KEY]).toEqual(configured.username);
  });

  it("falls back to safe defaults for invalid stored settings", async () => {
    await browser.storage.local.set({
      [PREFERENCES_KEY]: { ...DEFAULT_GENERATOR_PREFERENCES, passphrase: { wordCount: 99 } },
      [PASSWORD_V1_KEY]: { length: 2 },
      [USERNAME_V1_KEY]: { length: 2, prefix: "too-long-prefix" },
    });

    await expect(loadGeneratorPreferences()).resolves.toEqual(DEFAULT_GENERATOR_PREFERENCES);
  });

  it("stores only schema-approved preference fields", async () => {
    const withGeneratedValue = {
      ...DEFAULT_GENERATOR_PREFERENCES,
      generatedValue: "must-not-be-persisted",
    };

    await expect(saveGeneratorPreferences(withGeneratedValue)).resolves.toBe(true);
    const stored = await browser.storage.local.get(PREFERENCES_KEY);
    expect(stored[PREFERENCES_KEY]).toEqual(DEFAULT_GENERATOR_PREFERENCES);
    expect(stored[PREFERENCES_KEY]).not.toHaveProperty("generatedValue");
  });
});
