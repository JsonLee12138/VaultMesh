import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ClipboardPasteIcon, FileTextIcon, KeyRoundIcon, ServerIcon, ShieldCheckIcon, SlidersHorizontalIcon, StarIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';

import { SectionedEditorForm } from '../components/SectionedEditorForm';
import { SshKeyGeneratorDialog } from '../components/SshKeyGeneratorDialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useVaultStore } from '@/stores/vault-store';

interface Props { sshId?: string; }

export function SshCredentialEditorPage({ sshId }: Props) {
  const navigate = useNavigate();
  const busy = useVaultStore((state) => state.busy);
  const error = useVaultStore((state) => state.error);
  const clearError = useVaultStore((state) => state.clearError);
  const add = useVaultStore((state) => state.addSshCredential);
  const update = useVaultStore((state) => state.updateSshCredential);
  const detail = useVaultStore((state) => state.getSshCredentialDetail);
  const [loading, setLoading] = useState(Boolean(sshId));
  const [importing, setImporting] = useState(false);
  const [title, setTitle] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [keyPassphrase, setKeyPassphrase] = useState('');
  const [notes, setNotes] = useState('');
  const [folder, setFolder] = useState('');
  const [favorite, setFavorite] = useState(false);
  const [reprompt, setReprompt] = useState(false);
  const [recordKind, setRecordKind] = useState<'account' | 'key'>('account');
  const [managedSshAlias, setManagedSshAlias] = useState<string | null>(null);
  const [hasPassword, setHasPassword] = useState(false);
  const [hasPublicKey, setHasPublicKey] = useState(false);
  const [hasPrivateKey, setHasPrivateKey] = useState(false);
  const [hasPassphrase, setHasPassphrase] = useState(false);
  const [clearPassword, setClearPassword] = useState(false);
  const [clearPublicKey, setClearPublicKey] = useState(false);
  const [clearPrivateKey, setClearPrivateKey] = useState(false);
  const [clearPassphrase, setClearPassphrase] = useState(false);

  useEffect(() => {
    if (!sshId) return;
    void detail(sshId).then((item) => {
      if (!item) return;
      setTitle(item.title); setHost(item.host ?? ''); setPort(String(item.port)); setUsername(item.username);
      setNotes(item.notes ?? ''); setFolder(item.folder ?? ''); setFavorite(item.favorite); setReprompt(item.masterPasswordReprompt);
      setRecordKind(item.recordKind);
      setManagedSshAlias(item.managedSshAlias);
      setHasPassword(item.hasPassword); setHasPublicKey(item.hasPublicKey); setHasPrivateKey(item.hasPrivateKey); setHasPassphrase(item.hasKeyPassphrase);
    }).finally(() => setLoading(false));
  }, [sshId]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault(); clearError();
    const numericPort = Number(port);
    const common = {
      title, host: recordKind === 'account' ? nullIfEmpty(host) : null, port: numericPort, username: recordKind === 'account' ? username : '',
      notes: nullIfEmpty(notes), folder: nullIfEmpty(folder), favorite,
      masterPasswordReprompt: reprompt, recordKind,
    };
    const succeeded = sshId ? await update({
      id: sshId, ...common,
      password: recordKind === 'account' ? nullIfEmpty(password) : null, clearPassword,
      publicKey: recordKind === 'key' ? nullIfEmpty(publicKey) : null, clearPublicKey: recordKind === 'account' ? hasPublicKey : clearPublicKey,
      privateKey: recordKind === 'key' ? nullIfEmpty(privateKey) : null, clearPrivateKey: recordKind === 'account' ? hasPrivateKey : clearPrivateKey,
      keyPassphrase: recordKind === 'key' ? nullIfEmpty(keyPassphrase) : null, clearKeyPassphrase: recordKind === 'account' ? hasPassphrase : clearPassphrase,
    }) : await add({
      ...common,
      password: recordKind === 'account' ? nullIfEmpty(password) : null,
      publicKey: recordKind === 'key' ? nullIfEmpty(publicKey) : null,
      privateKey: recordKind === 'key' ? nullIfEmpty(privateKey) : null,
      keyPassphrase: recordKind === 'key' ? nullIfEmpty(keyPassphrase) : null,
    });
    if (succeeded) { toast.success(sshId ? 'SSH 凭据已更新。' : 'SSH 凭据已保存。'); await navigate({ to: '/vault' }); }
  };

  const importFromClipboard = async (): Promise<void> => {
    setImporting(true);
    try {
      const imported = await window.vaultMesh.ssh.importFromClipboard();
      setTitle(imported.title);
      setHost(imported.host);
      setPort(String(imported.port));
      setUsername(imported.username);
      if (imported.notes) setNotes((current) => [current.trim(), imported.notes].filter(Boolean).join('\n'));
      toast.success('已从剪贴板导入 SSH 命令，请补充身份验证信息。');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '无法从剪贴板导入 SSH 命令。');
    } finally {
      setImporting(false);
    }
  };

  if (loading) return <div className="grid min-h-[50vh] place-items-center"><Spinner /></div>;

  return <SectionedEditorForm
    formId="ssh-editor"
    error={error}
    busy={busy}
    submitLabel="保存 SSH 凭据"
    onCancel={() => void navigate({ to: '/vault' })}
    onSubmit={(event) => void submit(event)}
    sections={[
      {
        id: 'basics', label: '基本信息', description: '选择记录类型并为凭据命名。', icon: FileTextIcon,
        complete: Boolean(title.trim()),
        content: <FieldGroup>
          <Field><FieldLabel htmlFor="ssh-title">名称</FieldLabel><Input id="ssh-title" required maxLength={256} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={recordKind === 'account' ? '生产服务器' : '本设备默认密钥'} />{managedSshAlias && <FieldDescription>修改名称不会改变 OpenSSH 别名。</FieldDescription>}</Field>
          <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Field><FieldLabel htmlFor="ssh-record-kind">记录类型</FieldLabel><Select value={recordKind} onValueChange={(value) => setRecordKind(value as typeof recordKind)} disabled={Boolean(sshId)}><SelectTrigger id="ssh-record-kind" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="account">SSH 服务器账号</SelectItem><SelectItem value="key">SSH 密钥</SelectItem></SelectGroup></SelectContent></Select><FieldDescription>服务器账号与可复用 SSH 密钥独立保存。</FieldDescription></Field>
            <Field className="sm:w-auto"><FieldLabel htmlFor="ssh-favorite">收藏</FieldLabel><Button className="w-full sm:w-fit" id="ssh-favorite" variant={favorite ? 'default' : 'outline'} type="button" aria-pressed={favorite} onClick={() => setFavorite((value) => !value)}><StarIcon data-icon="inline-start" className={favorite ? 'fill-current' : undefined} />{favorite ? '已收藏' : '加入收藏'}</Button></Field>
          </div>
          {managedSshAlias && <Field><FieldLabel htmlFor="ssh-managed-alias">OpenSSH 别名</FieldLabel><Input id="ssh-managed-alias" className="font-mono" value={managedSshAlias} readOnly aria-readonly="true" /><FieldDescription>终端命令：<code>ssh {managedSshAlias}</code>。别名由 VaultMesh 托管，不能在普通凭据表单中修改。</FieldDescription></Field>}
        </FieldGroup>,
      },
      {
        id: 'connection', label: recordKind === 'account' ? '连接信息' : '密钥归属', description: recordKind === 'account' ? '保存服务器地址和账号。' : '独立密钥不绑定主机，连接时可以按需选择。', icon: ServerIcon,
        complete: recordKind === 'key' || Boolean(host.trim() && username.trim()),
        content: <FieldGroup>
          {!sshId && recordKind === 'account' && <Button className="w-fit" variant="outline" type="button" disabled={importing} onClick={() => void importFromClipboard()}>{importing ? <Spinner data-icon="inline-start" /> : <ClipboardPasteIcon data-icon="inline-start" />}{importing ? '正在读取…' : '从剪贴板导入'}</Button>}
          {recordKind === 'account' ? <>
            <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_8rem]"><Field><FieldLabel htmlFor="ssh-host">主机</FieldLabel><Input id="ssh-host" required maxLength={256} value={host} onChange={(event) => setHost(event.target.value)} placeholder="server.example.com" /></Field><Field><FieldLabel htmlFor="ssh-port">端口</FieldLabel><Input id="ssh-port" type="number" min={1} max={65535} required value={port} onChange={(event) => setPort(event.target.value)} /></Field></div>
            <Field><FieldLabel htmlFor="ssh-user">用户名</FieldLabel><Input id="ssh-user" required maxLength={2048} value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" /></Field>
          </> : <FieldDescription>没有主机的记录会作为独立 SSH 密钥显示，并可被服务器账号选用。</FieldDescription>}
        </FieldGroup>,
      },
      {
        id: 'authentication', label: '身份验证', description: recordKind === 'key' && hasPrivateKey && !hasPublicKey ? '当前记录只有私钥；可以补充对应公钥，也可以继续保留仅私钥记录。' : '管理密码、公钥、私钥与私钥口令。', icon: KeyRoundIcon,
        complete: hasPassword || hasPublicKey || hasPrivateKey || Boolean(password || publicKey || privateKey),
        content: <FieldGroup>
          {recordKind === 'key' && !managedSshAlias && <div className="flex justify-end"><SshKeyGeneratorDialog currentLabel={title} disabled={busy} onGenerated={(generated) => {
            setTitle(generated.label);
            setPublicKey(generated.publicKey); setClearPublicKey(false);
            setPrivateKey(generated.privateKey); setClearPrivateKey(false);
            setKeyPassphrase(generated.keyPassphrase ?? '');
            setClearPassphrase(generated.keyPassphrase === null && hasPassphrase);
          }} /></div>}
          {recordKind === 'account' && <SecretInput id="ssh-password" label="SSH 密码" value={password} setValue={(value) => { setPassword(value); setClearPassword(false); }} hasExisting={hasPassword} clear={clearPassword} setClear={setClearPassword} singleLine />}
          {recordKind === 'key' && managedSshAlias && <Alert><ShieldCheckIcon /><AlertTitle>VaultMesh 托管密钥</AlertTitle><AlertDescription>公私钥由 OpenSSH 主机配置使用，不能在普通编辑表单中替换或清除。</AlertDescription></Alert>}
          {recordKind === 'key' && !managedSshAlias && <><SecretInput id="ssh-public-key" label="公钥" value={publicKey} setValue={(value) => { setPublicKey(value); setClearPublicKey(false); }} hasExisting={hasPublicKey} clear={clearPublicKey} setClear={setClearPublicKey} /><SecretInput id="ssh-private-key" label="私钥" value={privateKey} setValue={(value) => { setPrivateKey(value); setClearPrivateKey(false); }} hasExisting={hasPrivateKey} clear={clearPrivateKey} setClear={(value) => { setClearPrivateKey(value); if (value) setClearPassphrase(true); }} /><SecretInput id="ssh-passphrase" label="私钥口令" value={keyPassphrase} setValue={(value) => { setKeyPassphrase(value); setClearPassphrase(false); }} hasExisting={hasPassphrase} clear={clearPassphrase} setClear={setClearPassphrase} singleLine /></>}
        </FieldGroup>,
      },
      {
        id: 'protection', label: '访问保护', description: '控制复制敏感认证材料时的二次验证。', icon: ShieldCheckIcon,
        complete: reprompt,
        content: <FieldGroup>{!managedSshAlias ? <Field orientation="horizontal"><FieldLabel htmlFor="ssh-reprompt">复制密码、私钥或口令前再次验证主密码</FieldLabel><Switch id="ssh-reprompt" checked={reprompt} onCheckedChange={setReprompt} /></Field> : <FieldDescription>托管 OpenSSH 密钥由受限主机流程控制，不支持在普通编辑表单中读取或复制。</FieldDescription>}</FieldGroup>,
      },
      {
        id: 'additional', label: '附加选项', description: '补充备注和文件夹信息。', icon: SlidersHorizontalIcon,
        complete: Boolean(notes.trim() || folder.trim()),
        content: <FieldGroup><Field><FieldLabel htmlFor="ssh-notes">备注</FieldLabel><Textarea id="ssh-notes" rows={6} maxLength={10_000} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field><Field><FieldLabel htmlFor="ssh-folder">文件夹</FieldLabel><Input id="ssh-folder" maxLength={256} value={folder} onChange={(event) => setFolder(event.target.value)} /></Field></FieldGroup>,
      },
    ]}
  />;
}

