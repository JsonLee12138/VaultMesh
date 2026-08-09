export type GeneratedLogin = { username: string; password: string };

export type GeneratedLoginGeneratorOptions = {
  username: UsernameGeneratorOptions;
  password: PasswordGeneratorOptions;
  emailRequired: boolean;
};

export type PasswordGeneratorOptions = {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
  minimumNumbers: number;
  minimumSymbols: number;
  avoidAmbiguous: boolean;
};

export type PassphraseGeneratorOptions = {
  wordCount: number;
  separator: "-" | "." | "_" | " ";
  capitalize: boolean;
  includeNumber: boolean;
};

export type UsernameGeneratorOptions = {
  length: number;
  prefix: string;
  style: "readable" | "random";
  includeNumber: boolean;
};

export type UuidGeneratorOptions = {
  hyphens: boolean;
  uppercase: boolean;
  braces: boolean;
};

const LOWERCASE = "abcdefghijkmnopqrstuvwxyz";
const UPPERCASE = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%*-_+";
const AMBIGUOUS = new Set(["I", "l", "1", "O", "0", "o"]);
const PRONOUNCEABLE_STARTS = "bcdfghjkmnprstvwz";
const PRONOUNCEABLE_VOWELS = "aeiou";
const PRONOUNCEABLE_ENDS = ["b", "ck", "d", "f", "g", "k", "l", "m", "n", "p", "r", "s", "t", "v", "x", "z"];

export function generatePassword(options: PasswordGeneratorOptions, source: Crypto = globalThis.crypto) {
  const groups = [
    options.lowercase ? withoutAmbiguous(LOWERCASE, options.avoidAmbiguous) : "",
    options.uppercase ? withoutAmbiguous(UPPERCASE, options.avoidAmbiguous) : "",
    options.numbers ? withoutAmbiguous(DIGITS, options.avoidAmbiguous) : "",
    options.symbols ? SYMBOLS : "",
  ].filter(Boolean);
  if (groups.length === 0) throw new Error("至少选择一种字符类型。");

  const required = [
    ...(options.lowercase ? [randomCharacter(groups[0]!, source)] : []),
    ...(options.uppercase ? [randomCharacter(groups[options.lowercase ? 1 : 0]!, source)] : []),
  ];
  const numberGroup = options.numbers ? withoutAmbiguous(DIGITS, options.avoidAmbiguous) : "";
  const symbolGroup = options.symbols ? SYMBOLS : "";
  for (let index = 0; index < (options.numbers ? Math.max(1, options.minimumNumbers) : 0); index += 1) required.push(randomCharacter(numberGroup, source));
  for (let index = 0; index < (options.symbols ? Math.max(1, options.minimumSymbols) : 0); index += 1) required.push(randomCharacter(symbolGroup, source));
  if (required.length > options.length) throw new Error("长度不足以满足当前规则。");

  const alphabet = groups.join("");
  return shuffle([
    ...required,
    ...randomCharacters(alphabet, options.length - required.length, source),
  ], source).join("");
}

export function generatePassphrase(options: PassphraseGeneratorOptions, source: Crypto = globalThis.crypto) {
  const words = Array.from({ length: options.wordCount }, () => pronounceableWord(source));
  const normalized = options.capitalize ? words.map(capitalize) : words;
  if (options.includeNumber) normalized[normalized.length - 1] += String(randomIndex(90, source) + 10);
  return normalized.join(options.separator);
}

export function generateUsername(options: UsernameGeneratorOptions, source: Crypto = globalThis.crypto) {
  const prefix = options.prefix.toLocaleLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 8);
  const separator = prefix ? "_" : "";
  const bodyLength = Math.max(1, options.length - prefix.length - separator.length);
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  let body = options.style === "random"
    ? randomCharacters(alphabet, bodyLength, source)
    : readableBody(bodyLength, source);
  if (options.includeNumber) body = `${body.slice(0, Math.max(0, bodyLength - 2))}${randomIndex(90, source) + 10}`;
  return `${prefix}${separator}${body}`.slice(0, options.length);
}

export function generateUuid(options: UuidGeneratorOptions, source: Crypto = globalThis.crypto) {
  let value: string = source.randomUUID();
  if (!options.hyphens) value = value.replaceAll("-", "");
  if (options.uppercase) value = value.toLocaleUpperCase();
  return options.braces ? `{${value}}` : value;
}

export function passwordEntropy(options: PasswordGeneratorOptions) {
  const alphabetSize = (options.lowercase ? withoutAmbiguous(LOWERCASE, options.avoidAmbiguous).length : 0)
    + (options.uppercase ? withoutAmbiguous(UPPERCASE, options.avoidAmbiguous).length : 0)
    + (options.numbers ? withoutAmbiguous(DIGITS, options.avoidAmbiguous).length : 0)
    + (options.symbols ? SYMBOLS.length : 0);
  return alphabetSize > 0 ? Math.round(options.length * Math.log2(alphabetSize)) : 0;
}

export function generateRandomLogin(options: GeneratedLoginGeneratorOptions, source: Crypto = globalThis.crypto): GeneratedLogin {
  const localUsername = generateUsername(options.username, source);
  return {
    username: options.emailRequired ? `${localUsername}@vaultmesh.invalid` : localUsername,
    password: generatePassword(options.password, source),
  };
}

function withoutAmbiguous(alphabet: string, enabled: boolean) {
  return enabled ? [...alphabet].filter((character) => !AMBIGUOUS.has(character)).join("") : alphabet;
}

function pronounceableWord(source: Crypto) {
  return Array.from({ length: 2 }, () => `${randomCharacter(PRONOUNCEABLE_STARTS, source)}${randomCharacter(PRONOUNCEABLE_VOWELS, source)}${PRONOUNCEABLE_ENDS[randomIndex(PRONOUNCEABLE_ENDS.length, source)]}`).join("");
}

function readableBody(length: number, source: Crypto) {
  let value = "";
  while (value.length < length) value += pronounceableWord(source);
  return value.slice(0, length);
}

function capitalize(value: string) {
  return `${value[0]?.toLocaleUpperCase() ?? ""}${value.slice(1)}`;
}

function randomCharacters(alphabet: string, length: number, source: Crypto) {
  return Array.from({ length }, () => randomCharacter(alphabet, source)).join("");
}

function randomCharacter(alphabet: string, source: Crypto) {
  return alphabet[randomIndex(alphabet.length, source)]!;
}

function randomIndex(limit: number, source: Crypto) {
  const maximum = Math.floor(256 / limit) * limit;
  const byte = new Uint8Array(1);
  do source.getRandomValues(byte); while (byte[0]! >= maximum);
  return byte[0]! % limit;
}

function shuffle(values: string[], source: Crypto) {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swap = randomIndex(index + 1, source);
    [values[index], values[swap]] = [values[swap]!, values[index]!];
  }
  return values;
}
