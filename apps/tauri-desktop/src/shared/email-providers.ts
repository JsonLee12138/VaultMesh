import type { EmailAuthKind, EmailProvider } from './contracts';

export interface EmailProviderPreset {
  id: EmailProvider;
  name: string;
  imapHost: string;
  imapPort: number;
  useTls: boolean;
  authKind: EmailAuthKind;
  credentialLabel: string;
  help: string;
}

export const EMAIL_PROVIDER_PRESETS: EmailProviderPreset[] = [
  { id: 'gmail', name: 'Gmail', imapHost: 'gmail.googleapis.com', imapPort: 443, useTls: true, authKind: 'oauth', credentialLabel: 'Google OAuth', help: '通过系统浏览器授权，使用 Gmail API 只读访问最近邮件。' },
  { id: 'outlook', name: 'Outlook / Microsoft 365', imapHost: 'graph.microsoft.com', imapPort: 443, useTls: true, authKind: 'oauth', credentialLabel: 'Microsoft OAuth', help: '通过系统浏览器授权，使用 Microsoft Graph 只读访问最近邮件。' },
  { id: 'qq', name: 'QQ 邮箱', imapHost: 'imap.qq.com', imapPort: 993, useTls: true, authKind: 'app-password', credentialLabel: '16 位授权码', help: '请先在 QQ 邮箱设置中开启 IMAP，并生成授权码。' },
  { id: '163', name: '网易 163', imapHost: 'imap.163.com', imapPort: 993, useTls: true, authKind: 'app-password', credentialLabel: '客户端授权密码', help: '请使用网易邮箱生成的客户端授权密码。' },
  { id: '126', name: '网易 126', imapHost: 'imap.126.com', imapPort: 993, useTls: true, authKind: 'app-password', credentialLabel: '客户端授权密码', help: '请使用网易邮箱生成的客户端授权密码。' },
  { id: 'yeah', name: '网易 Yeah', imapHost: 'imap.yeah.net', imapPort: 993, useTls: true, authKind: 'app-password', credentialLabel: '客户端授权密码', help: '请使用网易邮箱生成的客户端授权密码。' },
  { id: 'icloud', name: 'iCloud Mail', imapHost: 'imap.mail.me.com', imapPort: 993, useTls: true, authKind: 'app-password', credentialLabel: 'App 专用密码', help: '使用 Apple ID 生成的 App 专用密码。' },
  { id: 'yahoo', name: 'Yahoo Mail', imapHost: 'imap.mail.yahoo.com', imapPort: 993, useTls: true, authKind: 'app-password', credentialLabel: 'App 密码', help: '使用 Yahoo 生成的 App 密码。' },
  { id: 'zoho', name: 'Zoho Mail', imapHost: 'imap.zoho.com', imapPort: 993, useTls: true, authKind: 'app-password', credentialLabel: 'App 密码', help: '启用双重验证时请使用 App 密码。' },
  { id: 'fastmail', name: 'Fastmail', imapHost: 'imap.fastmail.com', imapPort: 993, useTls: true, authKind: 'app-password', credentialLabel: 'App 密码', help: '使用 Fastmail 设置中生成的 App 密码。' },
  { id: 'custom-imap', name: '其他 IMAP 邮箱', imapHost: '', imapPort: 993, useTls: true, authKind: 'app-password', credentialLabel: '邮箱密码或授权码', help: '填写服务商提供的 IMAP 主机、端口和专用授权码。' },
];

export function emailProviderPreset(provider: EmailProvider): EmailProviderPreset {
  return EMAIL_PROVIDER_PRESETS.find((preset) => preset.id === provider) ?? EMAIL_PROVIDER_PRESETS.at(-1)!;
}
