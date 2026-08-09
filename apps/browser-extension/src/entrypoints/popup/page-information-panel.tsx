import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import {
  ArrowLeftIcon,
  BracesIcon,
  CreditCardIcon,
  FolderKeyIcon,
  KeyRoundIcon,
  RefreshCwIcon,
  SaveIcon,
  TerminalIcon,
} from "lucide-react";

import { ToastMessage } from "@/components/ToastMessage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { PageInformationDetectionResponse } from "@/lib/protocol";

type DetectedInformation = Extract<PageInformationDetectionResponse, { status: "detected" }>;

export function PageInformationPanel({
  capture,
  busy,
  onCancel,
  onRescan,
  onSave,
}: {
  capture: DetectedInformation;
  busy: boolean;
  onCancel: () => void;
  onRescan: () => void;
  onSave: (data: DetectedInformation["data"]) => void;
}) {
  const { data } = capture;
  const hostname = safeHostname(capture.pageUrl);
  const availableKeys = useMemo(() => candidateKeys(data), [data]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(availableKeys));
  useEffect(() => setSelected(new Set(availableKeys)), [capture.captureId, availableKeys]);
  const selectedData = selectedCaptureData(data, selected);
  const selectedCount = selected.size;
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <header className="flex shrink-0 items-center gap-2">
        <Button aria-label="返回保险库" size="icon-sm" variant="ghost" type="button" disabled={busy} onClick={onCancel}>
          <ArrowLeftIcon />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">识别当前页面</h1>
          <p className="truncate text-xs text-muted-foreground">{capture.pageTitle} · {hostname}</p>
        </div>
      </header>

      <ScrollArea className="-mr-3 min-h-0 flex-1">
        <div className="flex flex-col gap-3 pb-1 pl-0.5 pr-4">
          {data.identity ? <Selectable selected={selected.has("identity")} label="个人资料" onChange={() => toggleSelected(setSelected, "identity")}><IdentityPreview identity={data.identity} /></Selectable> : null}
          {data.login ? <Selectable selected={selected.has("login")} label="登录信息" onChange={() => toggleSelected(setSelected, "login")}><LoginPreview login={data.login} /></Selectable> : null}
          {data.card ? <Selectable selected={selected.has("card")} label="支付卡" onChange={() => toggleSelected(setSelected, "card")}><CardPreview card={data.card} /></Selectable> : null}
          {data.secrets?.map((secret, index) => <Selectable key={`secret:${index}`} selected={selected.has(`secret:${index}`)} label={secret.title} onChange={() => toggleSelected(setSelected, `secret:${index}`)}><SecretPreview secret={secret} /></Selectable>)}
          {data.sshCredentials?.map((ssh, index) => <Selectable key={`ssh:${index}`} selected={selected.has(`ssh:${index}`)} label={ssh.title} onChange={() => toggleSelected(setSelected, `ssh:${index}`)}><SshPreview ssh={ssh} /></Selectable>)}
          <ToastMessage
            id={`page-information-ignored-${capture.captureId}`}
            message={capture.ignoredSensitiveFields.length > 0
              ? `未自动保存：${capture.ignoredSensitiveFields.join("、")}。当前保险库类型没有适合的结构化字段。`
              : null}
            variant="warning"
          />
        </div>
      </ScrollArea>

      <footer className="flex shrink-0 justify-end gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={onRescan}>
          <RefreshCwIcon data-icon="inline-start" />
          重新识别
        </Button>
        <Button type="button" disabled={busy || selectedCount === 0} onClick={() => onSave(selectedData)}>
          <SaveIcon data-icon="inline-start" />
          {busy ? "正在保存…" : `保存 ${selectedCount} 项`}
        </Button>
      </footer>
    </section>
  );
}

function Selectable({ selected, label, onChange, children }: { selected: boolean; label: string; onChange: () => void; children: ReactNode }) {
  return (
    <div className={selected ? "rounded-lg border-2 border-primary/50" : "rounded-lg border-2 border-transparent opacity-60"}>
      <label className="flex cursor-pointer items-center gap-2 rounded-t-lg border border-b-0 bg-muted/50 px-3 py-2 text-xs font-medium">
        <input className="size-4 shrink-0 accent-primary" type="checkbox" checked={selected} onChange={onChange} aria-label={`选择 ${label}`} />
        <span className="min-w-0 truncate">{selected ? "将保存" : "不保存"} · {label}</span>
      </label>
      {children}
    </div>
  );
}

