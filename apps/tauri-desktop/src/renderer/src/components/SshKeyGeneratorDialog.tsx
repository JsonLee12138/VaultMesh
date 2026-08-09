import { useState, type FormEvent } from 'react';
import { KeyRoundIcon } from 'lucide-react';
import { toast } from 'sonner';

import { PasswordField } from '@/components/PasswordField';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import type { SshKeyAlgorithm, SshKeyGenerationResult } from '../../../shared/contracts';

interface GeneratedKeyPair extends SshKeyGenerationResult { label: string; }

interface Props {
  currentLabel: string;
  disabled?: boolean;
  onGenerated(result: GeneratedKeyPair): void;
}

export function SshKeyGeneratorDialog({ currentLabel, disabled = false, onGenerated }: Props) {
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [label, setLabel] = useState('');
  const [algorithm, setAlgorithm] = useState<SshKeyAlgorithm>('ed25519');
  const [keySize, setKeySize] = useState<number | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [savePassphrase, setSavePassphrase] = useState(false);
  const [storage, setStorage] = useState<'managedDefault' | 'managedNamed' | 'vaultOnly'>('managedDefault');
  const [error, setError] = useState<string | null>(null);

  const changeOpen = (nextOpen: boolean): void => {
    if (generating) return;
    setOpen(nextOpen);
    setError(null);
    if (nextOpen) {
      setLabel(currentLabel.trim() || 'SSH 密钥');
      setAlgorithm('ed25519');
      setKeySize(null);
      setPassphrase('');
      setSavePassphrase(false);
      setStorage('managedDefault');
    }
  };

  const changeAlgorithm = (value: SshKeyAlgorithm): void => {
    setAlgorithm(value);
    setKeySize(value === 'ecdsa' ? 256 : value === 'rsa' ? 3072 : null);
    if (value !== 'ed25519' && storage === 'managedDefault') setStorage('managedNamed');
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setGenerating(true);
    setError(null);
    try {
      const generated = await window.vaultMesh.ssh.generateKeyPair({
        label: label.trim(),
        algorithm,
        keySize: keySize as 256 | 384 | 521 | 2048 | 3072 | 4096 | null,
        passphrase: passphrase || null,
        savePassphrase,
        storage,
      });
      onGenerated({ label: label.trim(), ...generated });
      setOpen(false);
      setPassphrase('');
      toast.success(generated.privateKeyPath ? `密钥对已生成到 ${generated.privateKeyPath}，请保存 SSH 密钥。` : '密钥对已生成，请保存 SSH 密钥。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法生成 SSH 密钥对。');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" type="button" disabled={disabled}>
          <KeyRoundIcon data-icon="inline-start" />生成密钥对
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>生成 SSH 密钥对</DialogTitle>
          <DialogDescription>密钥会在本机生成并回填到当前凭据，只有保存凭据后才会写入加密保险库。</DialogDescription>
        </DialogHeader>
        <form id="ssh-key-generator" onSubmit={(event) => void submit(event)}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="ssh-key-label">标签</FieldLabel>
              <Input id="ssh-key-label" required maxLength={256} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="工作站密钥" />
              <FieldDescription>同时作为凭据名称和 OpenSSH 公钥注释。</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>密钥类型</FieldLabel>
              <Select value={algorithm} onValueChange={(value) => changeAlgorithm(value as SshKeyAlgorithm)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ed25519">ED25519</SelectItem>
                  <SelectItem value="ecdsa">ECDSA</SelectItem>
                  <SelectItem value="rsa">RSA</SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription>{algorithmDescription(algorithm)}</FieldDescription>
            </Field>
            {(algorithm === 'ecdsa' || algorithm === 'rsa') && (
              <Field>
                <FieldLabel>密钥长度</FieldLabel>
                <Select value={String(keySize)} onValueChange={(value) => setKeySize(Number(value))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(algorithm === 'ecdsa' ? [256, 384, 521] : [2048, 3072, 4096]).map((size) => (
                      <SelectItem key={size} value={String(size)}>{size} 位</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            <PasswordField id="ssh-key-passphrase" label="私钥口令（可选）" value={passphrase} onChange={(value) => {
              setPassphrase(value);
              if (!value) setSavePassphrase(false);
            }} placeholder="用于加密生成的私钥" />
            <Field>
              <FieldLabel>私钥存储</FieldLabel>
              <Select value={storage} onValueChange={(value) => setStorage(value as typeof storage)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="managedDefault">本设备默认密钥（推荐）</SelectItem>
                  <SelectItem value="managedNamed">受管目录中的独立密钥</SelectItem>
                  <SelectItem value="vaultOnly">仅保存到加密保险库</SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription>{storage === 'managedDefault' ? '写入 ~/.ssh/vaultmesh/id_ed25519；已有文件绝不会覆盖。' : storage === 'managedNamed' ? '按标签写入 ~/.ssh/vaultmesh/keys/。' : '不会写入文件；外部终端使用时需要另行指定私钥路径。'}</FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <input id="ssh-key-save-passphrase" type="checkbox" checked={savePassphrase} disabled={!passphrase} onChange={(event) => setSavePassphrase(event.target.checked)} />
              <div>
                <FieldLabel htmlFor="ssh-key-save-passphrase">将口令保存在此 SSH 凭据中</FieldLabel>
                <FieldDescription>关闭时仍会用口令加密私钥，但 VaultMesh 不会保存口令。</FieldDescription>
              </div>
            </Field>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant="outline" type="button" disabled={generating} onClick={() => changeOpen(false)}>取消</Button>
          <Button type="submit" form="ssh-key-generator" disabled={generating || !label.trim()}>
            {generating ? <Spinner data-icon="inline-start" /> : <KeyRoundIcon data-icon="inline-start" />}
            {generating ? '正在生成…' : '生成密钥对'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function algorithmDescription(algorithm: SshKeyAlgorithm): string {
  if (algorithm === 'ed25519') return '推荐用于大多数场景，需要 OpenSSH 6.5 或更高版本。';
  if (algorithm === 'ecdsa') return '适用于需要 NIST 椭圆曲线兼容性的环境。';
  if (algorithm === 'rsa') return '兼容旧系统，推荐使用 3072 位或更高强度。';
  return '该密钥算法当前不可用。';
}
