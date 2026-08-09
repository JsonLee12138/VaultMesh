export function parseRecoveryCodes(value: string): string[] {
  return value
    .split(/\r?\n/)
    .filter((code) => code.trim().length > 0);
}