function candidateKeys(data: DetectedInformation["data"]): string[] {
  return [
    data.identity ? "identity" : "",
    data.login ? "login" : "",
    data.card ? "card" : "",
    ...(data.secrets ?? []).map((_, index) => `secret:${index}`),
    ...(data.sshCredentials ?? []).map((_, index) => `ssh:${index}`),
  ].filter(Boolean);
}

function toggleSelected(setSelected: Dispatch<SetStateAction<Set<string>>>, key: string) {
  setSelected((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
}

function selectedCaptureData(data: DetectedInformation["data"], selected: Set<string>): DetectedInformation["data"] {
  const secrets = (data.secrets ?? []).filter((_, index) => selected.has(`secret:${index}`));
  const sshCredentials = (data.sshCredentials ?? []).filter((_, index) => selected.has(`ssh:${index}`));
  return {
    ...(data.login && selected.has("login") ? { login: data.login } : {}),
    ...(data.identity && selected.has("identity") ? { identity: data.identity } : {}),
    ...(data.card && selected.has("card") ? { card: data.card } : {}),
    ...(secrets.length ? { secrets } : {}),
    ...(sshCredentials.length ? { sshCredentials } : {}),
  };
}

function IdentityPreview({ identity }: { identity: DetectedInformation["data"]["identity"] & {} }) {
  const name = [identity.firstName, identity.middleName, identity.lastName].filter(Boolean).join(" ");
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2"><FolderKeyIcon />个人资料</CardTitle>
          <Badge variant="secondary">身份</Badge>
        </div>
        <CardDescription>{identity.title}</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="flex flex-col gap-2 text-sm">
          {name ? <PreviewRow label="姓名" value={name} /> : null}
          {identity.birthDate ? <PreviewRow label="生日" value={identity.birthDate} /> : null}
          {identity.emails.map((email, index) => <PreviewRow key={`email:${email.value}`} label={index ? `邮箱 ${index + 1}` : "邮箱"} value={email.value} />)}
          {identity.phones.map((phone, index) => <PreviewRow key={`phone:${phone.value}`} label={index ? `电话 ${index + 1}` : "电话"} value={phone.value} />)}
          {identity.addresses.map((address, index) => <PreviewRow key={`address:${address.addressLine1}:${index}`} label={index ? `地址 ${index + 1}` : "地址"} value={[address.addressLine1, address.city, address.region, address.postalCode, address.countryCode].filter(Boolean).join(", ")} />)}
          {identity.organization ? <PreviewRow label="公司" value={identity.organization} /> : null}
          {identity.department ? <PreviewRow label="部门" value={identity.department} /> : null}
          {identity.jobTitle ? <PreviewRow label="职业" value={identity.jobTitle} /> : null}
          {identity.website ? <PreviewRow label="网站" value={identity.website} /> : null}
        </dl>
      </CardContent>
    </Card>
  );
}

function LoginPreview({ login }: { login: DetectedInformation["data"]["login"] & {} }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2"><KeyRoundIcon />登录信息</CardTitle>
          <Badge variant="secondary">登录</Badge>
        </div>
        <CardDescription>密码仅以掩码显示</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="flex flex-col gap-2 text-sm">
          <PreviewRow label="用户名" value={login.username || "未识别用户名"} />
          <PreviewRow label="密码" value="••••••••" />
          {login.totpSecret ? <PreviewRow label="TOTP" value="已识别验证器密钥" /> : null}
          {login.additionalUrls?.length ? <PreviewRow label="附加网址" value={login.additionalUrls.join("、")} /> : null}
          {login.customFields?.map((field) => <PreviewRow key={`${field.label}:${field.value}`} label={field.label} value={field.value} />)}
        </dl>
      </CardContent>
    </Card>
  );
}

function CardPreview({ card }: { card: DetectedInformation["data"]["card"] & {} }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2"><CreditCardIcon />支付卡</CardTitle>
          <Badge variant="secondary">卡片</Badge>
        </div>
        <CardDescription>{card.title}</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="flex flex-col gap-2 text-sm">
          <PreviewRow label="持卡人" value={card.cardholderName} />
          <PreviewRow label="卡号" value={`•••• •••• •••• ${card.cardNumber.slice(-4)}`} />
          <PreviewRow label="有效期" value={`${card.expirationMonth.toString().padStart(2, "0")}/${card.expirationYear}`} />
          {card.securityCode ? <PreviewRow label="安全码" value="•••" /> : null}
          {card.pin ? <PreviewRow label="PIN" value="••••" /> : null}
          {card.issuer ? <PreviewRow label="发卡机构" value={card.issuer} /> : null}
          {card.network ? <PreviewRow label="卡组织" value={card.network} /> : null}
        </dl>
      </CardContent>
    </Card>
  );
}

