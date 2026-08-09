import { useEffect, useMemo, useState } from 'react';
import { PlusIcon, SendIcon, SquareIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';

import type {
  ApiEnvironmentSummary, ApiRequestExecutionResult, ApiRequestInput, ApiRequestPreview,
} from '../../../shared/contracts';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';

type RequestPair = ApiRequestInput['query'][number];
type BodyType = ApiRequestInput['body']['type'];

const emptyDraft = (environmentId: string): ApiRequestInput => ({
  environmentId, method: 'GET', path: '/', query: [], headers: [], body: { type: 'none' },
});

const targetLabels = { public: '公共网络', private: '私有网络', loopback: '本机 loopback' } as const;

function PairEditor({
  title, pairs, onChange, disabled,
}: {
  title: string; pairs: RequestPair[]; onChange: (pairs: RequestPair[]) => void; disabled: boolean;
}) {
  const update = (index: number, pair: RequestPair): void => {
    const next = pairs.slice(); next[index] = pair; onChange(next);
  };
  return <FieldSet>
    <div className="flex items-center justify-between gap-3">
      <FieldLegend>{title}</FieldLegend>
      <Button type="button" size="sm" variant="outline" disabled={disabled || pairs.length >= 32} onClick={() => onChange([...pairs, { name: '', value: '' }])}>
        <PlusIcon data-icon="inline-start" />添加
      </Button>
    </div>
    {pairs.length === 0 && <FieldDescription>未添加{title}。</FieldDescription>}
    <FieldGroup>
      {pairs.map((pair, index) => <Field key={`${title}-${index}`} orientation="responsive">
        <Input aria-label={`${title} ${index + 1} 名称`} placeholder={title === 'Query' ? 'page' : 'x-request-id'} value={pair.name} disabled={disabled} onChange={(event) => update(index, { ...pair, name: event.target.value })} />
        <Input aria-label={`${title} ${index + 1} 值`} placeholder="值" value={pair.value} disabled={disabled} onChange={(event) => update(index, { ...pair, value: event.target.value })} />
        <Button type="button" size="icon-sm" variant="ghost" aria-label={`删除 ${title} ${index + 1}`} disabled={disabled} onClick={() => onChange(pairs.filter((_, current) => current !== index))}>
          <Trash2Icon />
        </Button>
      </Field>)}
    </FieldGroup>
  </FieldSet>;
}

export function ApiRequestWorkbench({
  environment, open, onOpenChange,
}: {
  environment: ApiEnvironmentSummary | null; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const [draft, setDraft] = useState<ApiRequestInput | null>(null);
  const [preview, setPreview] = useState<ApiRequestPreview | null>(null);
  const [result, setResult] = useState<ApiRequestExecutionResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && environment) {
      setDraft(emptyDraft(environment.id)); setPreview(null); setResult(null);
    }
  }, [environment?.id, open]);

  useEffect(() => window.vaultMesh.vault.onLocked(() => {
    if (preview) void window.vaultMesh.apiRequests.cancel(preview.executionRef);
    setDraft(null); setPreview(null); setResult(null); onOpenChange(false);
  }), [preview?.executionRef]);

  const requestBodyValue = draft?.body.type === 'json' || draft?.body.type === 'text' ? draft.body.value : '';
  const responseText = useMemo(() => {
    if (result?.state !== 'completed') return null;
    if (result.response.body.type === 'json') return JSON.stringify(result.response.body.value, null, 2);
    if (result.response.body.type === 'text') return result.response.body.value;
    return '';
  }, [result]);

  const replaceDraft = (next: ApiRequestInput): void => {
    if (preview) void window.vaultMesh.apiRequests.cancel(preview.executionRef);
    setPreview(null); setResult(null); setDraft(next);
  };
  const close = (): void => {
    if (preview) void window.vaultMesh.apiRequests.cancel(preview.executionRef);
    setDraft(null); setPreview(null); setResult(null); onOpenChange(false);
  };
  const prepare = (): void => {
    if (!draft) return;
    void (async () => {
      setBusy(true);
      try {
        const next = await window.vaultMesh.apiRequests.prepare({
          ...draft,
          path: draft.path.trim(),
          query: draft.query.map((pair) => ({ name: pair.name.trim(), value: pair.value })),
          headers: draft.headers.map((pair) => ({ name: pair.name.trim(), value: pair.value })),
        });
        setPreview(next); setResult(null);
      } catch (reason) {
        toast.error(reason instanceof Error ? reason.message : '无法准备 API 请求。');
      } finally { setBusy(false); }
    })();
  };
  const execute = (): void => {
    if (!preview) return;
    void (async () => {
      setBusy(true);
      try {
        setResult(await window.vaultMesh.apiRequests.execute(preview.executionRef));
        setPreview(null);
      } catch (reason) {
        toast.error(reason instanceof Error ? reason.message : 'API 请求执行失败。');
      } finally { setBusy(false); }
    })();
  };
  const cancel = (): void => {
    if (!preview) return;
    void window.vaultMesh.apiRequests.cancel(preview.executionRef).finally(() => {
      setPreview(null); setBusy(false);
    });
  };
  const setBodyType = (type: BodyType): void => {
    if (!draft) return;
    replaceDraft({
      ...draft,
      body: type === 'none' ? { type } : { type, value: type === 'json' ? '{\n  \n}' : '' },
    });
  };

  return <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
      <DialogHeader>
        <DialogTitle>{environment ? `${environment.name} · API Request` : 'API Request'}</DialogTitle>
        <DialogDescription>请求由 Rust 特权运行时从 live 环境注入认证；请求与响应不会保存到历史。</DialogDescription>
      </DialogHeader>
      {draft && <div className="flex flex-col gap-5">
        <Alert>
          <AlertTitle>受约束的 V1 工作台</AlertTitle>
          <AlertDescription>公共目标必须使用有效 HTTPS；私网、loopback、mutation 和明文 HTTP 会出现系统确认。Redirect、proxy、Cookie、压缩和自动重试已关闭。</AlertDescription>
        </Alert>
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <Field>
              <FieldLabel>Method</FieldLabel>
              <Select value={draft.method} disabled={busy} onValueChange={(method) => replaceDraft({ ...draft, method: method as ApiRequestInput['method'], body: ['GET', 'HEAD'].includes(method) ? { type: 'none' } : draft.body })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>{(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const).map((method) => <SelectItem key={method} value={method}>{method}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="api-request-path">相对路径</FieldLabel>
              <Input id="api-request-path" value={draft.path} disabled={busy} placeholder="/users/me" onChange={(event) => replaceDraft({ ...draft, path: event.target.value })} />
              <FieldDescription>相对于环境 base path；不允许完整 URL、query/fragment 或 dot segment。</FieldDescription>
            </Field>
          </div>
          <PairEditor title="Query" pairs={draft.query} disabled={busy} onChange={(query) => replaceDraft({ ...draft, query })} />
          <PairEditor title="普通 Headers" pairs={draft.headers} disabled={busy} onChange={(headers) => replaceDraft({ ...draft, headers })} />
          <Field>
            <FieldLabel>Request body</FieldLabel>
            <Select value={draft.body.type} disabled={busy || ['GET', 'HEAD'].includes(draft.method)} onValueChange={(value) => setBodyType(value as BodyType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup><SelectItem value="none">无</SelectItem><SelectItem value="json">JSON</SelectItem><SelectItem value="text">UTF-8 Text</SelectItem></SelectGroup></SelectContent>
            </Select>
            {draft.body.type !== 'none' && <Textarea aria-label="Request body 内容" rows={8} value={requestBodyValue} disabled={busy} onChange={(event) => replaceDraft({ ...draft, body: { type: draft.body.type as 'json' | 'text', value: event.target.value } })} />}
          </Field>
        </FieldGroup>

        {preview && <Card>
          <CardHeader><CardTitle>Canonical preview</CardTitle><CardDescription>Reference 60 秒内单次有效；执行前会重新验证 live 环境和凭据。</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex flex-wrap items-center gap-2"><Badge>{preview.method}</Badge><Badge variant="outline">{targetLabels[preview.targetClass]}</Badge><Badge variant="outline">{preview.authType}</Badge>{preview.requiresNativeConfirmation && <Badge variant="secondary">需要系统确认</Badge>}</div>
            <code className="break-all rounded-lg bg-muted p-3">{preview.origin}{preview.path}</code>
            <p className="text-muted-foreground">{preview.queryCount} Query · {preview.requestHeaderCount} 请求 Header · {preview.fixedHeaderCount} 环境 Header · {preview.bodyType} body</p>
          </CardContent>
        </Card>}

        {result && <Card>
          <CardHeader><CardTitle>Response</CardTitle><CardDescription>业务响应可能敏感，只保留在当前已解锁窗口内存。</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-3">
            {result.state === 'completed' ? <>
              <div className="flex flex-wrap items-center gap-2"><Badge>{result.response.status}</Badge><Badge variant="outline">{result.response.statusClass}</Badge></div>
              {result.response.headers.length > 0 && <div className="flex flex-col gap-1 text-xs text-muted-foreground">{result.response.headers.map((header) => <p key={`${header.name}:${header.value}`}><span className="font-medium text-foreground">{header.name}:</span> {header.value}</p>)}</div>}
              <Separator />
              {responseText === '' ? <p className="text-sm text-muted-foreground">响应正文为空。</p> : <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-xs">{responseText}</pre>}
            </> : <Alert variant={result.state === 'execution-unknown' ? 'destructive' : 'default'}>
              <AlertTitle>{result.state === 'execution-unknown' ? '执行结果未知' : result.state === 'cancelled' ? '请求已取消' : '请求失败'}</AlertTitle>
              <AlertDescription>{result.error.message}{result.error.executionUnknown ? ' 请先核对远端状态，不要直接重试。' : ''}</AlertDescription>
            </Alert>}
          </CardContent>
        </Card>}
      </div>}
      <DialogFooter>
        <Button variant="outline" onClick={close}>关闭</Button>
        {preview && <Button variant="outline" disabled={!busy} onClick={cancel}><SquareIcon data-icon="inline-start" />取消执行</Button>}
        {!preview ? <Button disabled={busy || !draft?.path.trim()} onClick={prepare}>生成安全预览</Button> : <Button disabled={busy} onClick={execute}><SendIcon data-icon="inline-start" />发送请求</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
