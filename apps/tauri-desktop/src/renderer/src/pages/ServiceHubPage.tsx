import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowRightIcon, BoxesIcon, ExternalLinkIcon, KeyRoundIcon, Link2Icon, MergeIcon, PencilIcon, PlusIcon, RotateCcwIcon, SearchIcon, SparklesIcon, SplitIcon, Trash2Icon, UnlinkIcon } from 'lucide-react';
import { toast } from 'sonner';

import type { ApiCredentialRef, ApiEnvironmentAuth, ApiEnvironmentDetail, ApiEnvironmentInput, ApiEnvironmentSummary, ApiEnvironmentTrashSummary, ApiFixedHeader, ServiceAggregationApplyResult, ServiceAggregationPlan, ServiceDetail, ServiceInput, ServiceItemKind, ServiceRelationship, ServiceSummary, ServiceTrashSummary } from '../../../shared/contracts';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useVaultStore, type PendingApiEnvironmentSetup } from '@/stores/vault-store';
import { ApiRequestWorkbench } from '@/components/ApiRequestWorkbench';

type ItemOption = { key: string; kind: ServiceItemKind; id: string; label: string };

const emptyDraft: ServiceInput = { name: '', description: null, tags: [], sites: [''] };
const EMPTY_SELECT_VALUE = '__vaultmesh_empty_select_value__';
const groupLabels: Record<ServiceItemKind, string> = { login: '登录账号', secret: 'API / 密钥', ssh: 'SSH', identity: '其他' };
const environmentLabels = { production: 'Production', staging: 'Staging', development: 'Development', local: 'Local', other: 'Other' } as const;

type ApiLoginOption = { id: string; label: string };
type ApiSecretOption = { id: string; label: string; kind: ApiCredentialRef['expectedSecretKind'] };

const loginRef = (id: string, field: 'login-username' | 'login-password'): ApiCredentialRef => ({ itemKind: 'login', itemId: id, field, expectedSecretKind: null });
const secretRef = (secret: ApiSecretOption): ApiCredentialRef => ({ itemKind: 'secret', itemId: secret.id, field: 'secret-value', expectedSecretKind: secret.kind });
const basicPasswordValue = (credential: ApiCredentialRef): string => `${credential.itemKind}:${credential.itemId}`;

function environmentKindFromNote(value: string | null): ApiEnvironmentInput['kind'] {
  const normalized = value?.trim().toLocaleLowerCase();
  if (normalized === 'prod' || normalized === 'production') return 'production';
  if (normalized === 'stage' || normalized === 'staging') return 'staging';
  if (normalized === 'dev' || normalized === 'development') return 'development';
  if (normalized === 'local') return 'local';
  return normalized ? 'other' : 'production';
}

function serviceSiteFromWebsite(value: string | null): string {
  if (!value) return '';
  try { return new URL(value).origin; } catch { return ''; }
}

