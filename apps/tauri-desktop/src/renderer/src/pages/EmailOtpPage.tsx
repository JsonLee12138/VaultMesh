import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  CheckCircle2Icon,
  Clock3Icon,
  CopyIcon,
  MailCheckIcon,
  PencilIcon,
  PlusIcon,
  RadarIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
  Trash2Icon,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { EMAIL_PROVIDER_PRESETS, emailProviderPreset } from '../../../shared/email-providers';
import { DEFAULT_EMAIL_OTP_SETTINGS } from '../../../shared/contracts';
import type {
  EmailAccountInput,
  EmailAccountSummary,
  EmailOtpCandidate,
  EmailOtpSettings,
  EmailOAuthAvailability,
  EmailProvider,
} from '../../../shared/contracts';

type AccountForm = EmailAccountInput;

const initialForm = (): AccountForm => {
  const preset = emailProviderPreset('gmail');
  return {
    label: '', address: '', provider: preset.id, authKind: preset.authKind, credential: '',
    imapHost: preset.imapHost, imapPort: preset.imapPort, useTls: preset.useTls, enabled: true,
  };
};

export function EmailOtpPage() {
  const [accounts, setAccounts] = useState<EmailAccountSummary[]>([]);
  const [settings, setSettings] = useState<EmailOtpSettings>(DEFAULT_EMAIL_OTP_SETTINGS);
  const [candidates, setCandidates] = useState<EmailOtpCandidate[]>([]);
  const [editing, setEditing] = useState<EmailAccountSummary | null>(null);
  const [form, setForm] = useState<AccountForm>(initialForm);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [copyingCode, setCopyingCode] = useState<string | null>(null);
  const [oauthAvailability, setOauthAvailability] = useState<EmailOAuthAvailability>({ gmail: false, outlook: false });

  const enabledCount = useMemo(() => accounts.filter((account) => account.enabled).length, [accounts]);

  const load = async (): Promise<void> => {
    try {
      const [nextAccounts, nextSettings, nextOauthAvailability] = await Promise.all([
        window.vaultMesh.emailOtp.accounts(),
        window.vaultMesh.emailOtp.settings(),
        window.vaultMesh.emailOtp.oauthAvailability(),
      ]);
      setAccounts(nextAccounts);
      setSettings(nextSettings);
      setOauthAvailability(nextOauthAvailability);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法读取邮箱配置。');
    }
  };

  useEffect(() => {
    void load();
    return window.vaultMesh.emailOtp.onCandidates((nextCandidates) => setCandidates(nextCandidates));
  }, []);

  const openNew = (): void => {
    setEditing(null);
    setForm(initialForm());
    setDialogOpen(true);
  };

  const openEdit = (account: EmailAccountSummary): void => {
    setEditing(account);
    setForm({
      label: account.label, address: account.address, provider: account.provider, authKind: account.authKind,
      credential: '', imapHost: account.imapHost, imapPort: account.imapPort, useTls: account.useTls, enabled: account.enabled,
    });
    setDialogOpen(true);
  };

  const selectProvider = (provider: EmailProvider): void => {
    const preset = emailProviderPreset(provider);
    setForm((current) => ({
      ...current, provider, authKind: preset.authKind, imapHost: preset.imapHost,
      imapPort: preset.imapPort, useTls: preset.useTls,
    }));
  };

  const saveAccount = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (form.authKind !== 'oauth' && !form.credential && !editing) {
      toast.error('请输入授权码或 OAuth 访问令牌。');
      return;
    }
    setBusy(true);
    try {
      if (!editing && form.authKind === 'oauth' && (form.provider === 'gmail' || form.provider === 'outlook')) {
        const available = oauthAvailability[form.provider];
        if (!available) throw new Error(`${form.provider === 'gmail' ? 'Google' : 'Microsoft'} OAuth Client ID 尚未配置。`);
        await window.vaultMesh.emailOtp.connectOAuth({ provider: form.provider, label: form.label });
        toast.success('邮箱授权成功，账户已添加。');
      } else if (editing) {
        await window.vaultMesh.emailOtp.updateAccount({ ...form, id: editing.id, credential: form.credential || null });
        toast.success('邮箱账户已更新。');
      } else {
        await window.vaultMesh.emailOtp.addAccount(form);
        toast.success('邮箱账户已添加。');
      }
      setDialogOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '邮箱账户保存失败。');
    } finally {
      setBusy(false);
    }
  };

  const removeAccount = async (id: string): Promise<void> => {
    setBusy(true);
    try {
      await window.vaultMesh.emailOtp.deleteAccount(id);
      setCandidates((current) => current.filter((candidate) => candidate.accountId !== id));
      await load();
      toast.success('邮箱账户已删除。');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败。');
    } finally {
      setBusy(false);
    }
  };

  const testAccount = async (id: string): Promise<void> => {
    setTestingId(id);
    try {
      const result = await window.vaultMesh.emailOtp.testAccount(id);
      setAccounts((current) => current.map((account) => account.id === id ? result : account));
      result.status === 'connected' ? toast.success('连接成功，已打开收件箱。') : toast.error(result.statusMessage ?? '连接失败。');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '连接测试失败。');
    } finally {
      setTestingId(null);
    }
  };

  const saveSettings = async (): Promise<void> => {
    setBusy(true);
    try {
      setSettings(await window.vaultMesh.emailOtp.updateSettings(settings));
      toast.success('验证码读取设置已保存。');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '设置保存失败。');
    } finally {
      setBusy(false);
    }
  };

  const scan = async (): Promise<void> => {
    setBusy(true);
    try {
      const results = await window.vaultMesh.emailOtp.scan();
      setCandidates(results);
      toast.success(results.length ? `找到 ${results.length} 个最近验证码。` : '最近邮件中没有找到验证码。');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '扫描失败。');
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async (code: string): Promise<void> => {
    setCopyingCode(code);
    try {
      const result = await window.vaultMesh.emailOtp.copyCode(code);
      toast.success(`验证码已复制，将在 ${Math.max(1, Math.round((result.clearsAt - Date.now()) / 1000))} 秒后清除。`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法复制验证码。');
    } finally {
      setCopyingCode((current) => current === code ? null : current);
    }
  };

  const preset = emailProviderPreset(form.provider);

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-8 lg:grid-cols-[minmax(0,1.65fr)_minmax(18rem,0.85fr)]">
      <section className="flex min-w-0 flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><MailCheckIcon />邮箱账户</CardTitle>
            <CardDescription>账户授权信息保存在加密 Vault 中；锁定 Vault 后立即停止读取。</CardDescription>
            <CardAction><Button type="button" onClick={openNew}><PlusIcon data-icon="inline-start" />添加邮箱</Button></CardAction>
          </CardHeader>
          <CardContent>
            {accounts.length ? (
              <div className="divide-y rounded-md border">
                {accounts.map((account) => (
                  <div key={account.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-medium">{account.label}</p>
                        <Badge variant="secondary">{emailProviderPreset(account.provider).name}</Badge>
                        <ConnectionBadge account={account} />
                        {!account.enabled ? <Badge variant="outline">已暂停</Badge> : null}
                      </div>
                      <p className="mt-1 truncate text-sm text-muted-foreground">{account.address} · {account.imapHost}:{account.imapPort}</p>
                      {account.statusMessage ? <p className="mt-1 text-xs text-muted-foreground">{account.statusMessage}</p> : null}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button variant="outline" size="sm" type="button" disabled={testingId === account.id} onClick={() => void testAccount(account.id)}>
                        <RefreshCwIcon data-icon="inline-start" className={testingId === account.id ? 'animate-spin' : ''} />测试
                      </Button>
                      <Button variant="ghost" size="icon-sm" type="button" aria-label={`编辑 ${account.label}`} onClick={() => openEdit(account)}><PencilIcon /></Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild><Button variant="ghost" size="icon-sm" type="button" aria-label={`删除 ${account.label}`}><Trash2Icon /></Button></AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader><AlertDialogTitle>删除邮箱账户？</AlertDialogTitle><AlertDialogDescription>将从加密 Vault 中删除 {account.address} 的授权信息，此操作无法撤销。</AlertDialogDescription></AlertDialogHeader>
                          <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void removeAccount(account.id)}>确认删除</AlertDialogAction></AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty>
                <EmptyHeader><EmptyMedia variant="icon"><MailCheckIcon /></EmptyMedia><EmptyTitle>还没有邮箱账户</EmptyTitle><EmptyDescription>添加 Gmail、Outlook、QQ、网易或其他 IMAP 邮箱，读取最近的验证码邮件。</EmptyDescription></EmptyHeader>
                <Button type="button" variant="outline" onClick={openNew}><PlusIcon data-icon="inline-start" />添加第一个邮箱</Button>
              </Empty>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><RadarIcon />最近验证码</CardTitle>
            <CardDescription>只扫描设定时间范围内的邮件；验证码不会写入历史记录。</CardDescription>
            <CardAction><Button type="button" disabled={busy || !settings.enabled || enabledCount === 0} onClick={() => void scan()}><RadarIcon data-icon="inline-start" />立即扫描</Button></CardAction>
          </CardHeader>
          <CardContent>
            {candidates.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {candidates.map((candidate, index) => (
                  <Card key={`${candidate.accountId}-${candidate.receivedAt}-${index}`} size="sm">
                    <CardHeader><CardTitle className="font-mono text-2xl tracking-[0.18em]">{candidate.code}</CardTitle><CardDescription className="truncate">{candidate.subject}</CardDescription><CardAction><Button type="button" size="icon-sm" variant="ghost" aria-label={`复制验证码 ${candidate.code}`} disabled={copyingCode === candidate.code} onClick={() => void copyCode(candidate.code)}><CopyIcon /></Button></CardAction></CardHeader>
                    <CardContent><p className="truncate text-xs text-muted-foreground">{candidate.sender} · {new Date(candidate.receivedAt * 1000).toLocaleTimeString()}</p></CardContent>
                  </Card>
                ))}
              </div>
            ) : <p className="py-8 text-center text-sm text-muted-foreground">启用读取并点击“立即扫描”后，最近验证码会临时显示在这里。</p>}
          </CardContent>
        </Card>
      </section>

      <aside className="flex flex-col gap-6">
        <Card>
          <CardHeader><CardTitle>读取设置</CardTitle><CardDescription>这些是非敏感的本机策略设置。</CardDescription></CardHeader>
          <CardContent>
            <FieldGroup>
              <Field orientation="horizontal"><FieldContent><FieldLabel htmlFor="email-otp-enabled">启用连续增量监听</FieldLabel><FieldDescription>桌面端或插件任一解锁时运行；全部锁定后停止。</FieldDescription></FieldContent><Switch id="email-otp-enabled" checked={settings.enabled} onCheckedChange={(enabled) => setSettings((current) => ({ ...current, enabled }))} /></Field>
              <Field><FieldLabel htmlFor="poll-interval">后台检查间隔（秒）</FieldLabel><Input id="poll-interval" type="number" min={5} max={300} value={settings.pollIntervalSeconds} onChange={(event) => setSettings((current) => ({ ...current, pollIntervalSeconds: Number(event.target.value) }))} /><FieldDescription>默认每 10 秒增量检查；浏览器出现验证码输入框时会临时加速到每 3 秒。</FieldDescription></Field>
              <Field><FieldLabel htmlFor="lookback">扫描最近（分钟）</FieldLabel><Input id="lookback" type="number" min={1} max={30} value={settings.messageLookbackMinutes} onChange={(event) => setSettings((current) => ({ ...current, messageLookbackMinutes: Number(event.target.value) }))} /></Field>
              <Field><FieldLabel htmlFor="code-lifetime">验证码保留（秒）</FieldLabel><Input id="code-lifetime" type="number" min={30} max={300} value={settings.codeLifetimeSeconds} onChange={(event) => setSettings((current) => ({ ...current, codeLifetimeSeconds: Number(event.target.value) }))} /></Field>
              <Field orientation="horizontal"><FieldContent><FieldLabel htmlFor="only-unread">仅扫描未读邮件</FieldLabel><FieldDescription>减少重复结果和读取范围。</FieldDescription></FieldContent><Switch id="only-unread" checked={settings.onlyUnreadMessages} onCheckedChange={(onlyUnreadMessages) => setSettings((current) => ({ ...current, onlyUnreadMessages }))} /></Field>
              <Button type="button" disabled={busy} onClick={() => void saveSettings()}>保存设置</Button>
            </FieldGroup>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlertIcon />安全边界</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
            <p>邮箱授权信息与密码条目使用同一套 Vault 加密。</p><p>邮件正文只在内存中解析，不保存、不上传。</p><p>复制的验证码沿用敏感剪贴板自动清除策略。</p>
          </CardContent>
        </Card>
      </aside>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <form onSubmit={saveAccount}>
            <DialogHeader><DialogTitle>{editing ? '编辑邮箱账户' : '添加邮箱账户'}</DialogTitle><DialogDescription>选择服务商后会自动填入安全的 IMAP 预设。授权信息只保存到加密 Vault。</DialogDescription></DialogHeader>
            <FieldGroup className="py-5">
              <Field><FieldLabel htmlFor="email-provider">邮箱服务商</FieldLabel><Select value={form.provider} onValueChange={(value) => selectProvider(value as EmailProvider)}><SelectTrigger id="email-provider"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{EMAIL_PROVIDER_PRESETS.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectGroup></SelectContent></Select><FieldDescription>{preset.help}</FieldDescription></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field><FieldLabel htmlFor="email-label">账户名称</FieldLabel><Input id="email-label" required maxLength={128} placeholder="工作邮箱" value={form.label} onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))} /></Field>
                <Field><FieldLabel htmlFor="email-address">邮箱地址</FieldLabel><Input id="email-address" required={form.authKind !== 'oauth' || Boolean(editing)} disabled={form.authKind === 'oauth' && !editing} type="email" autoComplete="username" placeholder={form.authKind === 'oauth' && !editing ? '授权后自动读取' : 'name@example.com'} value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} /></Field>
              </div>
              {form.authKind !== 'oauth' ? <Field><FieldLabel htmlFor="email-credential">{preset.credentialLabel}</FieldLabel><Input id="email-credential" required={!editing} type="password" autoComplete="new-password" placeholder={editing ? '留空则保持现有授权信息' : '输入授权信息'} value={form.credential} onChange={(event) => setForm((current) => ({ ...current, credential: event.target.value }))} /><FieldDescription>不要填写网页登录密码，请使用邮箱服务商生成的专用授权码。</FieldDescription></Field> : (
                <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
                  {editing ? 'OAuth 令牌会自动刷新；如授权失效，请删除后重新连接。' : oauthAvailability[form.provider as 'gmail' | 'outlook'] ? '保存时将打开系统浏览器完成只读邮箱授权。' : `需要先配置 ${form.provider === 'gmail' ? 'Google' : 'Microsoft'} OAuth Client ID。`}
                </div>
              )}
              {form.authKind !== 'oauth' ? <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-4">
                <Field><FieldLabel htmlFor="imap-host">IMAP 主机</FieldLabel><Input id="imap-host" required value={form.imapHost} onChange={(event) => setForm((current) => ({ ...current, imapHost: event.target.value }))} /></Field>
                <Field><FieldLabel htmlFor="imap-port">端口</FieldLabel><Input id="imap-port" required type="number" min={1} max={65535} value={form.imapPort} onChange={(event) => setForm((current) => ({ ...current, imapPort: Number(event.target.value) }))} /></Field>
              </div> : null}
              {form.authKind !== 'oauth' ? <Field orientation="horizontal"><FieldContent><FieldLabel htmlFor="imap-tls">使用 TLS</FieldLabel><FieldDescription>生产环境应保持开启。</FieldDescription></FieldContent><Switch id="imap-tls" checked={form.useTls} onCheckedChange={(useTls) => setForm((current) => ({ ...current, useTls }))} /></Field> : null}
              <Field orientation="horizontal"><FieldContent><FieldLabel htmlFor="account-enabled">启用此账户</FieldLabel><FieldDescription>关闭后不会扫描该收件箱。</FieldDescription></FieldContent><Switch id="account-enabled" checked={form.enabled} onCheckedChange={(enabled) => setForm((current) => ({ ...current, enabled }))} /></Field>
            </FieldGroup>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>取消</Button><Button type="submit" disabled={busy || (!editing && form.authKind === 'oauth' && !oauthAvailability[form.provider as 'gmail' | 'outlook'])}>{editing ? '保存更改' : form.authKind === 'oauth' ? `使用 ${form.provider === 'gmail' ? 'Google' : 'Microsoft'} 连接` : '添加账户'}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ConnectionBadge({ account }: { account: EmailAccountSummary }) {
  if (account.status === 'connected') return <Badge><CheckCircle2Icon data-icon="inline-start" />已连接</Badge>;
  if (account.status === 'error') return <Badge variant="destructive"><ShieldAlertIcon data-icon="inline-start" />连接失败</Badge>;
  return <Badge variant="outline"><Clock3Icon data-icon="inline-start" />未测试</Badge>;
}
