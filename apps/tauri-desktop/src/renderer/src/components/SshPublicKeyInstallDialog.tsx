import { useEffect, useMemo, useState } from 'react';
import { ServerIcon } from 'lucide-react';
import { toast } from 'sonner';

import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { isInstallableSshPublicKey, isReusableSshKey, sshInstallRequiresMasterPassword } from '@/lib/ssh-credential';
import { useVaultStore } from '@/stores/vault-store';
import type { SshCredentialSummary, SshHostKeyPreview } from '../../../shared/contracts';

interface Props { item: SshCredentialSummary | null; items: SshCredentialSummary[]; onClose(): void }
type Authentication = 'storedPassword' | 'sshAgent' | 'authenticationKey';

export function SshPublicKeyInstallDialog({ item, items, onClose }: Props) {
  const refresh = useVaultStore((state) => state.refresh);
  const accounts = useMemo(() => items.filter((entry) => entry.recordKind === 'account' && entry.host && entry.username), [items]);
  const keyRecords = useMemo(() => items.filter(isReusableSshKey), [items]);
  const installableKeys = useMemo(() => keyRecords.filter(isInstallableSshPublicKey), [keyRecords]);
  const [createdAccount, setCreatedAccount] = useState<SshCredentialSummary | null>(null);
  const [targetId, setTargetId] = useState('new');
  const [preview, setPreview] = useState<SshHostKeyPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [saving, setSaving] = useState(false);
  const [keyId, setKeyId] = useState('');
  const [authentication, setAuthentication] = useState<Authentication>('storedPassword');
  const [authenticationKeyId, setAuthenticationKeyId] = useState('');
  const [title, setTitle] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [masterPassword, setMasterPassword] = useState('');

  const selectedAccount = accounts.find((account) => account.id === targetId)
    ?? (createdAccount?.id === targetId ? createdAccount : null);
  const authenticationKeys = useMemo(() => keyRecords.filter((key) => key.id !== keyId && key.hasPrivateKey), [keyRecords, keyId]);
  const selectedAuthenticationKey = authenticationKeys.find((key) => key.id === authenticationKeyId);
  const selectedKey = installableKeys.find((key) => key.id === keyId);

  useEffect(() => {
    if (!item) return;
    const initialTarget = item.recordKind === 'account' ? item.id : accounts[0]?.id ?? 'new';
    const initialKey = item.recordKind === 'key' && item.hasPublicKey ? item.id : installableKeys[0]?.id ?? '';
    const initialAccount = item.recordKind === 'account' ? item : accounts[0];
    setCreatedAccount(null);
    setTargetId(initialTarget);
    setKeyId(initialKey);
    setAuthentication(initialTarget === 'new' ? 'storedPassword' : initialAccount?.hasPassword ? 'storedPassword' : 'sshAgent');
    setAuthenticationKeyId(keyRecords.find((key) => key.id !== initialKey && key.hasPrivateKey)?.id ?? '');
    setTitle(''); setHost(''); setPort('22'); setUsername(''); setPassword(''); setMasterPassword('');
    setPreview(null); setError(null);
  }, [accounts, installableKeys, item, keyRecords]);

  useEffect(() => {
    if (!item || targetId === 'new') { setPreview(null); return; }
    let cancelled = false;
    setPreview(null); setError(null); setLoading(true);
    void window.vaultMesh.ssh.inspectHostKey(targetId)
      .then((result) => { if (!cancelled) setPreview(result); })
      .catch((reason) => { if (!cancelled) setError(messageOf(reason)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [item, targetId]);

  useEffect(() => {
    if (authentication === 'authenticationKey' && !authenticationKeys.some((key) => key.id === authenticationKeyId)) {
      setAuthenticationKeyId(authenticationKeys[0]?.id ?? '');
    }
  }, [authentication, authenticationKeyId, authenticationKeys]);

  useEffect(() => {
    if (error) {
      toast.error('无法安装公钥', {
        id: 'ssh-public-key-install-error',
        description: error,
      });
    }
  }, [error]);

  const chooseTarget = (id: string): void => {
    setTargetId(id); setError(null); setPreview(null);
    const account = accounts.find((entry) => entry.id === id);
    setAuthentication(id === 'new' ? 'storedPassword' : account?.hasPassword ? 'storedPassword' : 'sshAgent');
  };

  const saveServer = async (): Promise<void> => {
    const numericPort = Number(port);
    if (!title.trim() || !host.trim() || !username.trim() || !Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65_535) {
      setError('请填写服务器名称、主机、有效端口和用户名。'); return;
    }
    if (authentication === 'storedPassword' && !password) { setError('输入新服务器时必须填写登录密码，或改用另一把认证密钥。'); return; }
    if (authentication === 'authenticationKey' && !authenticationKeyId) { setError('请选择用于首次连接的另一把私钥。'); return; }
    setSaving(true); setError(null);
    try {
      const account = await window.vaultMesh.ssh.add({
        title: title.trim(), host: host.trim(), port: numericPort, username: username.trim(),
        password: authentication === 'storedPassword' ? password : null,
        publicKey: null, privateKey: null, keyPassphrase: null,
        notes: null, folder: null, favorite: false, masterPasswordReprompt: false, recordKind: 'account',
      });
      setCreatedAccount(account);
      setTargetId(account.id);
      setPassword('');
      await refresh();
      toast.success('SSH 服务器已保存，正在读取主机密钥指纹。');
    } catch (reason) { setError(messageOf(reason)); } finally { setSaving(false); }
  };

  const install = async (): Promise<void> => {
    if (!selectedAccount || !preview || !keyId) return;
    setInstalling(true); setError(null);
    try {
      const result = await window.vaultMesh.ssh.installPublicKey({
        accountId: selectedAccount.id, keyId, authentication,
        authenticationKeyId: authentication === 'authenticationKey' ? authenticationKeyId || null : null,
        hostKeyFingerprint: preview.fingerprint,
        masterPassword: requiresMasterPassword ? masterPassword : null,
      });
      const installed = result.status === 'installed' ? '公钥已安装到' : '公钥已存在于';
      if (result.keyLoginVerification === 'verified') {
        toast.success(`${installed} ${result.endpoint}，并已直接验证密钥登录成功。`);
      } else if (result.keyLoginVerification === 'unavailable') {
        toast.warning(`${installed} ${result.endpoint}，但所选记录没有可用于验证的私钥。`);
      } else {
        toast.error(`${installed} ${result.endpoint}，但密钥登录验证失败；请检查用户名、私钥口令和服务器公钥认证策略。`);
      }
      onClose();
    } catch (reason) { setError(messageOf(reason)); } finally { setInstalling(false); }
  };

  const newServerValid = Boolean(title.trim() && host.trim() && username.trim()
    && Number.isInteger(Number(port)) && Number(port) >= 1 && Number(port) <= 65_535
    && (authentication === 'storedPassword' ? password : authenticationKeyId));
  const requiresMasterPassword = sshInstallRequiresMasterPassword(
    authentication, selectedKey, selectedAccount, selectedAuthenticationKey,
  );

  return <AlertDialog open={item !== null} onOpenChange={(open) => { if (!open && !installing && !saving) onClose(); }}>
    <AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>将公钥安装到 SSH 服务器</AlertDialogTitle><AlertDialogDescription>选择公钥和目标服务器；新输入的服务器会先保存为独立 SSH 账号。安装后会尽可能验证无密码登录。</AlertDialogDescription></AlertDialogHeader>

      <div className="grid gap-2"><label className="text-sm font-medium">待上传公钥</label><Select value={keyId} onValueChange={setKeyId}><SelectTrigger className="w-full"><SelectValue placeholder="选择 SSH 密钥" /></SelectTrigger><SelectContent>{installableKeys.map((key) => <SelectItem key={key.id} value={key.id}>{key.title}{key.publicKeyFingerprint ? ` · ${key.publicKeyFingerprint.slice(0, 18)}…` : ''}</SelectItem>)}</SelectContent></Select>{installableKeys.length === 0 && <p className="text-xs text-destructive">{keyRecords.some((key) => key.hasPrivateKey) ? '已导入的 SSH 密钥只有私钥；请先编辑该密钥并补充公钥。' : '还没有可用 SSH 密钥，请先创建或扫描导入密钥。'}</p>}</div>

      <div className="grid gap-2"><label className="text-sm font-medium">目标服务器</label><Select value={targetId} onValueChange={chooseTarget}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{accounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.title} · {account.username}@{account.host}</SelectItem>)}<SelectItem value="new">输入并保存新服务器…</SelectItem></SelectContent></Select></div>

      {targetId === 'new' && <div className="grid gap-3 rounded-lg border p-4">
        <div className="grid grid-cols-2 gap-3"><Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="服务器名称" /><Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="用户名" /></div>
        <div className="grid grid-cols-[1fr_7rem] gap-3"><Input value={host} onChange={(event) => setHost(event.target.value)} placeholder="主机名或 IP" /><Input type="number" min={1} max={65_535} value={port} onChange={(event) => setPort(event.target.value)} placeholder="端口" /></div>
      </div>}

      <div className="grid gap-2"><label className="text-sm font-medium">首次连接认证</label><Select value={authentication} onValueChange={(value) => setAuthentication(value as Authentication)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{targetId === 'new' ? <><SelectItem value="storedPassword">使用密码</SelectItem><SelectItem value="authenticationKey">使用另一把已有私钥</SelectItem></> : <>{selectedAccount?.hasPassword && <SelectItem value="storedPassword">使用账号中保存的密码</SelectItem>}<SelectItem value="sshAgent">使用 SSH Agent</SelectItem><SelectItem value="authenticationKey">使用另一把已有私钥</SelectItem></>}</SelectContent></Select></div>
      {targetId === 'new' && authentication === 'storedPassword' && <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="SSH 登录密码（将保存到此账号）" autoComplete="new-password" />}
      {authentication === 'authenticationKey' && <Select value={authenticationKeyId} onValueChange={setAuthenticationKeyId}><SelectTrigger className="w-full"><SelectValue placeholder="选择另一把认证私钥" /></SelectTrigger><SelectContent>{authenticationKeys.map((key) => <SelectItem key={key.id} value={key.id}>{key.title}</SelectItem>)}</SelectContent></Select>}
      {requiresMasterPassword && <Input type="password" value={masterPassword} onChange={(event) => setMasterPassword(event.target.value)} placeholder="输入 Vault 主密码以读取认证秘密" autoComplete="current-password" />}

      {loading && <div className="flex items-center gap-3 rounded-lg border p-4 text-sm text-muted-foreground"><Spinner />正在读取服务器主机密钥…</div>}
      {preview && <div className="grid gap-3 rounded-lg border p-4"><div className="flex items-center gap-2 text-sm font-medium"><ServerIcon className="size-4" />{preview.endpoint}</div><div><p className="text-xs text-muted-foreground">服务器主机密钥指纹</p><p className="mt-1 break-all font-mono text-xs">{preview.fingerprint}</p></div></div>}
      <AlertDialogFooter><AlertDialogCancel disabled={installing || saving}>取消</AlertDialogCancel>{targetId === 'new' ? <Button type="button" disabled={!keyId || !newServerValid || saving} onClick={() => void saveServer()}>{saving && <Spinner data-icon="inline-start" />}{saving ? '正在保存…' : '保存服务器并读取指纹'}</Button> : <Button type="button" disabled={!preview || !keyId || loading || installing || (authentication === 'authenticationKey' && !authenticationKeyId) || (requiresMasterPassword && masterPassword.length < 8)} onClick={() => void install()}>{installing && <Spinner data-icon="inline-start" />}{installing ? '正在安装并验证…' : '确认指纹并安装'}</Button>}</AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}

function messageOf(reason: unknown): string { return reason instanceof Error ? reason.message : '无法连接 SSH 服务器。'; }