function SecretInput({ id, label, value, setValue, hasExisting, clear, setClear, singleLine = false }: { id: string; label: string; value: string; setValue(value: string): void; hasExisting: boolean; clear: boolean; setClear(value: boolean): void; singleLine?: boolean }) {
  return <Field><FieldLabel htmlFor={id}>{label}</FieldLabel>{singleLine ? <Input id={id} type="password" maxLength={10_000} value={value} onChange={(event) => setValue(event.target.value)} placeholder={hasExisting ? '已保存；留空以保留' : '可选'} /> : <Textarea id={id} className="min-h-28 font-mono text-xs" maxLength={1024 * 1024} value={value} onChange={(event) => setValue(event.target.value)} placeholder={hasExisting ? '已保存；留空以保留' : '粘贴 OpenSSH / PEM 内容'} />}{hasExisting && <><FieldDescription>现有内容不会加载到界面。</FieldDescription><Button className="w-fit" variant="outline" size="sm" type="button" onClick={() => { setClear(!clear); if (!clear) setValue(''); }}><Trash2Icon data-icon="inline-start" />{clear ? '取消清除' : `清除已保存${label}`}</Button></>}</Field>;
}

function nullIfEmpty(value: string): string | null { const trimmed = value.trim(); return trimmed ? trimmed : null; }
