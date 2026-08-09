import type { SecretItemKind, SecretItemSummary } from '../../../shared/contracts';

export const SECRET_ITEM_KIND_OPTIONS: ReadonlyArray<{ value: SecretItemKind; label: string; description: string }> = [
  { value: 'api-key', label: 'API Key', description: '用于调用 OpenAI、TMDB 等服务 API 的密钥。' },
  { value: 'access-token', label: '访问令牌', description: '例如 GitHub Personal Access Token 或 OAuth Token。' },
  { value: 'authenticator-key', label: '验证器密钥', description: '认证应用、硬件令牌或服务使用的共享密钥。' },
  { value: 'client-secret', label: '客户端密钥', description: 'OAuth 应用或服务账号的 Client Secret。' },
  { value: 'webhook-secret', label: 'Webhook 密钥', description: '用于验证 Webhook 请求签名的共享密钥。' },
  { value: 'database-credential', label: '数据库凭据', description: '数据库连接串、DSN 或数据库访问凭据。' },
  { value: 'recovery-codes', label: '恢复码', description: '账号的恢复码、备用验证码或备份代码。' },
  { value: 'certificate', label: '证书与 PEM', description: '证书、证书链或非 SSH 的 PEM 私钥。' },
  { value: 'software-license', label: '软件许可证', description: '软件许可证、产品密钥、激活码或序列号。' },
  { value: 'identity-document', label: '身份证件', description: '身份证、护照、驾照或社会安全号码等敏感号码。' },
  { value: 'secure-note', label: '安全笔记', description: '安全问题与答案或其他需要加密保存的文本。' },
  { value: 'crypto-wallet', label: '加密钱包', description: '钱包助记词或恢复短语；属于极高敏感信息。' },
  { value: 'other', label: '其他机密', description: '不属于以上分类的开发者或服务机密。' },
];

export function secretItemKindLabel(kind: SecretItemKind): string {
  return SECRET_ITEM_KIND_OPTIONS.find((option) => option.value === kind)?.label ?? '其他机密';
}

export function secretItemDisplayTitle(item: Pick<SecretItemSummary, 'title' | 'website'>): string {
  if (!item.website) return item.title;
  try {
    return new URL(item.website).hostname.replace(/^www\./i, '') || item.title;
  } catch {
    return item.title;
  }
}

export function secretItemMatchesSearch(item: SecretItemSummary, query: string): boolean {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return true;
  return [item.title, secretItemKindLabel(item.kind), item.provider, item.account, item.environment, item.website, item.notes]
    .some((value) => value?.toLocaleLowerCase().includes(term));
}