function SecretPreview({ secret }: { secret: NonNullable<DetectedInformation["data"]["secrets"]>[number] }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2"><BracesIcon />{secretKindLabel(secret.kind)}</CardTitle>
          <Badge variant="secondary">机密信息</Badge>
        </div>
        <CardDescription>{secret.title}</CardDescription>
      </CardHeader>
      <CardContent>
        <ToastMessage
          id={`sensitive-secret-${secret.kind}-${secret.title}`}
          message={secret.kind === "crypto-wallet"
            ? "极高敏感信息：请确认当前设备可信，并核对助记词来源后再保存。"
            : secret.kind === "identity-document"
              ? "高度敏感的身份证件信息：请确认确有保存需要。"
              : null}
          variant="warning"
        />
        <dl className="flex flex-col gap-2 text-sm">
          {secret.provider ? <PreviewRow label="服务商" value={secret.provider} /> : null}
          <PreviewRow label={secretValueLabel(secret.kind)} value={maskedSecret(secret.secret)} />
          {secret.environment ? <PreviewRow label="环境" value={secret.environment} /> : null}
          {secret.account ? <PreviewRow label="账号/项目" value={secret.account} /> : null}
          {secret.scopes.length ? <PreviewRow label="权限" value={secret.scopes.join("、")} /> : null}
          {secret.expiresAt ? <PreviewRow label="到期日" value={secret.expiresAt} /> : null}
          {secret.website ? <PreviewRow label="来源" value={safeHostname(secret.website)} /> : null}
        </dl>
      </CardContent>
    </Card>
  );
}

function SshPreview({ ssh }: { ssh: NonNullable<DetectedInformation["data"]["sshCredentials"]>[number] }) {
  const material = [ssh.publicKey ? "公钥" : "", ssh.privateKey ? "私钥" : "", ssh.password ? "密码" : ""].filter(Boolean).join("、");
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2"><TerminalIcon />SSH 凭据</CardTitle>
          <Badge variant="secondary">SSH</Badge>
        </div>
        <CardDescription>{ssh.title}</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="flex flex-col gap-2 text-sm">
          <PreviewRow label="内容" value={material} />
          {ssh.host ? <PreviewRow label="主机" value={ssh.host} /> : null}
          {ssh.username ? <PreviewRow label="用户名" value={ssh.username} /> : null}
          <PreviewRow label="端口" value={String(ssh.port)} />
          {ssh.keyPassphrase ? <PreviewRow label="密钥口令" value="••••••••" /> : null}
        </dl>
      </CardContent>
    </Card>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[4rem_minmax(0,1fr)] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
}

function safeHostname(pageUrl: string): string {
  try { return new URL(pageUrl).hostname; } catch { return "当前页面"; }
}

function maskedSecret(value: string): string {
  return value.length <= 12 ? "••••••••" : `${value.slice(0, 6)}••••${value.slice(-4)}`;
}

function secretKindLabel(kind: NonNullable<DetectedInformation["data"]["secrets"]>[number]["kind"]): string {
  return kind === "api-key" ? "API Key"
    : kind === "access-token" ? "访问令牌"
      : kind === "authenticator-key" ? "认证密钥"
        : kind === "client-secret" ? "客户端密钥"
          : kind === "webhook-secret" ? "Webhook"
            : kind === "database-credential" ? "数据库凭据"
              : kind === "recovery-codes" ? "恢复码"
                : kind === "certificate" ? "证书与 PEM"
                  : kind === "software-license" ? "软件许可证"
                    : kind === "identity-document" ? "身份证件"
                      : kind === "secure-note" ? "安全笔记"
                        : kind === "crypto-wallet" ? "加密钱包"
                          : "其他";
}

function secretValueLabel(kind: NonNullable<DetectedInformation["data"]["secrets"]>[number]["kind"]): string {
  return ["api-key", "access-token", "authenticator-key", "client-secret", "webhook-secret"].includes(kind) ? "密钥值" : "内容";
}
