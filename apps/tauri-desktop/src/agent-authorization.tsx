import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ShieldAlertIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { ErrorBanner } from './renderer/src/components/ErrorBanner';
import { Alert, AlertDescription, AlertTitle } from './renderer/src/components/ui/alert';
import { Badge } from './renderer/src/components/ui/badge';
import { Button } from './renderer/src/components/ui/button';
import { Field, FieldGroup, FieldLabel } from './renderer/src/components/ui/field';
import { Progress } from './renderer/src/components/ui/progress';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from './renderer/src/components/ui/select';
import { Spinner } from './renderer/src/components/ui/spinner';
import type { AgentPermissionChoice, AgentPermissionRequest } from './shared/contracts';
import { AGENT_RISK_LABELS, formatAgentPermissionDisplay, formatAgentPermissionTarget, formatAgentToolType } from './shared/agent-permission-display';
import './renderer/src/styles/app.css';

const EXECUTION_AUTHORIZATION_MILLIS = 30_000;

type AuthorizationRequest = { kind: 'permission'; clientKey: string; expiresAt: number; permission: AgentPermissionRequest };

const RISK_VARIANTS = {
  R0: 'risk-r0',
  R1: 'risk-r1',
  R2: 'risk-r2',
  R3: 'risk-r3',
  R4: 'risk-r4',
} as const;

interface AuthorizationStatus {
  now: number;
  executionExpiresAt: number;
  request: AuthorizationRequest | null;
}

function errorMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === 'string' && reason.length > 0) return reason;
  return '操作失败。';
}

function scopeLabel(scope: AgentPermissionChoice['scope'], tool: string): string {
  const ssh = tool === 'vaultmesh_ssh_exec';
  if (scope === 'exact') {
    if (ssh) return '当前命令';
    if (tool.includes('upload') || tool.includes('download')) return '当前传输';
    if (tool.startsWith('vaultmesh_http_')) return '当前 HTTP 操作';
    if (tool.startsWith('vaultmesh_web_')) return '当前网站动作';
    return '当前动作';
  }
  if (scope === 'path') return '同方法路径规则';
  if (scope === 'safe') return '安全命令';
  if (ssh) return '所有结构化命令';
  if (tool.startsWith('vaultmesh_http_') || tool.startsWith('vaultmesh_web_')) return '此网站此能力';
  return '此账号此能力';
}

function durationLabel(duration: AgentPermissionChoice['duration']): string {
  if (duration === 'once') return '仅本次';
  if (duration === 'connection') return '本次 Agent 连接';
  return '始终';
}