function ApiEnvironmentPanel({
  service, logins, secrets, setupCredential, setupRequest, onSetupComplete,
}: {
  service: ServiceDetail;
  logins: ApiLoginOption[];
  secrets: ApiSecretOption[];
  setupCredential: PendingApiEnvironmentSetup | null;
  setupRequest: number;
  onSetupComplete(): void;
}) {
  const [environments, setEnvironments] = useState<ApiEnvironmentSummary[]>([]);
  const [trash, setTrash] = useState<ApiEnvironmentTrashSummary[]>([]);
  const [editing, setEditing] = useState<ApiEnvironmentDetail | null>(null);
  const [draft, setDraft] = useState<ApiEnvironmentInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [requestEnvironment, setRequestEnvironment] = useState<ApiEnvironmentSummary | null>(null);
  const [setupDraft, setSetupDraft] = useState(false);

  const load = async (): Promise<void> => {
    const [next, nextTrash] = await Promise.all([
      window.vaultMesh.apiEnvironments.list(service.id),
      window.vaultMesh.apiEnvironments.trash(service.id),
    ]);
    setEnvironments(next); setTrash(nextTrash);
  };
  useEffect(() => {
    setDraft(null); setEditing(null); setRequestEnvironment(null); setSetupDraft(false);
    void load().catch(() => toast.error('无法加载 API 环境。'));
  }, [service.id]);
  useEffect(() => window.vaultMesh.vault.onLocked(() => {
    setDraft(null); setEditing(null); setRequestEnvironment(null); setEnvironments([]); setTrash([]);
  }), []);

  const run = async (operation: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try { await operation(); } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'API 环境操作失败。'); }
    finally { setBusy(false); }
  };
  const defaultAuth = (): ApiEnvironmentAuth => ({ type: 'none' });
  const openCreate = (credential?: PendingApiEnvironmentSetup): void => {
    const selectedSecret = credential ? secrets.find((secret) => secret.id === credential.credentialId) : undefined;
    const kind = environmentKindFromNote(credential?.environment ?? null);
    let auth = defaultAuth();
    if (selectedSecret?.kind === 'access-token') auth = { type: 'bearer', credential: secretRef(selectedSecret) };
    if (selectedSecret?.kind === 'api-key') auth = { type: 'api-key', location: 'header', name: 'X-API-Key', credential: secretRef(selectedSecret) };
    setEditing(null);
    setSetupDraft(Boolean(selectedSecret));
    setDraft({
      serviceId: service.id,
      name: credential?.environment?.trim() || environmentLabels[kind],
      kind,
      origin: 'https://',
      basePath: null,
      openapiUrl: null,
      auth,
      fixedHeaders: [],
    });
  };
  useEffect(() => {
    if (setupRequest > 0 && setupCredential) openCreate(setupCredential);
  }, [setupRequest]);
  const openEdit = (id: string): void => { void run(async () => {
    const detail = await window.vaultMesh.apiEnvironments.detail(id); setEditing(detail);
    setSetupDraft(false);
    setDraft({ serviceId: detail.serviceId, name: detail.name, kind: detail.kind, origin: detail.origin, basePath: detail.basePath, openapiUrl: detail.openapiUrl, auth: detail.auth, fixedHeaders: detail.fixedHeaders });
  }); };
  const persist = (input: ApiEnvironmentInput & { id?: string }): void => { void run(async () => {
    const completesSetup = !input.id && setupDraft;
    if (input.id) await window.vaultMesh.apiEnvironments.update({ ...input, id: input.id });
    else await window.vaultMesh.apiEnvironments.add(input);
    setDraft(null); setEditing(null); setSetupDraft(false); await load();
    if (completesSetup) onSetupComplete();
    toast.success('API 环境已保存。');
  }); };
  const save = (): void => {
    if (!draft) return;
    const input = { ...draft, name: draft.name.trim(), origin: draft.origin.trim(), basePath: draft.basePath?.trim() || null, openapiUrl: draft.openapiUrl?.trim() || null, id: editing?.id };
    persist(input);
  };
  const authType = draft?.auth.type ?? 'none';
  const setAuthType = (type: ApiEnvironmentAuth['type']): void => {
    if (!draft) return;
    let auth: ApiEnvironmentAuth = { type: 'none' };
    if (type === 'bearer' && secrets.find((secret) => secret.kind === 'access-token')) auth = { type, credential: secretRef(secrets.find((secret) => secret.kind === 'access-token')!) };
    if (type === 'api-key' && secrets.find((secret) => secret.kind === 'api-key')) auth = { type, location: 'header', name: 'X-API-Key', credential: secretRef(secrets.find((secret) => secret.kind === 'api-key')!) };
    if (type === 'basic' && logins[0]) auth = { type, username: loginRef(logins[0].id, 'login-username'), password: loginRef(logins[0].id, 'login-password') };
    setDraft({ ...draft, auth });
  };
  const updateHeader = (index: number, header: ApiFixedHeader): void => {
    if (!draft) return; const fixedHeaders = draft.fixedHeaders.slice(); fixedHeaders[index] = header; setDraft({ ...draft, fixedHeaders });
  };

  return <Card>
    <CardHeader><CardTitle>API 环境</CardTitle><CardDescription>Target、认证和固定 Header 只由 VaultMesh 注入；Agent 可发现 live opaque 环境引用，执行时仍需独立授权。</CardDescription><CardAction><Button size="sm" variant="outline" onClick={() => openCreate()}><PlusIcon />新建环境</Button></CardAction></CardHeader>
    <CardContent className="space-y-3">
      {environments.length === 0 && <p className="text-sm text-muted-foreground">尚未配置 API 环境。</p>}
      {environments.map((environment) => <div key={environment.id} className="flex flex-wrap items-center gap-3 rounded-xl border p-3">
        <button type="button" className="min-w-40 flex-1 text-left" onClick={() => openEdit(environment.id)}><span className="font-medium">{environment.name}</span><span className="ml-2 text-xs text-muted-foreground">{environmentLabels[environment.kind]} · {environment.authKind} · {environment.fixedHeaderCount} Headers</span><span className="block text-xs text-muted-foreground">revision {environment.revision}</span></button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => setRequestEnvironment(environment)}>发送请求</Button>
        <Button variant="ghost" size="icon-sm" aria-label={`编辑 ${environment.name}`} onClick={() => openEdit(environment.id)}><PencilIcon /></Button>
        <Button variant="ghost" size="icon-sm" aria-label={`删除 ${environment.name}`} onClick={() => void run(async () => { await window.vaultMesh.apiEnvironments.delete(environment.id); await load(); })}><Trash2Icon /></Button>
      </div>)}
      {trash.length > 0 && <div className="border-t pt-3"><p className="mb-2 text-xs font-semibold text-muted-foreground">已删除环境</p>{trash.map((entry) => <div key={entry.trashId} className="flex items-center justify-between"><span className="text-sm">{entry.name}</span><div><Button size="sm" variant="ghost" onClick={() => void run(async () => { await window.vaultMesh.apiEnvironments.restoreTrash(entry.trashId); await load(); })}>恢复</Button><Button size="sm" variant="ghost" onClick={() => void run(async () => { await window.vaultMesh.apiEnvironments.purgeTrash(entry.trashId); await load(); })}>永久删除</Button></div></div>)}</div>}
    </CardContent>

    <Dialog open={draft !== null} onOpenChange={(open) => { if (!open) { setDraft(null); setEditing(null); setSetupDraft(false); } }}><DialogContent className="max-h-[85vh] overflow-x-hidden overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{editing ? '编辑 API 环境' : '新建 API 环境'}</DialogTitle><DialogDescription>凭据选择器只保存受保护引用，不读取或复制凭据值。</DialogDescription></DialogHeader>{draft && <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2"><Input aria-label="环境名称" placeholder="Production" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /><Select value={draft.kind} onValueChange={(value) => setDraft({ ...draft, kind: value as ApiEnvironmentInput['kind'] })}><SelectTrigger className="h-9 w-full" aria-label="环境分类"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{Object.entries(environmentLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectGroup></SelectContent></Select></div>
      <Input aria-label="API origin" placeholder="https://api.example.com" value={draft.origin} onChange={(event) => setDraft({ ...draft, origin: event.target.value })} />
      <div className="grid gap-3 sm:grid-cols-2"><Input aria-label="Base path" placeholder="/v1（可选）" value={draft.basePath ?? ''} onChange={(event) => setDraft({ ...draft, basePath: event.target.value || null })} /><Input aria-label="OpenAPI URL" placeholder="https://example.com/openapi.json（可选，Agent 可见）" value={draft.openapiUrl ?? ''} onChange={(event) => setDraft({ ...draft, openapiUrl: event.target.value || null })} /></div>
      <div className="grid gap-2"><label className="text-sm font-medium" htmlFor="api-auth-type">认证类型</label><Select value={authType} onValueChange={(value) => setAuthType(value as ApiEnvironmentAuth['type'])}><SelectTrigger id="api-auth-type" className="h-9 w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="none">None</SelectItem><SelectItem value="bearer" disabled={!secrets.some((secret) => secret.kind === 'access-token')}>Bearer</SelectItem><SelectItem value="basic" disabled={logins.length === 0}>Basic</SelectItem><SelectItem value="api-key" disabled={!secrets.some((secret) => secret.kind === 'api-key')}>API Key</SelectItem></SelectGroup></SelectContent></Select></div>
      {draft.auth.type === 'bearer' && <Select value={draft.auth.credential.itemId} onValueChange={(value) => { const secret = secrets.find((item) => item.id === value); if (secret) setDraft({ ...draft, auth: { type: 'bearer', credential: secretRef(secret) } }); }}><SelectTrigger className="h-9 w-full" aria-label="Bearer 凭据"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{secrets.filter((secret) => secret.kind === 'access-token').map((secret) => <SelectItem key={secret.id} value={secret.id}>{secret.label}</SelectItem>)}</SelectGroup></SelectContent></Select>}
      {draft.auth.type === 'basic' && <div className="grid gap-3 sm:grid-cols-2"><Select value={draft.auth.username.itemId} onValueChange={(value) => { if (draft.auth.type === 'basic') setDraft({ ...draft, auth: { ...draft.auth, username: loginRef(value, 'login-username') } }); }}><SelectTrigger className="h-9 w-full" aria-label="Basic 用户名凭据"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{logins.map((login) => <SelectItem key={login.id} value={login.id}>{login.label} · username</SelectItem>)}</SelectGroup></SelectContent></Select><Select value={basicPasswordValue(draft.auth.password)} onValueChange={(value) => { if (draft.auth.type !== 'basic') return; const [kind, id] = value.split(':', 2); const secret = kind === 'secret' ? secrets.find((item) => item.id === id) : undefined; const password = kind === 'login' ? loginRef(id, 'login-password') : secret ? secretRef(secret) : draft.auth.password; setDraft({ ...draft, auth: { ...draft.auth, password } }); }}><SelectTrigger className="h-9 w-full" aria-label="Basic 密码凭据"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{logins.map((login) => <SelectItem key={`login:${login.id}`} value={`login:${login.id}`}>{login.label} · password</SelectItem>)}{secrets.map((secret) => <SelectItem key={`secret:${secret.id}`} value={`secret:${secret.id}`}>{secret.label} · protected value</SelectItem>)}</SelectGroup></SelectContent></Select></div>}
      {draft.auth.type === 'api-key' && <div className="grid gap-3 sm:grid-cols-3"><Select value={draft.auth.credential.itemId} onValueChange={(value) => { const secret = secrets.find((item) => item.id === value); if (secret && draft.auth.type === 'api-key') setDraft({ ...draft, auth: { ...draft.auth, credential: secretRef(secret) } }); }}><SelectTrigger className="h-9 w-full" aria-label="API Key 凭据"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{secrets.filter((secret) => secret.kind === 'api-key').map((secret) => <SelectItem key={secret.id} value={secret.id}>{secret.label}</SelectItem>)}</SelectGroup></SelectContent></Select><Select value={draft.auth.location} onValueChange={(value) => { if (draft.auth.type === 'api-key') setDraft({ ...draft, auth: { ...draft.auth, location: value as 'header' | 'query' } }); }}><SelectTrigger className="h-9 w-full" aria-label="API Key 注入位置"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="header">Header</SelectItem><SelectItem value="query">Query</SelectItem></SelectGroup></SelectContent></Select><Input aria-label="API Key 参数名" value={draft.auth.name} onChange={(event) => { if (draft.auth.type === 'api-key') setDraft({ ...draft, auth: { ...draft.auth, name: event.target.value } }); }} /></div>}
      <div className="space-y-2"><div className="flex items-center justify-between"><p className="text-sm font-medium">固定 Headers</p><Button size="sm" variant="outline" disabled={draft.fixedHeaders.length >= 32} onClick={() => setDraft({ ...draft, fixedHeaders: [...draft.fixedHeaders, { name: '', source: { type: 'literal', value: '' } }] })}><PlusIcon />添加</Button></div>{draft.fixedHeaders.map((header, index) => <div key={index} className="grid gap-2 sm:grid-cols-[1fr_9rem_1.5fr_auto]"><Input aria-label={`Header ${index + 1} 名称`} placeholder="X-API-Version" value={header.name} onChange={(event) => updateHeader(index, { ...header, name: event.target.value })} /><Select value={header.source.type} onValueChange={(type) => { const secret = secrets[0]; updateHeader(index, { name: header.name, source: type === 'protected' && secret ? { type: 'protected', credential: secretRef(secret) } : { type: 'literal', value: '' } }); }}><SelectTrigger className="h-9 w-full" aria-label={`Header ${index + 1} 来源`}><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="literal">普通值</SelectItem><SelectItem value="protected" disabled={secrets.length === 0}>受保护引用</SelectItem></SelectGroup></SelectContent></Select>{header.source.type === 'literal' ? <Input aria-label={`Header ${index + 1} 值`} value={header.source.value} onChange={(event) => updateHeader(index, { name: header.name, source: { type: 'literal', value: event.target.value } })} /> : <Select value={header.source.credential.itemId} onValueChange={(value) => { const secret = secrets.find((item) => item.id === value); if (secret) updateHeader(index, { name: header.name, source: { type: 'protected', credential: secretRef(secret) } }); }}><SelectTrigger className="h-9 w-full" aria-label={`Header ${index + 1} 凭据`}><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{secrets.map((secret) => <SelectItem key={secret.id} value={secret.id}>{secret.label}</SelectItem>)}</SelectGroup></SelectContent></Select>}<Button size="icon-sm" variant="ghost" aria-label={`删除 Header ${index + 1}`} onClick={() => setDraft({ ...draft, fixedHeaders: draft.fixedHeaders.filter((_, current) => current !== index) })}><Trash2Icon /></Button></div>)}</div>
    </div>}<DialogFooter><Button variant="outline" onClick={() => { setDraft(null); setEditing(null); setSetupDraft(false); }}>取消</Button><Button disabled={busy || !draft?.name.trim() || !draft.origin.trim()} onClick={save}>保存环境</Button></DialogFooter></DialogContent></Dialog>

    <ApiRequestWorkbench environment={requestEnvironment} open={requestEnvironment !== null} onOpenChange={(open) => { if (!open) setRequestEnvironment(null); }} />
  </Card>;
}

