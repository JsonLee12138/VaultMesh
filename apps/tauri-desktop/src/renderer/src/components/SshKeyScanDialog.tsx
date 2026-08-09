import { useRef, useState } from 'react';
import { KeyRoundIcon, RadarIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { useVaultStore } from '@/stores/vault-store';
import type { SshKeyScanPreview } from '../../../shared/contracts';

export function SshKeyScanDialog() {
  const appBusy = useVaultStore((state) => state.busy);
  const refresh = useVaultStore((state) => state.refresh);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<SshKeyScanPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [publicKeys, setPublicKeys] = useState<Record<string, string>>({});
  const [scanBusy, setScanBusy] = useState(false);
  const scanGeneration = useRef(0);

  const discardPreview = async (): Promise<void> => {
    if (preview) await window.vaultMesh.ssh.cancelKeyScan(preview.sessionId).catch(() => undefined);
    setPreview(null);
    setSelected(new Set());
    setPublicKeys({});
  };

  const close = (): void => {
    scanGeneration.current += 1;
    setScanBusy(false);
    void discardPreview();
    setOpen(false);
  };

  const scanKeys = async (): Promise<void> => {
    const generation = scanGeneration.current + 1;
    scanGeneration.current = generation;
    setOpen(true);
    setScanBusy(true);
    try {
      if (preview) await window.vaultMesh.ssh.cancelKeyScan(preview.sessionId);
      const result = await window.vaultMesh.ssh.scanLocalKeys();
      if (generation !== scanGeneration.current) {
        await window.vaultMesh.ssh.cancelKeyScan(result.sessionId).catch(() => undefined);
        return;
      }
      setPreview(result);
      setSelected(new Set(result.items.map((item) => item.entryId)));
      setPublicKeys({});
    } catch (reason) {
      if (generation === scanGeneration.current) toast.error(messageOf(reason));
    } finally {
      if (generation === scanGeneration.current) setScanBusy(false);
    }
  };

  const importKeys = async (): Promise<void> => {
    if (!preview || selected.size === 0) return;
    setScanBusy(true);
    try {
      const result = await window.vaultMesh.ssh.importScannedKeys(preview.sessionId, [...selected].map((entryId) => ({
        entryId,
        publicKey: nullIfEmpty(publicKeys[entryId] ?? ''),
      })));
      setPreview(null);
      setSelected(new Set());
      setPublicKeys({});
      setOpen(false);
      await refresh();
      toast.success(`已导入 ${result.importedCount} 个 SSH 密钥${result.skippedCount ? `，跳过 ${result.skippedCount} 个重复项` : ''}。`);
    } catch (reason) {
      toast.error(messageOf(reason));
    } finally {
      setScanBusy(false);
    }
  };

  return <>
    <Button variant="outline" size="sm" type="button" disabled={appBusy || scanBusy} onClick={() => void scanKeys()}>
      <RadarIcon data-icon="inline-start" />
      扫描 SSH 密钥
    </Button>
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) close(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><RadarIcon />扫描本地 SSH 密钥</DialogTitle>
          <DialogDescription>仅扫描当前用户 ~/.ssh 的顶层普通文件，不递归、不跟随软链接；扫描所得密钥内容不会进入此弹窗。仅私钥候选可以手动补充公钥，也可以留空后导入。</DialogDescription>
        </DialogHeader>

        {scanBusy && !preview ? <div className="grid min-h-40 place-items-center gap-2 text-muted-foreground"><Spinner /><span>正在扫描本地密钥…</span></div> : preview?.items.length ? <>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>发现 {preview.items.length} 个新密钥</span>
            {preview.skippedCount > 0 && <span>已跳过 {preview.skippedCount} 项</span>}
          </div>
          <div className="max-h-96 divide-y overflow-y-auto rounded-md border">
            {preview.items.map((item) => <div key={item.entryId}>
              <label className="flex cursor-pointer items-center gap-3 p-3">
                <input type="checkbox" checked={selected.has(item.entryId)} onChange={(event) => setSelected((current) => {
                  const next = new Set(current);
                  event.target.checked ? next.add(item.entryId) : next.delete(item.entryId);
                  return next;
                })} />
                <KeyRoundIcon className="size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{item.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{kindLabel(item.kind)}{item.algorithm ? ` · ${item.algorithm}` : ''}{item.fingerprint ? ` · ${item.fingerprint}` : ''}</span>
                </span>
              </label>
              {item.kind === 'privateKey' && selected.has(item.entryId) && <div className="grid gap-1.5 px-3 pb-3 pl-10">
                <label className="text-xs font-medium" htmlFor={`ssh-scan-public-key-${item.entryId}`}>公钥（可选）</label>
                <Textarea
                  id={`ssh-scan-public-key-${item.entryId}`}
                  aria-label={`为 ${item.name} 添加公钥（可选）`}
                  className="min-h-20 font-mono text-xs"
                  maxLength={1024 * 1024}
                  placeholder="粘贴对应的 OpenSSH 公钥；留空可稍后在编辑页添加"
                  value={publicKeys[item.entryId] ?? ''}
                  onChange={(event) => setPublicKeys((current) => ({ ...current, [item.entryId]: event.target.value }))}
                />
              </div>}
            </div>)}
          </div>
        </> : preview ? <div className="grid min-h-40 place-items-center gap-2 rounded-md border border-dashed p-6 text-center">
          <KeyRoundIcon className="size-8 text-muted-foreground" />
          <div><p className="font-medium">没有新的可导入密钥</p><p className="mt-1 text-xs text-muted-foreground">{preview.skippedCount > 0 ? `已跳过 ${preview.skippedCount} 个已导入、无效或不支持的文件。` : '未在 ~/.ssh 中发现受支持的密钥。'}</p></div>
        </div> : null}

        <DialogFooter>
          <Button variant="outline" type="button" disabled={scanBusy} onClick={close}>取消</Button>
          {preview && <Button variant="outline" type="button" disabled={scanBusy} onClick={() => void scanKeys()}><RadarIcon data-icon="inline-start" />重新扫描</Button>}
          <Button type="button" disabled={scanBusy || !preview || selected.size === 0} onClick={() => void importKeys()}>
            {scanBusy ? <Spinner data-icon="inline-start" /> : <KeyRoundIcon data-icon="inline-start" />}
            导入所选 {selected.size} 项
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

function kindLabel(kind: SshKeyScanPreview['items'][number]['kind']): string {
  return kind === 'keyPair' ? '公钥 + 私钥' : kind === 'privateKey' ? '私钥' : '公钥';
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : '扫描失败。';
}

function nullIfEmpty(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