export function AgentAuthorizationWindow() {
  const [request, setRequest] = useState<AuthorizationRequest | null>(null);
  const [deadline, setDeadline] = useState(0);
  const [remaining, setRemaining] = useState(EXECUTION_AUTHORIZATION_MILLIS);
  const [scope, setScope] = useState<AgentPermissionChoice['scope']>('exact');
  const [duration, setDuration] = useState<AgentPermissionChoice['duration']>('once');
  const [pathPattern, setPathPattern] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = async (): Promise<void> => {
    const status = await invoke<AuthorizationStatus>('agent_authorization_status');
    setRequest(status.request);
    if (status.request) {
      const nextDeadline = Date.now() + Math.max(0, status.executionExpiresAt - status.now);
      setDeadline(nextDeadline);
      setRemaining(Math.max(0, nextDeadline - Date.now()));
      setScope(status.request.permission.recommendedScope);
      setDuration(status.request.permission.recommendedDuration);
      setPathPattern(status.request.permission.availablePathPatterns?.[0] ?? '');
    }
  };

  useEffect(() => {
    void refresh().catch((reason) => setError(errorMessage(reason)));
    const unlisteners: Array<() => void> = [];
    let disposed = false;
    const register = (event: string, callback: () => void): void => {
      void listen(event, callback).then((unlisten) => {
        if (disposed) unlisten();
        else unlisteners.push(unlisten);
      }).catch((reason) => {
        if (!disposed) setError(errorMessage(reason));
      });
    };
    register('agent-authorization-requested', () => {
      setError('');
      void refresh().catch((reason) => setError(errorMessage(reason)));
    });
    register('agent-authorization-expired', () => {
      setDeadline(Date.now());
      setRemaining(0);
    });
    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if (!deadline) return;
    const timer = window.setInterval(() => {
      const next = Math.max(0, deadline - Date.now());
      setRemaining(next);
      if (next === 0) window.clearInterval(timer);
    }, 200);
    return () => window.clearInterval(timer);
  }, [deadline]);

  const seconds = Math.max(0, Math.ceil(remaining / 1_000));
  const expired = deadline > 0 && remaining === 0;
  const progress = Math.max(0, Math.min(100, remaining / EXECUTION_AUTHORIZATION_MILLIS * 100));
  const permission = request?.permission ?? null;
  const isSsh = permission?.tool === 'vaultmesh_ssh_exec';
  const availableScopes = useMemo<AgentPermissionChoice['scope'][]>(
    () => permission?.availableScopes ?? ['exact'],
    [permission],
  );
  const availableDurations = useMemo<AgentPermissionChoice['duration'][]>(() => {
    if (!permission) return ['once'];
    return Array.from(new Set([
      ...permission.availableAllowDurations,
      ...permission.availableDenyDurations,
    ]));
  }, [permission]);
  const allowAvailable = permission?.availableAllowDurations.includes(duration) ?? false;
  const denyAvailable = permission?.availableDenyDurations.includes(duration) ?? false;

  const finish = async (operation: () => Promise<unknown>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await operation();
      setRequest(null);
      setDeadline(0);
      setBusy(false);
      await getCurrentWindow().hide();
    } catch (reason) {
      setError(errorMessage(reason));
      setBusy(false);
      await refresh().catch(() => undefined);
    }
  };

  const resolvePermission = (effect: AgentPermissionChoice['effect']): void => {
    if (!permission) return;
    const choice: AgentPermissionChoice = {
      effect,
      scope,
      duration,
      ...(scope === 'path' ? { pathPattern } : {}),
    };
    void finish(() => invoke('agent_authorization_resolve_permission', {
      input: { permissionRef: permission.permissionRef, choice },
    }));
  };

  if (!request) {
    return <main className="grid min-h-svh place-items-center bg-background p-5"><Spinner /></main>;
  }

  const activePermission = request.permission;

  return (
    <main className="flex min-h-svh flex-col bg-background text-foreground">
      <Progress className="shrink-0 rounded-none" value={progress} aria-label="本次调用授权剩余时间" />
      <header className="grid gap-1 p-5 pb-3">
        <div className="mb-2 flex items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"><ShieldAlertIcon /></div>
          <h1 className="min-w-0 flex-1 text-base leading-snug font-medium">{request.clientKey} 请求动作授权</h1>
          <Badge className="shrink-0" variant={expired ? 'destructive' : 'secondary'}>{expired ? '本次调用授权失败' : `本次调用剩余 ${seconds} 秒`}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{formatAgentPermissionDisplay(activePermission)}</p>
      </header>
      <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-4">
        <ErrorBanner message={error} />
        <Alert>
          <ShieldAlertIcon />
          <AlertTitle><Badge variant={RISK_VARIANTS[activePermission.risk]}>{AGENT_RISK_LABELS[activePermission.risk]}</Badge></AlertTitle>
          <AlertDescription>{activePermission.freshConfirmationRequired ? '即使记住授权范围，每次具体执行仍需在本窗口重新确认。' : '授权范围和有效时长以你在下方的选择为准。'}</AlertDescription>
        </Alert>
        {expired ? (
          <Alert variant="destructive">
            <AlertTitle>当前授权仅能下次调用使用</AlertTitle>
            <AlertDescription>Agent 等待的 30 秒已经结束。下面的授权将作用于下一次调用；选择“仅本次”就是仅允许下一次执行一次。</AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <AlertTitle>请在 {seconds} 秒内授权本次调用</AlertTitle>
            <AlertDescription>超时后只能授权下一次调用。</AlertDescription>
          </Alert>
        )}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="min-w-0 rounded-md border p-3">
            <p className="font-medium">工具类型</p>
            <p className="text-muted-foreground">{formatAgentToolType(activePermission.tool)}</p>
          </div>
          <div className="min-w-0 rounded-md border p-3">
            <p className="font-medium">目标</p>
            <p className="break-all text-muted-foreground">{formatAgentPermissionTarget(activePermission)}</p>
            <p className="text-xs text-muted-foreground">环境：{activePermission.environment}</p>
          </div>
        </div>
        <div className="flex flex-col gap-1 text-sm">
          <p className="font-medium">{isSsh ? '执行的命令' : '执行的动作'}</p>
          {isSsh ? (
            <pre className="overflow-x-auto rounded-md border bg-muted p-3 font-mono text-sm"><code>{activePermission.actionDisplay}</code></pre>
          ) : (
            <p className="break-all text-muted-foreground">{activePermission.actionDisplay}</p>
          )}
        </div>
        <FieldGroup className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="agent-authorization-scope">授权范围</FieldLabel>
            <Select value={scope} onValueChange={(value) => setScope(value as AgentPermissionChoice['scope'])}>
              <SelectTrigger id="agent-authorization-scope" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                {availableScopes.map((value) => <SelectItem key={value} value={value}>{scopeLabel(value, activePermission.tool)}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="agent-authorization-duration">有效时长</FieldLabel>
            <Select value={duration} onValueChange={(value) => setDuration(value as AgentPermissionChoice['duration'])}>
              <SelectTrigger id="agent-authorization-duration" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                {availableDurations.map((value) => <SelectItem key={value} value={value}>{durationLabel(value)}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </Field>
        </FieldGroup>
        {scope === 'path' ? (
          <Field>
            <FieldLabel htmlFor="agent-authorization-path-pattern">允许的路径规则（请求方法保持不变）</FieldLabel>
            <Select value={pathPattern} onValueChange={setPathPattern}>
              <SelectTrigger id="agent-authorization-path-pattern" className="w-full font-mono"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                {(activePermission.availablePathPatterns ?? []).map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </Field>
        ) : null}
        {availableScopes.includes('safe') ? <p className="text-xs text-muted-foreground">安全命令只表示通过当前版本的低副作用结构化语法规则，不保证远端程序或输出绝对可信。</p> : null}
        {availableScopes.includes('path') ? <p className="text-xs text-muted-foreground"><code>*</code> 只匹配一段，<code>**</code> 只能位于末尾并匹配后续多段；规则不会扩大到其他请求方法或其他 Secret。</p> : null}
        {!allowAvailable && denyAvailable ? <p className="text-xs text-destructive">当前风险下，这个时长只能用于拒绝，不能用于允许。</p> : null}
      </section>
      <footer className="flex flex-wrap justify-end gap-2 border-t bg-muted/50 p-3">
        <Button variant="outline" disabled={busy || !denyAvailable} onClick={() => resolvePermission('deny')}>拒绝</Button>
        <Button variant={RISK_VARIANTS[activePermission.risk]} disabled={busy || !allowAvailable} onClick={() => resolvePermission('allow')}>{busy ? <Spinner data-icon="inline-start" /> : null}{expired && duration === 'once' ? '允许下一次' : '允许'}</Button>
      </footer>
    </main>
  );
}

export function bootstrapAgentAuthorization(container: HTMLElement): void {
  createRoot(container).render(<AgentAuthorizationWindow />);
}
