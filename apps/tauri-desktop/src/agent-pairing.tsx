import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { BotIcon, ShieldCheckIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { ErrorBanner } from './renderer/src/components/ErrorBanner';
import { Button } from './renderer/src/components/ui/button';
import { Spinner } from './renderer/src/components/ui/spinner';
import './renderer/src/styles/app.css';

interface PairingRequest {
  clientId: string;
  clientKey: string;
  connectedAt: number;
}

interface PairingStatus {
  request: PairingRequest | null;
}

function errorMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === 'string' && reason.length > 0) return reason;
  return '操作失败。';
}

export function AgentPairingWindow() {
  const [status, setStatus] = useState<PairingStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = async (): Promise<void> => {
    setStatus(await invoke<PairingStatus>('agent_pairing_status'));
  };

  useEffect(() => {
    void refresh().catch((reason) => setError(errorMessage(reason)));
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listen('agent-pairing-requested', () => {
      void refresh().catch((reason) => setError(errorMessage(reason)));
    }).then((next) => {
      if (disposed) next();
      else unlisten = next;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const resolve = async (approved: boolean): Promise<void> => {
    if (!status?.request || busy) return;
    setBusy(true);
    setError('');
    try {
      await invoke('agent_pairing_resolve', {
        clientId: status.request.clientId,
        approved,
      });
      await getCurrentWindow().close();
    } catch (reason) {
      setError(errorMessage(reason));
      setBusy(false);
      await refresh().catch(() => undefined);
    }
  };

  if (!status) {
    return <main className="grid min-h-svh place-items-center bg-background p-5"><Spinner /></main>;
  }

  if (!status.request) {
    return (
      <main className="flex min-h-svh flex-col bg-background text-foreground">
        <header className="grid gap-1 p-6">
          <h1 className="text-base leading-snug font-medium">配对请求已结束</h1>
          <p className="text-sm text-muted-foreground">没有等待处理的 Agent 客户端。</p>
        </header>
      </main>
    );
  }

  const clientName = status.request.clientKey;

  return (
    <main className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="grid gap-1 p-5 pb-3">
        <div className="mb-2 flex items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"><BotIcon /></div>
          <h1 className="text-base leading-snug font-medium">{clientName} 请求配对</h1>
        </div>
        <p className="text-sm text-muted-foreground">批准后将永久记住这个 integration key，直到你在安全中心撤销。</p>
      </header>
      <section className="grid flex-1 content-start gap-3 px-5 pb-4 text-xs text-muted-foreground">
        <ErrorBanner message={error} />
        <div className="rounded-md border p-3">
          <p className="font-medium text-foreground">MCP 集成 ID</p>
          <p className="break-all">{status.request.clientKey}</p>
        </div>
        <p className="flex items-center gap-2"><ShieldCheckIcon className="size-4 shrink-0" />批准不会向 Agent 返回密码、PIN 或其他 Vault 凭据。</p>
      </section>
      <footer className="flex justify-end gap-2 border-t bg-muted/50 p-3">
        <Button variant="outline" disabled={busy} onClick={() => void resolve(false)}>拒绝</Button>
        <Button disabled={busy} onClick={() => void resolve(true)}>{busy ? <Spinner data-icon="inline-start" /> : null}允许配对</Button>
      </footer>
    </main>
  );
}

export function bootstrapAgentPairing(container: HTMLElement): void {
  createRoot(container).render(<AgentPairingWindow />);
}
