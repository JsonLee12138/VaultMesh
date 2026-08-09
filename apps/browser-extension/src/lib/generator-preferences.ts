import { z } from "zod";

import type {
  PassphraseGeneratorOptions,
  PasswordGeneratorOptions,
  UsernameGeneratorOptions,
  UuidGeneratorOptions,
} from "@/lib/generated-credentials";

const GENERATOR_PREFERENCES_KEY = "vaultmesh.generator.preferences.v2";
const LEGACY_PASSWORD_OPTIONS_KEY = "vaultmesh.generator.password-options.v1";
const LEGACY_USERNAME_OPTIONS_KEY = "vaultmesh.generator.username-options.v1";

export type GeneratorMode = "password" | "passphrase" | "username" | "uuid";

export type GeneratorPreferences = {
  mode: GeneratorMode;
  password: PasswordGeneratorOptions;
  passphrase: PassphraseGeneratorOptions;
  username: UsernameGeneratorOptions;
  uuid: UuidGeneratorOptions;
};

export const DEFAULT_PASSWORD_GENERATOR_OPTIONS: PasswordGeneratorOptions = {
  length: 20,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: false,
  minimumNumbers: 1,
  minimumSymbols: 1,
  avoidAmbiguous: true,
};

export const DEFAULT_PASSPHRASE_GENERATOR_OPTIONS: PassphraseGeneratorOptions = {
  wordCount: 5,
  separator: "-",
  capitalize: false,
  includeNumber: true,
};

export const DEFAULT_USERNAME_GENERATOR_OPTIONS: UsernameGeneratorOptions = {
  length: 16,
  prefix: "vm",
  style: "readable",
  includeNumber: true,
};

export const DEFAULT_UUID_GENERATOR_OPTIONS: UuidGeneratorOptions = {
  hyphens: true,
  uppercase: false,
  braces: false,
};

export const DEFAULT_GENERATOR_PREFERENCES: GeneratorPreferences = {
  mode: "password",
  password: DEFAULT_PASSWORD_GENERATOR_OPTIONS,
  passphrase: DEFAULT_PASSPHRASE_GENERATOR_OPTIONS,
  username: DEFAULT_USERNAME_GENERATOR_OPTIONS,
  uuid: DEFAULT_UUID_GENERATOR_OPTIONS,
};

const passwordOptionsSchema = z.object({
  length: z.number().int().min(8).max(64),
  uppercase: z.boolean(),
  lowercase: z.boolean(),
  numbers: z.boolean(),
  symbols: z.boolean(),
  minimumNumbers: z.number().int().min(0).max(8),
  minimumSymbols: z.number().int().min(0).max(8),
  avoidAmbiguous: z.boolean(),
}).refine((options) => options.uppercase || options.lowercase || options.numbers || options.symbols)
  .refine((options) => Number(options.uppercase) + Number(options.lowercase) +
    (options.numbers ? Math.max(1, options.minimumNumbers) : 0) +
    (options.symbols ? Math.max(1, options.minimumSymbols) : 0) <= options.length);

const passphraseOptionsSchema = z.object({
  wordCount: z.number().int().min(3).max(8),
  separator: z.enum(["-", ".", "_", " "]),
  capitalize: z.boolean(),
  includeNumber: z.boolean(),
});

const usernameOptionsSchema = z.object({
  length: z.number().int().min(8).max(24),
  prefix: z.string().max(8),
  style: z.enum(["readable", "random"]),
  includeNumber: z.boolean(),
});

const uuidOptionsSchema = z.object({
  hyphens: z.boolean(),
  uppercase: z.boolean(),
  braces: z.boolean(),
});

const generatorPreferencesSchema = z.object({
  mode: z.enum(["password", "passphrase", "username", "uuid"]),
  password: passwordOptionsSchema,
  passphrase: passphraseOptionsSchema,
  username: usernameOptionsSchema,
  uuid: uuidOptionsSchema,
});

export async function loadGeneratorPreferences(): Promise<GeneratorPreferences> {
  try {
    const stored = await browser.storage.local.get([
      GENERATOR_PREFERENCES_KEY,
      LEGACY_PASSWORD_OPTIONS_KEY,
      LEGACY_USERNAME_OPTIONS_KEY,
    ]);
    const current = generatorPreferencesSchema.safeParse(stored[GENERATOR_PREFERENCES_KEY]);
    if (current.success) return current.data;

    const legacyPassword = passwordOptionsSchema.safeParse(stored[LEGACY_PASSWORD_OPTIONS_KEY]);
    const legacyUsername = usernameOptionsSchema.safeParse(stored[LEGACY_USERNAME_OPTIONS_KEY]);
    const migrated: GeneratorPreferences = {
      ...DEFAULT_GENERATOR_PREFERENCES,
      password: legacyPassword.success ? legacyPassword.data : DEFAULT_PASSWORD_GENERATOR_OPTIONS,
      username: legacyUsername.success ? legacyUsername.data : DEFAULT_USERNAME_GENERATOR_OPTIONS,
    };
    try {
      await persistGeneratorPreferences(migrated);
    } catch {
      // A read-only or shutting-down extension context can still use the
      // migrated preferences for the current page.
    }
    return migrated;
  } catch {
    return DEFAULT_GENERATOR_PREFERENCES;
  }
}

export async function saveGeneratorPreferences(preferences: GeneratorPreferences): Promise<boolean> {
  const parsed = generatorPreferencesSchema.safeParse(preferences);
  if (!parsed.success) return false;
  try {
    await persistGeneratorPreferences(parsed.data);
    return true;
  } catch {
    return false;
  }
}

export async function loadPasswordGeneratorOptions(): Promise<PasswordGeneratorOptions> {
  return (await loadGeneratorPreferences()).password;
}

export async function loadUsernameGeneratorOptions(): Promise<UsernameGeneratorOptions> {
  return (await loadGeneratorPreferences()).username;
}

export async function savePasswordGeneratorOptions(options: PasswordGeneratorOptions): Promise<void> {
  const current = await loadGeneratorPreferences();
  await saveGeneratorPreferences({ ...current, password: options });
}

export async function saveUsernameGeneratorOptions(options: UsernameGeneratorOptions): Promise<void> {
  const current = await loadGeneratorPreferences();
  await saveGeneratorPreferences({ ...current, username: options });
}

async function persistGeneratorPreferences(preferences: GeneratorPreferences): Promise<void> {
  await browser.storage.local.set({
    [GENERATOR_PREFERENCES_KEY]: preferences,
    [LEGACY_PASSWORD_OPTIONS_KEY]: preferences.password,
    [LEGACY_USERNAME_OPTIONS_KEY]: preferences.username,
  });
}
