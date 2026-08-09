export interface PasswordGeneratorOptions {
  length: number;
  lowercase: boolean;
  uppercase: boolean;
  digits: boolean;
  symbols: boolean;
}

export interface UsernameGeneratorOptions {
  length: number;
}

export interface EmailAliasGeneratorOptions extends UsernameGeneratorOptions {
  domain: string;
}

const CLASSES = {
  lowercase: 'abcdefghijkmnopqrstuvwxyz',
  uppercase: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  digits: '23456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?',
} as const;

type FillRandom = (values: Uint32Array<ArrayBuffer>) => void;

export function generatePassword(options: PasswordGeneratorOptions, fillRandom: FillRandom = (values) => { crypto.getRandomValues(values); }): string {
  const pools = (Object.keys(CLASSES) as Array<keyof typeof CLASSES>)
    .filter((key) => options[key])
    .map((key) => CLASSES[key]);
  if (pools.length === 0) throw new Error('请至少选择一种字符类型。');
  if (!Number.isInteger(options.length) || options.length < pools.length || options.length > 128) {
    throw new Error(`密码长度必须介于 ${pools.length} 和 128 之间。`);
  }
  const all = pools.join('');
  const characters = pools.map((pool) => pool[randomIndex(pool.length, fillRandom)] ?? '');
  while (characters.length < options.length) characters.push(all[randomIndex(all.length, fillRandom)] ?? '');
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swap = randomIndex(index + 1, fillRandom);
    [characters[index], characters[swap]] = [characters[swap] ?? '', characters[index] ?? ''];
  }
  return characters.join('');
}

/** Generates a stable, site-safe identifier rather than a password. */
export function generateUsername(options: UsernameGeneratorOptions, fillRandom: FillRandom = (values) => { crypto.getRandomValues(values); }): string {
  if (!Number.isInteger(options.length) || options.length < 6 || options.length > 64) {
    throw new Error('用户名长度必须介于 6 和 64 之间。');
  }
  const first = CLASSES.lowercase[randomIndex(CLASSES.lowercase.length, fillRandom)] ?? 'v';
  const pool = `${CLASSES.lowercase}${CLASSES.digits}`;
  let value = first;
  while (value.length < options.length) value += pool[randomIndex(pool.length, fillRandom)] ?? '0';
  return value;
}

export function generateEmailAlias(options: EmailAliasGeneratorOptions, fillRandom: FillRandom = (values) => { crypto.getRandomValues(values); }): string {
  const domain = options.domain.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(domain)) {
    throw new Error('请输入有效的邮箱别名域名，例如 example.com。');
  }
  return `${generateUsername(options, fillRandom)}@${domain}`;
}

function randomIndex(upperBound: number, fillRandom: FillRandom): number {
  const limit = Math.floor(0x1_0000_0000 / upperBound) * upperBound;
  const buffer = new Uint32Array(1);
  do { fillRandom(buffer); } while ((buffer[0] ?? 0) >= limit);
  return (buffer[0] ?? 0) % upperBound;
}
