import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { FileTextIcon, KeyRoundIcon, LinkIcon, ShieldCheckIcon, StarIcon, TagsIcon } from 'lucide-react';

import { DatePicker } from '../components/DatePicker';
import { PasswordField } from '../components/PasswordField';
import { SectionedEditorForm } from '../components/SectionedEditorForm';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { SECRET_ITEM_KIND_OPTIONS } from '@/lib/secret-item';
import { useVaultStore } from '@/stores/vault-store';
import type { SecretItemKind } from '../../../shared/contracts';

interface SecretItemEditorPageProps {
  secretId?: string;
}

export function SecretItemEditorPage({ secretId }: SecretItemEditorPageProps) {
  const item = useVaultStore((state) => state.secrets.find((candidate) => candidate.id === secretId) ?? null);
  const busy = useVaultStore((state) => state.busy);
  const error = useVaultStore((state) => state.error);
  const addSecret = useVaultStore((state) => state.addSecret);
  const updateSecret = useVaultStore((state) => state.updateSecret);
  const getSecretDetail = useVaultStore((state) => state.getSecretDetail);
  const navigate = useNavigate();
  const [loadingDetails, setLoadingDetails] = useState(Boolean(item));
  const [title, setTitle] = useState(item?.title ?? '');
  const [kind, setKind] = useState<SecretItemKind>(item?.kind ?? 'api-key');
  const [provider, setProvider] = useState(item?.provider ?? '');
  const [account, setAccount] = useState(item?.account ?? '');
  const [secret, setSecret] = useState('');
  const [environment, setEnvironment] = useState(item?.environment ?? '');
  const [scopes, setScopes] = useState('');
  const [expiresAt, setExpiresAt] = useState(item?.expiresAt ?? '');
  const [website, setWebsite] = useState(item?.website ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [folder, setFolder] = useState('');
  const [favorite, setFavorite] = useState(item?.favorite ?? false);
  const [masterPasswordReprompt, setMasterPasswordReprompt] = useState(item?.masterPasswordReprompt ?? false);

  useEffect(() => {
    if (secretId && !item) {
      void navigate({ to: '/vault', replace: true });
      return;
    }
    if (!item) {
      setLoadingDetails(false);
      return;
    }
    let active = true;
    void getSecretDetail(item.id).then((detail) => {
      if (!active || !detail) return;
      setTitle(detail.title);
      setKind(detail.kind);
      setProvider(detail.provider ?? '');
      setAccount(detail.account ?? '');
      setEnvironment(detail.environment ?? '');
      setScopes(detail.scopes.join(', '));
      setExpiresAt(detail.expiresAt ?? '');
      setWebsite(detail.website ?? '');
      setNotes(detail.notes ?? '');
      setFolder(detail.folder ?? '');
      setFavorite(detail.favorite);
      setMasterPasswordReprompt(detail.masterPasswordReprompt);
      setLoadingDetails(false);
    });
    return () => { active = false; };
  }, [getSecretDetail, item, navigate, secretId]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const input = {
      title,
      kind,
      provider: provider.trim() || null,
      account: account.trim() || null,
      environment: environment.trim() || null,
      scopes: [...new Set(scopes.split(/[,\n]/).map((scope) => scope.trim()).filter(Boolean))],
      expiresAt: expiresAt || null,
      website: website.trim() || null,
      notes: notes.trim() || null,
      folder: folder.trim() || null,
      favorite,
      masterPasswordReprompt,
    };
    try {
      const succeeded = item
        ? await updateSecret({ id: item.id, ...input, secret: secret || null })
        : await addSecret({ ...input, secret });
      if (succeeded) void navigate({ to: '/vault', replace: true });
    } finally {
      setSecret('');
    }
  };

  if (loadingDetails) return <div className="grid min-h-64 place-items-center"><Spinner /></div>;

  const selectedKind = SECRET_ITEM_KIND_OPTIONS.find((option) => option.value === kind);
  const isCredential = ['api-key', 'access-token', 'authenticator-key', 'client-secret', 'webhook-secret'].includes(kind);
  const valueLabel = isCredential ? '密钥值' : '内容';

  return (
    <SectionedEditorForm
      formId="secret-item-editor"
      error={error}
      busy={busy}
      submitLabel="保存机密信息"
      submitDisabled={!title.trim() || (!item && !secret)}
      onCancel={() => void navigate({ to: '/vault' })}
      onSubmit={(event) => void submit(event)}
      sections={[
        {
          id: 'basics', label: '基本信息', description: '选择机密类型并整理条目。', icon: FileTextIcon,
          complete: Boolean(title.trim()),
          content: <FieldGroup>
            <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Field><FieldLabel htmlFor="secret-title">名称</FieldLabel><Input id="secret-title" value={title} maxLength={256} autoFocus required placeholder="例如：GitHub 工作账号 Token" onChange={(event) => setTitle(event.target.value)} /></Field>
              <Field className="sm:w-auto"><FieldLabel htmlFor="secret-favorite">收藏</FieldLabel><Button className="w-full sm:w-fit" id="secret-favorite" variant={favorite ? 'default' : 'outline'} type="button" aria-pressed={favorite} onClick={() => setFavorite((value) => !value)}><StarIcon data-icon="inline-start" className={favorite ? 'fill-current' : undefined} />{favorite ? '已收藏' : '加入收藏'}</Button></Field>
            </div>
            <Field><FieldLabel htmlFor="secret-kind">类型</FieldLabel><Select value={kind} onValueChange={(value) => setKind(value as SecretItemKind)}><SelectTrigger id="secret-kind" className="h-9 w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{SECRET_ITEM_KIND_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent></Select><FieldDescription>{selectedKind?.description}</FieldDescription></Field>
          </FieldGroup>,
        },
        {
          id: 'value', label: selectedKind?.label ?? '机密内容', description: `${valueLabel}不会出现在保险库列表或普通编辑详情中。`, icon: KeyRoundIcon,
          complete: Boolean(item || secret),
          content: <FieldGroup><PasswordField id="secret-value" label={item ? `新${valueLabel}（留空则保持不变）` : valueLabel} value={secret} minLength={item ? undefined : 1} placeholder={kind === 'access-token' ? 'ghp_…' : kind === 'api-key' ? 'sk-…' : `输入${valueLabel}`} onChange={setSecret} /></FieldGroup>,
        },
        {
          id: 'ownership', label: '归属与权限', description: '记录服务商、账号、环境和最小权限范围。', icon: TagsIcon,
          complete: Boolean(provider.trim() || account.trim() || environment.trim() || scopes.trim() || expiresAt),
          content: <FieldGroup>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field><FieldLabel htmlFor="secret-provider">服务商</FieldLabel><Input id="secret-provider" value={provider} maxLength={256} placeholder="GitHub、OpenAI、TMDB" onChange={(event) => setProvider(event.target.value)} /></Field>
              <Field><FieldLabel htmlFor="secret-account">账号或项目</FieldLabel><Input id="secret-account" value={account} maxLength={256} placeholder="用户名、邮箱或项目 ID" onChange={(event) => setAccount(event.target.value)} /></Field>
              <Field><FieldLabel htmlFor="secret-environment">环境</FieldLabel><Input id="secret-environment" value={environment} maxLength={256} placeholder="Production、Staging、Local" onChange={(event) => setEnvironment(event.target.value)} /></Field>
              <Field><FieldLabel htmlFor="secret-expires">到期日</FieldLabel><DatePicker id="secret-expires" value={expiresAt} onValueChange={setExpiresAt} placeholder="选择到期日" /></Field>
            </div>
            <Field><FieldLabel htmlFor="secret-scopes">权限范围</FieldLabel><Input id="secret-scopes" value={scopes} maxLength={10_000} placeholder="repo, read:org, models:read" onChange={(event) => setScopes(event.target.value)} /><FieldDescription>用逗号分隔，便于以后检查最小权限和轮换范围。</FieldDescription></Field>
          </FieldGroup>,
        },
        {
          id: 'website', label: '网站关联', description: '用于标识服务站点和浏览器候选匹配。', icon: LinkIcon,
          complete: Boolean(website.trim()),
          content: <FieldGroup><Field><FieldLabel htmlFor="secret-website">网站（URI）</FieldLabel><Input id="secret-website" type="url" value={website} maxLength={2_048} placeholder="https://github.com" onChange={(event) => setWebsite(event.target.value)} /><FieldDescription>标识该密钥所属的网站，并用于浏览器中的同站点候选匹配。</FieldDescription></Field></FieldGroup>,
        },
        {
          id: 'protection', label: '保护与备注', description: '设置访问保护并补充非秘密说明。', icon: ShieldCheckIcon,
          complete: Boolean(masterPasswordReprompt || folder.trim() || notes.trim()),
          content: <FieldGroup>
            <Field orientation="horizontal"><FieldLabel htmlFor="secret-reprompt">启用主密码二次验证</FieldLabel><Switch id="secret-reprompt" checked={masterPasswordReprompt} onCheckedChange={setMasterPasswordReprompt} /></Field>
            <FieldDescription>适合生产环境、管理员权限或长期有效的密钥。</FieldDescription>
            <Field><FieldLabel htmlFor="secret-folder">文件夹</FieldLabel><Input id="secret-folder" value={folder} maxLength={256} placeholder="例如：工作、个人、AI" onChange={(event) => setFolder(event.target.value)} /></Field>
            <Field><FieldLabel htmlFor="secret-notes">备注</FieldLabel><Textarea id="secret-notes" value={notes} maxLength={10_000} rows={5} placeholder="用途、轮换方式或负责人；不要重复粘贴密钥值。" onChange={(event) => setNotes(event.target.value)} /></Field>
          </FieldGroup>,
        },
      ]}
    />
  );
}