function relationshipKey(relationship: ServiceRelationship): string {
  return `${relationship.itemKind}:${relationship.itemId}`;
}

export function ServiceHubPage() {
  const items = useVaultStore((state) => state.items);
  const secrets = useVaultStore((state) => state.secrets);
  const sshCredentials = useVaultStore((state) => state.sshCredentials);
  const identities = useVaultStore((state) => state.identities);
  const pendingApiEnvironmentSetup = useVaultStore((state) => state.pendingApiEnvironmentSetup);
  const clearApiEnvironmentSetup = useVaultStore((state) => state.clearApiEnvironmentSetup);
  const navigate = useNavigate();
  const [services, setServices] = useState<ServiceSummary[]>([]);
  const [trash, setTrash] = useState<ServiceTrashSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ServiceDetail | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ServiceInput>(emptyDraft);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [linkKey, setLinkKey] = useState('');
  const [moveTargets, setMoveTargets] = useState<Record<string, string>>({});
  const [mergeTarget, setMergeTarget] = useState('');
  const [splitRelationship, setSplitRelationship] = useState<ServiceRelationship | null>(null);
  const [plan, setPlan] = useState<ServiceAggregationPlan | null>(null);
  const [lastBatch, setLastBatch] = useState<ServiceAggregationApplyResult | null>(null);
  const [automaticLinking, setAutomaticLinking] = useState(true);
  const [environmentSetupRequest, setEnvironmentSetupRequest] = useState(0);
  const [creatingServiceForApiSetup, setCreatingServiceForApiSetup] = useState(false);
  const resolvedPendingCredentialRef = useRef<string | null>(null);

  const itemOptions = useMemo<ItemOption[]>(() => [
    ...items.map((item) => ({ key: `login:${item.id}`, kind: 'login' as const, id: item.id, label: item.title })),
    ...secrets.filter((item) => !item.isPasskey).map((item) => ({ key: `secret:${item.id}`, kind: 'secret' as const, id: item.id, label: item.title })),
    ...sshCredentials.map((item) => ({ key: `ssh:${item.id}`, kind: 'ssh' as const, id: item.id, label: item.title })),
    ...identities.map((item) => ({ key: `identity:${item.id}`, kind: 'identity' as const, id: item.id, label: item.title })),
  ], [identities, items, secrets, sshCredentials]);
  const optionByKey = useMemo(() => new Map(itemOptions.map((option) => [option.key, option])), [itemOptions]);
  const apiLoginOptions = useMemo(() => items.map((item) => ({ id: item.id, label: item.title })), [items]);
  const apiSecretOptions = useMemo(() => secrets.filter((item) => !item.isPasskey).map((item) => ({ id: item.id, label: item.title, kind: item.kind })), [secrets]);
  const filteredServices = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return term ? services.filter((service) => [service.name, service.description, ...service.tags].some((value) => value?.toLocaleLowerCase().includes(term))) : services;
  }, [query, services]);

  const resolvePendingServiceId = async (): Promise<string | null> => {
    if (!pendingApiEnvironmentSetup?.website) return null;
    const target = { itemKind: 'secret' as const, itemId: pendingApiEnvironmentSetup.credentialId };
    const aggregation = await window.vaultMesh.services.previewAggregation();
    const plannedMatches = aggregation.clusters.filter((cluster) =>
      cluster.existingServiceId && cluster.relationships.some((relationship) =>
        relationship.itemKind === target.itemKind && relationship.itemId === target.itemId));
    if (plannedMatches.length === 1) return plannedMatches[0]!.existingServiceId;
    if (plannedMatches.length > 1) return null;

    let hostname: string;
    try { hostname = new URL(pendingApiEnvironmentSetup.website).hostname.toLocaleLowerCase().replace(/\.$/, '').replace(/^www\./, ''); } catch { return null; }
    const candidates = await window.vaultMesh.services.list(hostname);
    if (candidates.length > 50) return null;
    const details = await Promise.all(candidates.map((candidate) => window.vaultMesh.services.detail(candidate.id)));
    const linkedMatches = details.filter((candidate) => candidate.relationships.some((relationship) =>
      relationship.itemKind === target.itemKind && relationship.itemId === target.itemId));
    return linkedMatches.length === 1 ? linkedMatches[0]!.id : null;
  };

  const load = async (preferredId?: string | null): Promise<void> => {
    const [nextServices, nextTrash, enabled] = await Promise.all([
      window.vaultMesh.services.list(), window.vaultMesh.services.trash(), window.vaultMesh.services.automaticLinkingEnabled(),
    ]);
    setServices(nextServices); setTrash(nextTrash); setAutomaticLinking(enabled);
    const pendingCredentialId = pendingApiEnvironmentSetup?.credentialId ?? null;
    const shouldResolvePending = preferredId === undefined && pendingCredentialId !== null
      && resolvedPendingCredentialRef.current !== pendingCredentialId;
    if (shouldResolvePending) resolvedPendingCredentialRef.current = pendingCredentialId;
    const pendingServiceId = shouldResolvePending ? await resolvePendingServiceId() : null;
    const nextId = preferredId ?? pendingServiceId ?? selectedId ?? nextServices[0]?.id ?? null;
    if (nextId && nextServices.some((service) => service.id === nextId)) {
      setSelectedId(nextId); setDetail(await window.vaultMesh.services.detail(nextId));
      if (pendingServiceId === nextId) setEnvironmentSetupRequest((current) => current + 1);
    } else { setSelectedId(null); setDetail(null); }
  };

  useEffect(() => { void load().catch(() => toast.error('无法加载网站/服务。')); }, []);
  useEffect(() => {
    setEnvironmentSetupRequest(0);
    setCreatingServiceForApiSetup(false);
    if (!pendingApiEnvironmentSetup) resolvedPendingCredentialRef.current = null;
  }, [pendingApiEnvironmentSetup?.credentialId]);

  const run = async (operation: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try { await operation(); } catch (reason) { toast.error(reason instanceof Error ? reason.message : '操作失败。'); }
    finally { setBusy(false); }
  };

  const selectService = (id: string): void => {
    setSelectedId(id); setMergeTarget('');
    void run(async () => { setDetail(await window.vaultMesh.services.detail(id)); });
  };

  const openCreate = (forApiSetup = false): void => {
    setEditingId(null);
    setCreatingServiceForApiSetup(forApiSetup);
    setDraft(forApiSetup && pendingApiEnvironmentSetup ? {
      name: pendingApiEnvironmentSetup.provider?.trim() || pendingApiEnvironmentSetup.title,
      description: null,
      tags: [],
      sites: [serviceSiteFromWebsite(pendingApiEnvironmentSetup.website)],
    } : emptyDraft);
    setEditorOpen(true);
  };
  const openEdit = (): void => {
    if (!detail) return;
    setEditingId(detail.id); setDraft({ name: detail.name, description: detail.description, tags: detail.tags, sites: detail.sites }); setEditorOpen(true);
  };
  const openSplit = (relationship: ServiceRelationship): void => {
    const option = optionByKey.get(relationshipKey(relationship));
    setSplitRelationship(relationship); setEditingId(null);
    setDraft({ name: option?.label ?? '拆分的网站/服务', description: null, tags: [], sites: detail?.sites.slice(0, 1) ?? [''] });
    setEditorOpen(true);
  };

  const save = (): void => { void run(async () => {
    const normalized: ServiceInput = {
      name: draft.name.trim(), description: draft.description?.trim() || null,
      tags: draft.tags.map((tag) => tag.trim()).filter(Boolean), sites: draft.sites.map((site) => site.trim()).filter(Boolean),
    };
    let id = editingId;
    const continueApiSetup = creatingServiceForApiSetup && !editingId && !splitRelationship;
    if (splitRelationship && detail) {
      const created = await window.vaultMesh.services.split(detail.id, normalized, [splitRelationship]); id = created.id;
    } else if (editingId) await window.vaultMesh.services.update({ id: editingId, ...normalized });
    else id = (await window.vaultMesh.services.add(normalized)).id;
    setEditorOpen(false); setSplitRelationship(null); setCreatingServiceForApiSetup(false); await load(id);
    if (continueApiSetup) setEnvironmentSetupRequest((current) => current + 1);
    toast.success(editingId ? '网站/服务已更新。' : '网站/服务已创建。');
  }); };

  const addLink = (): void => { const option = optionByKey.get(linkKey); if (!option || !detail) return; void run(async () => {
    await window.vaultMesh.services.link(detail.id, { itemKind: option.kind, itemId: option.id, source: 'manual' });
    setLinkKey(''); await load(detail.id); toast.success('关联已添加。');
  }); };

  const unlink = (relationship: ServiceRelationship): void => { if (!detail) return; void run(async () => {
    await window.vaultMesh.services.unlink(detail.id, relationship); await load(detail.id); toast.success('关联已移除，原项目保持不变。');
  }); };

  const move = (relationship: ServiceRelationship): void => { if (!detail) return; const targetId = moveTargets[relationshipKey(relationship)]; if (!targetId) return; void run(async () => {
    await window.vaultMesh.services.move(detail.id, targetId, relationship); await load(detail.id); toast.success('项目已移动到其他网站/服务。');
  }); };

  const goToItem = (relationship: ServiceRelationship): void => {
    if (relationship.itemKind === 'login') void navigate({ to: '/vault/items/$itemId', params: { itemId: relationship.itemId } });
    else if (relationship.itemKind === 'secret') void navigate({ to: '/vault/secrets/$secretId', params: { secretId: relationship.itemId } });
    else if (relationship.itemKind === 'ssh') void navigate({ to: '/vault/ssh/$sshId', params: { sshId: relationship.itemId } });
    else void navigate({ to: '/vault/identities/$identityId', params: { identityId: relationship.itemId } });
  };

  const preview = (): void => { void run(async () => { setPlan(await window.vaultMesh.services.previewAggregation()); }); };
  const applyPlan = (): void => { if (!plan) return; void run(async () => {
    const result = await window.vaultMesh.services.applyAggregation(plan.planId); setLastBatch(result); setPlan(null); await load();
    toast.success(`已创建 ${result.createdServiceCount} 个网站/服务并关联 ${result.linkedItemCount} 个项目。`);
  }); };
  const ignoreCluster = (cluster: ServiceAggregationPlan['clusters'][number]): void => { void run(async () => {
    for (const relationship of cluster.relationships) {
      await window.vaultMesh.services.ignoreSuggestion({ serviceKey: cluster.serviceKey, itemKind: relationship.itemKind, itemId: relationship.itemId });
    }
    setPlan(await window.vaultMesh.services.previewAggregation());
    toast.success('已忽略该建议；后续扫描不会再次自动应用。');
  }); };
  const rollback = (): void => { if (!lastBatch) return; void run(async () => {
    await window.vaultMesh.services.rollbackAggregation(lastBatch.batchId); setLastBatch(null); await load(); toast.success('已撤销最近一次自动整理。');
  }); };

  const grouped = detail ? (Object.keys(groupLabels) as ServiceItemKind[]).map((kind) => ({ kind, relationships: detail.relationships.filter((relationship) => relationship.itemKind === kind) })).filter((group) => group.relationships.length > 0) : [];

  return (
    <section className="mx-auto grid min-h-0 w-full max-w-6xl flex-1 grid-rows-[minmax(12rem,0.8fr)_minmax(0,1.2fr)] gap-6 overflow-hidden px-5 py-8 lg:grid-cols-[20rem_minmax(0,1fr)] lg:grid-rows-1">
      <ScrollArea className="min-h-0">
      <aside className="flex flex-col gap-4 pr-3">
        <div className="flex items-center gap-2"><div className="relative flex-1"><SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="搜索网站或服务" className="pl-9" placeholder="搜索网站、服务或标签" value={query} onChange={(event) => setQuery(event.target.value)} /></div><Button size="icon" type="button" aria-label="新建网站或服务" onClick={() => openCreate()}><PlusIcon /></Button></div>
        <div className="flex items-center justify-between rounded-xl border bg-card p-3"><div><p className="text-sm font-medium">持续自动关联</p><p className="text-xs text-muted-foreground">仅使用唯一精确主机</p></div><Switch checked={automaticLinking} disabled={busy} aria-label="持续自动关联" onCheckedChange={(enabled) => void run(async () => { setAutomaticLinking(await window.vaultMesh.services.updateAutomaticLinking(enabled)); })} /></div>
        <div className="flex flex-col gap-2" aria-label="网站和服务列表">
          {filteredServices.map((service) => <button key={service.id} type="button" onClick={() => selectService(service.id)} className={`w-full rounded-xl border p-3 text-left transition-colors ${selectedId === service.id ? 'border-primary bg-primary/5' : 'bg-card hover:bg-muted/60'}`}><span className="block truncate font-medium">{service.name}</span><span className="mt-1 block text-xs text-muted-foreground">{service.siteCount} 个站点 · {service.counts.login + service.counts.secret + service.counts.ssh + service.counts.identity} 个项目</span></button>)}
          {filteredServices.length === 0 && <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">还没有网站/服务。</p>}
        </div>
        {trash.length > 0 && <Card size="sm"><CardHeader><CardTitle>已删除</CardTitle><CardDescription>恢复不会改变原项目。</CardDescription></CardHeader><CardContent className="space-y-2">{trash.map((entry) => <div key={entry.trashId} className="flex items-center justify-between gap-2"><span className="truncate text-sm">{entry.name}</span><div className="flex"><Button variant="ghost" size="icon-sm" aria-label={`恢复 ${entry.name}`} onClick={() => void run(async () => { const restored = await window.vaultMesh.services.restoreTrash(entry.trashId); await load(restored.id); })}><RotateCcwIcon /></Button><Button variant="ghost" size="icon-sm" aria-label={`永久删除 ${entry.name}`} onClick={() => void run(async () => { await window.vaultMesh.services.purgeTrash(entry.trashId); await load(); })}><Trash2Icon /></Button></div></div>)}</CardContent></Card>}
      </aside>
      </ScrollArea>

      <ScrollArea className="min-h-0">
      <div className="flex min-w-0 flex-col gap-5 pr-3">
        {pendingApiEnvironmentSetup && <Card className="border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><KeyRoundIcon className="text-primary" />继续配置 API 环境</CardTitle>
            <CardDescription>“{pendingApiEnvironmentSetup.title}”已安全保存。请选择当前网站/服务，或新建一个网站/服务，再补充 API target 和认证方式。网站地址不会自动成为 API origin。</CardDescription>
            <CardAction className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={clearApiEnvironmentSetup}>稍后配置</Button>
              <Button variant="outline" size="sm" onClick={() => openCreate(true)}><PlusIcon data-icon="inline-start" />新建网站/服务</Button>
              <Button size="sm" disabled={!detail} onClick={() => setEnvironmentSetupRequest((current) => current + 1)}>在当前服务配置</Button>
            </CardAction>
          </CardHeader>
        </Card>}
        <Card className="border-primary/20 bg-gradient-to-br from-primary/8 via-card to-card">
          <CardHeader><CardTitle className="flex items-center gap-2"><SparklesIcon className="text-primary" />自动整理现有项目</CardTitle><CardDescription>只扫描本地安全 metadata。冲突、共享托管域、IP 与 localhost 不会自动归组。</CardDescription><CardAction className="flex gap-2">{lastBatch && <Button variant="outline" size="sm" disabled={busy} onClick={rollback}><RotateCcwIcon />撤销上次整理</Button>}<Button size="sm" disabled={busy} onClick={preview}><SparklesIcon />预览整理</Button></CardAction></CardHeader>
        </Card>

        {!detail ? <Empty className="min-h-96 rounded-2xl border"><EmptyHeader><EmptyMedia variant="icon"><BoxesIcon /></EmptyMedia><EmptyTitle>按网站或服务查看保险库</EmptyTitle><EmptyDescription>创建一个网站/服务，或先预览自动整理。原登录、密钥和 SSH 项目不会被改写。</EmptyDescription></EmptyHeader><EmptyContent><Button onClick={() => openCreate()}><PlusIcon />新建网站/服务</Button></EmptyContent></Empty> : <>
          <Card><CardHeader><CardTitle className="text-xl">{detail.name}</CardTitle><CardDescription>{detail.description ?? '组织关联项目的本地导航层。'}</CardDescription><CardAction className="flex gap-1"><Button variant="ghost" size="icon-sm" aria-label="编辑网站或服务" onClick={openEdit}><PencilIcon /></Button><Button variant="ghost" size="icon-sm" aria-label="删除网站或服务" onClick={() => setDeleteId(detail.id)}><Trash2Icon /></Button></CardAction></CardHeader><CardContent className="space-y-4"><div className="flex flex-wrap gap-2">{detail.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}{detail.sites.map((site) => <Button key={site} variant="outline" size="sm" onClick={() => void run(async () => { await window.vaultMesh.services.openSite(detail.id, site); })}>{site}<ExternalLinkIcon data-icon="inline-end" /></Button>)}</div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{(Object.keys(groupLabels) as ServiceItemKind[]).map((kind) => <div key={kind} className="rounded-lg bg-muted/50 p-3"><p className="text-xs text-muted-foreground">{groupLabels[kind]}</p><p className="mt-1 text-xl font-semibold">{detail.counts[kind]}</p></div>)}</div></CardContent></Card>

          <ApiEnvironmentPanel
            service={detail}
            logins={apiLoginOptions}
            secrets={apiSecretOptions}
            setupCredential={pendingApiEnvironmentSetup}
            setupRequest={environmentSetupRequest}
            onSetupComplete={clearApiEnvironmentSetup}
          />

          <Card><CardHeader><CardTitle>关联内容</CardTitle><CardDescription>所有秘密操作仍由原项目控制。</CardDescription></CardHeader><CardContent className="space-y-5">{grouped.length === 0 && <p className="text-sm text-muted-foreground">尚未关联项目。</p>}{grouped.map((group) => <section key={group.kind}><h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{groupLabels[group.kind]}</h3><div className="space-y-2">{group.relationships.map((relationship) => { const key = relationshipKey(relationship); const option = optionByKey.get(key); return <div key={key} className="flex flex-wrap items-center gap-2 rounded-xl border p-3"><button className="min-w-32 flex-1 text-left" type="button" onClick={() => goToItem(relationship)}><span className="block truncate font-medium">{option?.label ?? '不可导航的项目'}</span><span className="text-xs text-muted-foreground">{relationship.source === 'manual' ? '手动关联' : '精确主机自动关联'}</span></button><Select value={moveTargets[key] || EMPTY_SELECT_VALUE} onValueChange={(value) => setMoveTargets((current) => ({ ...current, [key]: value === EMPTY_SELECT_VALUE ? '' : value }))}><SelectTrigger className="h-8 max-w-40 text-xs" aria-label={`移动 ${option?.label ?? '项目'} 到其他网站或服务`}><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value={EMPTY_SELECT_VALUE}>移动到…</SelectItem>{services.filter((service) => service.id !== detail.id).map((service) => <SelectItem key={service.id} value={service.id}>{service.name}</SelectItem>)}</SelectGroup></SelectContent></Select><Button variant="outline" size="icon-sm" disabled={!moveTargets[key]} aria-label="确认移动" onClick={() => move(relationship)}><ArrowRightIcon /></Button><Button variant="ghost" size="icon-sm" aria-label="拆分为新网站或服务" onClick={() => openSplit(relationship)}><SplitIcon /></Button><Button variant="ghost" size="icon-sm" aria-label="移除关联" onClick={() => unlink(relationship)}><UnlinkIcon /></Button></div>; })}</div></section>)}<div className="flex gap-2 border-t pt-4"><Select value={linkKey || EMPTY_SELECT_VALUE} onValueChange={(value) => setLinkKey(value === EMPTY_SELECT_VALUE ? '' : value)}><SelectTrigger className="h-9 min-w-0 flex-1" aria-label="选择要关联的项目"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value={EMPTY_SELECT_VALUE}>选择一个未关联项目…</SelectItem>{itemOptions.filter((option) => !detail.relationships.some((relationship) => relationshipKey(relationship) === option.key)).map((option) => <SelectItem key={option.key} value={option.key}>{groupLabels[option.kind]} · {option.label}</SelectItem>)}</SelectGroup></SelectContent></Select><Button variant="outline" disabled={!linkKey || busy} onClick={addLink}><Link2Icon />关联</Button></div></CardContent></Card>

          {services.length > 1 && <Card size="sm"><CardHeader><CardTitle>合并重复网站/服务</CardTitle><CardDescription>关系和站点会合并，来源记录进入回收站；原项目保持不变。</CardDescription></CardHeader><CardContent className="flex gap-2"><Select value={mergeTarget || EMPTY_SELECT_VALUE} onValueChange={(value) => setMergeTarget(value === EMPTY_SELECT_VALUE ? '' : value)}><SelectTrigger className="h-9 min-w-0 flex-1" aria-label="选择合并目标"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value={EMPTY_SELECT_VALUE}>合并到…</SelectItem>{services.filter((service) => service.id !== detail.id).map((service) => <SelectItem key={service.id} value={service.id}>{service.name}</SelectItem>)}</SelectGroup></SelectContent></Select><Button variant="outline" disabled={!mergeTarget || busy} onClick={() => void run(async () => { const merged = await window.vaultMesh.services.merge(detail.id, mergeTarget); await load(merged.id); toast.success('网站/服务已合并。'); })}><MergeIcon />合并</Button></CardContent></Card>}
        </>}
      </div>
      </ScrollArea>

      <Dialog open={editorOpen} onOpenChange={(open) => { setEditorOpen(open); if (!open) setSplitRelationship(null); }}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>{splitRelationship ? '拆分为新网站/服务' : editingId ? '编辑网站/服务' : '新建网站/服务'}</DialogTitle><DialogDescription>这里只保存非秘密说明、标签、站点地址和导航关系。</DialogDescription></DialogHeader><div className="grid gap-3"><Input autoFocus aria-label="名称" placeholder="名称" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /><Textarea aria-label="说明" placeholder="非秘密说明（可选）" value={draft.description ?? ''} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value || null }))} /><Input aria-label="标签" placeholder="标签，以逗号分隔" value={draft.tags.join(', ')} onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value.split(',') }))} /><Textarea aria-label="站点地址" placeholder={'每行一个 HTTP(S) 地址\nhttps://example.com'} value={draft.sites.join('\n')} onChange={(event) => setDraft((current) => ({ ...current, sites: event.target.value.split('\n') }))} /></div><DialogFooter><Button variant="outline" onClick={() => setEditorOpen(false)}>取消</Button><Button disabled={busy || !draft.name.trim() || !draft.sites.some((site) => site.trim())} onClick={save}>{splitRelationship ? '拆分' : editingId ? '保存' : '创建'}</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={plan !== null} onOpenChange={(open) => { if (!open) setPlan(null); }}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>自动整理预览</DialogTitle><DialogDescription>预览绑定当前保险库和项目版本；项目变化后必须重新扫描。</DialogDescription></DialogHeader>{plan && <div className="space-y-4"><div className="grid grid-cols-3 gap-2"><div className="rounded-lg bg-emerald-500/10 p-3"><p className="text-xs text-muted-foreground">高置信度</p><p className="text-2xl font-semibold">{plan.highConfidenceItemCount}</p></div><div className="rounded-lg bg-amber-500/10 p-3"><p className="text-xs text-muted-foreground">冲突</p><p className="text-2xl font-semibold">{plan.conflictCount}</p></div><div className="rounded-lg bg-muted p-3"><p className="text-xs text-muted-foreground">未分组</p><p className="text-2xl font-semibold">{plan.ungroupedCount}</p></div></div><div className="max-h-64 space-y-3 overflow-auto">{plan.clusters.slice(0, 50).map((cluster) => <div key={cluster.serviceKey} className="flex items-center justify-between gap-2 rounded-lg border p-3"><div className="min-w-0"><p className="truncate font-medium">{cluster.suggestedName}</p><p className="text-xs text-muted-foreground">{cluster.relationships.length} 个项目 · 精确主机</p></div><div className="flex items-center gap-1"><Badge variant="outline">{cluster.existingServiceId ? '关联现有' : '新建'}</Badge><Button variant="ghost" size="sm" onClick={() => ignoreCluster(cluster)}>忽略</Button></div></div>)}{plan.reviewItems.length > 0 && <section className="space-y-2 border-t pt-3"><h3 className="text-xs font-semibold text-muted-foreground">待确认 / 未分组</h3>{plan.reviewItems.slice(0, 50).map((item) => <button key={`${item.itemKind}:${item.itemId}`} type="button" className="flex w-full items-center justify-between rounded-lg border p-3 text-left hover:bg-muted/50" onClick={() => goToItem({ itemKind: item.itemKind, itemId: item.itemId, source: 'manual' })}><span className="truncate font-medium">{item.label}</span><span className="text-xs text-muted-foreground">{item.reason === 'conflicting-metadata' ? 'metadata 冲突' : '无安全分组键'}</span></button>)}</section>}</div></div>}<DialogFooter><Button variant="outline" onClick={() => setPlan(null)}>取消</Button><Button disabled={busy || !plan || plan.highConfidenceItemCount === 0} onClick={applyPlan}>确认应用高置信度结果</Button></DialogFooter></DialogContent></Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={(open) => { if (!open) setDeleteId(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除这个网站/服务？</AlertDialogTitle><AlertDialogDescription>只会把聚合记录移入回收站，不会删除任何登录、密钥、SSH 凭据或身份。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { if (!deleteId) return; void run(async () => { await window.vaultMesh.services.delete(deleteId); setDeleteId(null); await load(null); }); }}>删除聚合记录</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </section>
  );
}
