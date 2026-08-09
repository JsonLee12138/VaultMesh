import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleIcon,
  CopyIcon,
  CreditCardIcon,
  FileTextIcon,
  FileUpIcon,
  FingerprintIcon,
  LockKeyholeIcon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  StarIcon,
  Trash2Icon,
  WandSparklesIcon,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';

import { ErrorBanner } from '../components/ErrorBanner';
import { PasswordField } from '../components/PasswordField';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputGroupButton } from '@/components/ui/input-group';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { LoginCustomField, TotpCode } from '../../../shared/contracts';
import { useVaultStore } from '@/stores/vault-store';
import { generateEmailAlias, generatePassword, generateUsername } from '@/lib/password-generator';
import { parseRecoveryCodes } from '@/lib/recovery-codes';

interface ItemEditorPageProps {
  itemId?: string;
}

type ItemEditorSection = 'basics' | 'credentials' | 'autofill' | 'security' | 'additional';

interface ItemEditorSectionDefinition {
  id: ItemEditorSection;
  label: string;
  description: string;
  icon: LucideIcon;
}

const itemEditorSections: ItemEditorSectionDefinition[] = [
  { id: 'basics', label: '基本信息', description: '为这条登录信息命名并整理。', icon: FileTextIcon },
  { id: 'credentials', label: '登录凭据', description: '输入用于登录此帐户的凭据信息。', icon: LockKeyholeIcon },
  { id: 'autofill', label: '自动填充', description: '配置网站匹配与页面加载填充。', icon: CreditCardIcon },
  { id: 'security', label: '安全与恢复', description: '管理验证器、恢复码和 Passkey。', icon: ShieldCheckIcon },
  { id: 'additional', label: '附加选项', description: '添加备注、自定义字段和访问保护。', icon: SlidersHorizontalIcon },
];

export function ItemEditorPage({ itemId }: ItemEditorPageProps) {
  const item = useVaultStore((state) => state.items.find((candidate) => candidate.id === itemId) ?? null);
  const busy = useVaultStore((state) => state.busy);
  const error = useVaultStore((state) => state.error);
  const addItem = useVaultStore((state) => state.addItem);
  const updateItem = useVaultStore((state) => state.updateItem);
  const getItemDetail = useVaultStore((state) => state.getItemDetail);
  const secrets = useVaultStore((state) => state.secrets);
  const linkedPasskeys = useMemo(
    () => secrets.filter((secret) => secret.isPasskey && secret.loginId === itemId),
    [itemId, secrets],
  );
  const deleteSecret = useVaultStore((state) => state.deleteSecret);
  const navigate = useNavigate();
  const [loadingDetails, setLoadingDetails] = useState(Boolean(item));
  const [title, setTitle] = useState(item?.title ?? '');
  const [folder, setFolder] = useState('');
  const [favorite, setFavorite] = useState(false);
  const [username, setUsername] = useState(item?.username ?? '');
  const [password, setPassword] = useState('');
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [generatorType, setGeneratorType] = useState<'password' | 'username' | 'emailAlias'>('password');
  const [generatorLength, setGeneratorLength] = useState(20);
  const [generatorClasses, setGeneratorClasses] = useState({ lowercase: true, uppercase: true, digits: true, symbols: true });
  const [aliasDomain, setAliasDomain] = useState('example.com');
  const [generatorHistory, setGeneratorHistory] = useState<Array<{ type: 'password' | 'username' | 'emailAlias'; value: string }>>([]);
  const [totpSecret, setTotpSecret] = useState('');
  const [hasTotpSecret, setHasTotpSecret] = useState(false);
  const [clearTotpSecret, setClearTotpSecret] = useState(false);
  const [totpCode, setTotpCode] = useState<TotpCode | null>(null);
  const [totpError, setTotpError] = useState<string | null>(null);
  const [copyingTotp, setCopyingTotp] = useState(false);
  const [totpRefreshKey, setTotpRefreshKey] = useState(0);
  const [recoveryCodesInput, setRecoveryCodesInput] = useState('');
  const [hasRecoveryCodes, setHasRecoveryCodes] = useState(false);
  const [clearRecoveryCodes, setClearRecoveryCodes] = useState(false);
  const [importingRecoveryCodes, setImportingRecoveryCodes] = useState(false);
  const [recoveryDialogOpen, setRecoveryDialogOpen] = useState(false);
  const [revealedRecoveryCodes, setRevealedRecoveryCodes] = useState<string[]>([]);
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [recoveryCopyIndex, setRecoveryCopyIndex] = useState<number | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [urls, setUrls] = useState<string[]>([item?.url ?? '']);
  const [autofillOnPageLoad, setAutofillOnPageLoad] = useState(true);
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [masterPasswordReprompt, setMasterPasswordReprompt] = useState(false);
  const [customFields, setCustomFields] = useState<LoginCustomField[]>([]);
  const [activeSection, setActiveSection] = useState<ItemEditorSection>('basics');
  const editorContentRef = useRef<HTMLDivElement | null>(null);
  const sectionNavigationTimerRef = useRef<number | null>(null);
  const sectionRefs = useRef<Record<ItemEditorSection, HTMLElement | null>>({
    basics: null,
    credentials: null,
    autofill: null,
    security: null,
    additional: null,
  });

  useEffect(() => {
    if (itemId && !item) {
      void navigate({ to: '/vault', replace: true });
      return;
    }
    if (!item) {
      setLoadingDetails(false);
      return;
    }
    let active = true;
    void getItemDetail(item.id).then((detail) => {
      if (!active || !detail) return;
      setTitle(detail.title);
      setFolder(detail.folder ?? '');
      setFavorite(detail.favorite);
      setUsername(detail.username);
      setUrls([detail.url ?? '', ...detail.additionalUrls]);
      setAutofillOnPageLoad(detail.autofillOnPageLoad);
      setNotes(detail.notes ?? '');
      setMasterPasswordReprompt(detail.masterPasswordReprompt);
      setCustomFields(detail.customFields);
      setHasTotpSecret(detail.hasTotpSecret);
      setHasRecoveryCodes(detail.hasRecoveryCodes);
      setLoadingDetails(false);
    });
    return () => { active = false; };
  }, [getItemDetail, item, itemId, navigate]);

  useEffect(() => {
    if (!item || !hasTotpSecret || clearTotpSecret || item.masterPasswordReprompt) {
      setTotpCode(null);
      setTotpError(null);
      return;
    }
    let active = true;
    const refresh = async (): Promise<void> => {
      try {
        const next = await window.vaultMesh.items.totpCode(item.id);
        if (!active) return;
        setTotpCode(next);
        setTotpError(null);
      } catch {
        if (active) setTotpError('无法生成验证器验证码，请替换或移除该密钥。');
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [clearTotpSecret, hasTotpSecret, item?.id, totpRefreshKey]);

  const applyGeneratedValue = (type: 'password' | 'username' | 'emailAlias', value: string): void => {
    if (type === 'password') setPassword(value);
    else setUsername(value);
  };

  const createGeneratedValue = (): void => {
    try {
      const value = generatorType === 'password'
        ? generatePassword({ length: generatorLength, ...generatorClasses })
        : generatorType === 'username'
          ? generateUsername({ length: generatorLength })
          : generateEmailAlias({ length: generatorLength, domain: aliasDomain });
      applyGeneratedValue(generatorType, value);
      setGeneratorHistory((current) => [{ type: generatorType, value }, ...current.filter((entry) => entry.value !== value)].slice(0, 10));
      toast.success(generatorType === 'password' ? '已生成新密码并填入密码字段。' : '已生成并填入用户名字段。');
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '无法生成内容。');
    }
  };

  const updateUrl = (index: number, value: string): void => {
    setUrls((current) => current.map((url, candidate) => candidate === index ? value : url));
  };

  const removeUrl = (index: number): void => {
    setUrls((current) => current.length === 1 ? [''] : current.filter((_, candidate) => candidate !== index));
  };

  const updateCustomField = (index: number, key: keyof LoginCustomField, value: string): void => {
    setCustomFields((current) => current.map((field, candidate) => candidate === index ? { ...field, [key]: value } : field));
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const [url, ...additionalUrls] = urls.map((value) => value.trim()).filter(Boolean);
    const fields = customFields.filter((field) => field.label.trim() || field.value).map((field) => ({ ...field, label: field.label.trim() }));
    const recoveryCodes = parseRecoveryCodes(recoveryCodesInput);
    try {
      const succeeded = item
        ? await updateItem({
          id: item.id,
          title,
          username,
          password: password || null,
          url: url ?? null,
          notes: notes || null,
          folder: folder || null,
          favorite,
          totpSecret: totpSecret || null,
          clearTotpSecret,
          recoveryCodes: recoveryCodes.length > 0 ? recoveryCodes : null,
          clearRecoveryCodes,
          additionalUrls,
          autofillOnPageLoad,
          masterPasswordReprompt,
          customFields: fields,
        })
        : await addItem({
          title,
          username,
          password,
          url: url ?? null,
          notes: notes || null,
          folder: folder || null,
          favorite,
          totpSecret: totpSecret || null,
          recoveryCodes,
          additionalUrls,
          autofillOnPageLoad,
          masterPasswordReprompt,
          customFields: fields,
        });
      if (succeeded) void navigate({ to: '/vault', replace: true });
    } finally {
      setPassword('');
      setTotpSecret('');
      setRecoveryCodesInput('');
    }
  };

  const closeRecoveryDialog = (): void => {
    setRecoveryDialogOpen(false);
    setRevealedRecoveryCodes([]);
    setRecoveryPassword('');
    setRecoveryCopyIndex(null);
    setRecoveryBusy(false);
    setRecoveryError(null);
  };

  useEffect(() => window.vaultMesh.vault.onLocked(() => {
    closeRecoveryDialog();
    setPassword('');
    setTotpSecret('');
    setRecoveryCodesInput('');
  }), []);

  const authenticateRecoveryAction = async (): Promise<void> => {
    if (!item || recoveryPassword.length < 8) return;
    setRecoveryBusy(true);
    setRecoveryError(null);
    try {
      if (recoveryCopyIndex === null) {
        const result = await window.vaultMesh.items.recoveryCodes(item.id, recoveryPassword);
        setRevealedRecoveryCodes(result.codes);
      } else {
        await window.vaultMesh.items.copyRecoveryCode(item.id, recoveryCopyIndex, recoveryPassword);
        toast.success('恢复码已复制到剪贴板。');
        setRecoveryCopyIndex(null);
      }
      setRecoveryPassword('');
    } catch {
      setRecoveryError('主密码不正确，或恢复码已不可用。');
      setRecoveryPassword('');
    } finally {
      setRecoveryBusy(false);
    }
  };

  const copyTotp = async (): Promise<void> => {
    if (!item) return;
    setCopyingTotp(true);
    try {
      await window.vaultMesh.items.copyTotp(item.id);
      toast.success('验证码已复制到剪贴板。');
    } catch {
      toast.error('无法复制验证码。');
    } finally {
      setCopyingTotp(false);
    }
  };

  const importRecoveryCodesFile = async (): Promise<void> => {
    if (importingRecoveryCodes) return;
    setImportingRecoveryCodes(true);
    try {
      const result = await window.vaultMesh.items.importRecoveryCodesFile();
      if (!result) return;
      setRecoveryCodesInput(result.codes.join('\n'));
      setClearRecoveryCodes(false);
      if (result.sourceFileStatus === 'deleted') {
        toast.success(`已从“${result.fileName}”导入 ${result.codes.length} 个恢复码，原文件已删除。`);
      } else if (result.sourceFileStatus === 'kept') {
        toast.info(`已从“${result.fileName}”导入 ${result.codes.length} 个恢复码，原文件已保留。`);
      } else {
        toast.warning(`已导入 ${result.codes.length} 个恢复码，但原文件未能删除，请手动检查。`);
      }
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '无法导入恢复码文件。');
    } finally {
      setImportingRecoveryCodes(false);
    }
  };

  const sectionCompletion: Record<ItemEditorSection, boolean> = {
    basics: title.trim().length > 0,
    credentials: Boolean(item || password),
    autofill: urls.some((value) => value.trim().length > 0),
    security: hasTotpSecret || totpSecret.length > 0 || hasRecoveryCodes || recoveryCodesInput.length > 0 || linkedPasskeys.length > 0,
    additional: notes.length > 0 || masterPasswordReprompt || customFields.some((field) => field.label.trim() || field.value),
  };

  const goToSection = (sectionId: ItemEditorSection): void => {
    setActiveSection(sectionId);
    if (sectionNavigationTimerRef.current !== null) window.clearTimeout(sectionNavigationTimerRef.current);
    sectionNavigationTimerRef.current = window.setTimeout(() => {
      sectionNavigationTimerRef.current = null;
    }, 1_200);
    const section = sectionRefs.current[sectionId];
    const content = editorContentRef.current;
    if (section && content) {
      const paddingTop = Number.parseFloat(window.getComputedStyle(content).paddingTop) || 0;
      const top = content.scrollTop + section.getBoundingClientRect().top - content.getBoundingClientRect().top - paddingTop;
      content.scrollTo({ top, behavior: 'smooth' });
    }
  };

  const handleEditorScroll = (): void => {
    const content = editorContentRef.current;
    if (!content || sectionNavigationTimerRef.current !== null) return;
    const contentTop = content.getBoundingClientRect().top;
    let nextSection = itemEditorSections[0].id;
    for (const section of itemEditorSections) {
      const element = sectionRefs.current[section.id];
      if (element && element.getBoundingClientRect().top <= contentTop + 48) nextSection = section.id;
    }
    if (nextSection !== activeSection) setActiveSection(nextSection);
  };

  const activeSectionIndex = itemEditorSections.findIndex((section) => section.id === activeSection);
  const nextSection = itemEditorSections[activeSectionIndex + 1] ?? null;

  if (loadingDetails) {
    return <div className="grid min-h-64 place-items-center"><Spinner /></div>;
  }

  return (
    <section className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <form id="item-editor" className="flex min-h-0 flex-1 flex-col overflow-hidden" onSubmit={(event) => void submit(event)}>
        {error && <div className="px-5 pt-4"><ErrorBanner message={error} /></div>}
        <div className="grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[17rem_minmax(0,1fr)]">
            <nav aria-label="登录信息表单分区" className="flex gap-2 overflow-x-auto border-b p-3 lg:flex-col lg:border-r lg:border-b-0 lg:p-4" data-editor-navigation>
              {itemEditorSections.map((section) => {
                const Icon = section.icon;
                const complete = sectionCompletion[section.id];
                return (
                  <Button
                    className="h-auto min-w-40 justify-start py-3 lg:min-w-0"
                    key={section.id}
                    variant={activeSection === section.id ? 'secondary' : 'ghost'}
                    type="button"
                    aria-current={activeSection === section.id ? 'step' : undefined}
                    onClick={() => goToSection(section.id)}
                  >
                    <Icon data-icon="inline-start" />
                    <span className="truncate">{section.label}</span>
                    {complete ? <CheckCircle2Icon className="ml-auto" aria-label="已填写" /> : <CircleIcon className="ml-auto" aria-label="未填写" />}
                  </Button>
                );
              })}
            </nav>

            <div
              ref={editorContentRef}
              className="min-h-0 min-w-0 scroll-smooth overflow-y-auto px-5 py-7 lg:px-12 lg:py-10"
              data-editor-scroll-region
              onScroll={handleEditorScroll}
            >
              <section ref={(element) => { sectionRefs.current.basics = element; }} className="scroll-mt-6 outline-none" tabIndex={-1} aria-labelledby="item-editor-basics-title">
                <div className="mb-6">
                  <h2 id="item-editor-basics-title" className="text-xl font-semibold">基本信息</h2>
                  <p className="mt-1 text-sm text-muted-foreground">为这条登录信息命名并整理。</p>
                </div>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="item-title">项目名称</FieldLabel>
                    <Input id="item-title" value={title} maxLength={256} autoFocus required onChange={(event) => setTitle(event.target.value)} />
                  </Field>
                  <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <Field>
                      <FieldLabel htmlFor="item-folder">文件夹</FieldLabel>
                      <Input id="item-folder" value={folder} maxLength={256} placeholder="例如：个人、工作" onChange={(event) => setFolder(event.target.value)} />
                    </Field>
                    <Field className="sm:w-auto">
                      <FieldLabel htmlFor="item-favorite">收藏</FieldLabel>
                      <Button className="w-full sm:w-fit" id="item-favorite" variant={favorite ? 'default' : 'outline'} type="button" aria-pressed={favorite} onClick={() => setFavorite((value) => !value)}>
                        <StarIcon data-icon="inline-start" className={favorite ? 'fill-current' : undefined} />
                        {favorite ? '已收藏' : '加入收藏'}
                      </Button>
                    </Field>
                  </div>
                </FieldGroup>
              </section>

              <Separator className="my-8" />

              <section ref={(element) => { sectionRefs.current.credentials = element; }} className="scroll-mt-6 outline-none" tabIndex={-1} aria-labelledby="item-editor-credentials-title">
                <div className="mb-6">
                  <h2 id="item-editor-credentials-title" className="text-xl font-semibold">登录凭据</h2>
                  <p className="mt-1 text-sm text-muted-foreground">输入用于登录此帐户的凭据信息。</p>
                </div>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="item-username">用户名</FieldLabel>
                    <Input id="item-username" value={username} maxLength={2_048} spellCheck={false} autoComplete="username" onChange={(event) => setUsername(event.target.value)} />
                  </Field>
                  <PasswordField
                    id="item-password"
                    label={item ? '新密码（留空则保持不变）' : '密码'}
                    value={password}
                    minLength={item ? undefined : 1}
                    trailingAction={(
                      <InputGroupButton type="button" variant="outline" aria-expanded={generatorOpen} onClick={() => setGeneratorOpen((value) => !value)}>
                        <WandSparklesIcon data-icon="inline-start" />
                        {generatorOpen ? '收起' : '生成'}
                      </InputGroupButton>
                    )}
                    onChange={setPassword}
                  />
                  {generatorOpen && (
                    <FieldGroup className="rounded-lg bg-muted/50 p-4">
                      <div>
                        <p className="text-sm font-medium">凭据生成器</p>
                        <p className="mt-1 text-xs text-muted-foreground">使用系统安全随机源；生成历史仅保留在当前编辑会话中。</p>
                      </div>
                      <Field>
                        <FieldLabel htmlFor="generator-type">生成内容</FieldLabel>
                        <Select value={generatorType} onValueChange={(value) => setGeneratorType(value as typeof generatorType)}>
                          <SelectTrigger id="generator-type" className="h-9 w-full"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectGroup><SelectItem value="password">口令</SelectItem><SelectItem value="username">用户名</SelectItem><SelectItem value="emailAlias">邮箱别名</SelectItem></SelectGroup></SelectContent>
                        </Select>
                      </Field>
                      <label className="grid gap-1 text-sm"><span>长度：{generatorLength}</span><input type="range" min={generatorType === 'password' ? '12' : '6'} max="64" value={generatorLength} onChange={(event) => setGeneratorLength(Number(event.target.value))} /></label>
                      {generatorType === 'emailAlias' && <Field><FieldLabel htmlFor="alias-domain">邮箱别名域名</FieldLabel><Input id="alias-domain" value={aliasDomain} maxLength={253} spellCheck={false} placeholder="example.com" onChange={(event) => setAliasDomain(event.target.value)} /></Field>}
                      {generatorType === 'password' && <div className="flex flex-wrap gap-4 text-sm">
                        {([['lowercase', '小写字母'], ['uppercase', '大写字母'], ['digits', '数字'], ['symbols', '符号']] as const).map(([key, label]) => <label className="flex items-center gap-2" key={key}><input className="accent-primary" type="checkbox" checked={generatorClasses[key]} onChange={(event) => setGeneratorClasses((current) => ({ ...current, [key]: event.target.checked }))} />{label}</label>)}
                      </div>}
                      <Button className="w-fit" type="button" onClick={createGeneratedValue}><WandSparklesIcon data-icon="inline-start" />生成{generatorType === 'password' ? '口令' : generatorType === 'username' ? '用户名' : '邮箱别名'}</Button>
                      {generatorHistory.length > 0 && <div className="grid gap-2"><p className="text-sm font-medium">生成历史</p>{generatorHistory.map((entry, index) => <div className="flex items-center gap-2" key={`${entry.value}-${index}`}><code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1 text-xs">{entry.value}</code><Button variant="outline" size="sm" type="button" onClick={() => { applyGeneratedValue(entry.type, entry.value); toast.success('已填入对应字段。'); }}>使用</Button></div>)}</div>}
                    </FieldGroup>
                  )}
                </FieldGroup>
              </section>

              <Separator className="my-8" />

              <section ref={(element) => { sectionRefs.current.autofill = element; }} className="scroll-mt-6 outline-none" tabIndex={-1} aria-labelledby="item-editor-autofill-title">
                <div className="mb-6">
                  <h2 id="item-editor-autofill-title" className="text-xl font-semibold">自动填充</h2>
                  <p className="mt-1 text-sm text-muted-foreground">配置网站匹配与页面加载填充。</p>
                </div>
                <FieldGroup>
                  {urls.map((value, index) => (
                    <Field key={index}>
                      <FieldLabel htmlFor={`item-url-${index}`}>{index === 0 ? '网站（URI）' : `附加网站 ${index}`}</FieldLabel>
                      <div className="flex gap-2">
                        <Input id={`item-url-${index}`} type="url" value={value} maxLength={10_000} spellCheck={false} placeholder="https://example.com" onChange={(event) => updateUrl(index, event.target.value)} />
                        <Button variant="outline" size="icon" type="button" aria-label="移除网站" onClick={() => removeUrl(index)}><Trash2Icon /></Button>
                      </div>
                    </Field>
                  ))}
                  <Button className="w-fit" variant="outline" type="button" onClick={() => setUrls((current) => [...current, ''])}><PlusIcon data-icon="inline-start" />添加网站</Button>
                  <Field orientation="horizontal">
                    <FieldLabel htmlFor="item-autofill-on-load">允许匹配的网站请求页面加载自动填充</FieldLabel>
                    <Switch id="item-autofill-on-load" checked={autofillOnPageLoad} onCheckedChange={setAutofillOnPageLoad} />
                  </Field>
                  <FieldDescription>浏览器集成只会使用这里保存的网站规则匹配候选项。</FieldDescription>
                </FieldGroup>
              </section>

              <Separator className="my-8" />

              <section ref={(element) => { sectionRefs.current.security = element; }} className="scroll-mt-6 outline-none" tabIndex={-1} aria-labelledby="item-editor-security-title">
                <div className="mb-6">
                  <h2 id="item-editor-security-title" className="text-xl font-semibold">安全与恢复</h2>
                  <p className="mt-1 text-sm text-muted-foreground">验证器密钥和恢复码在编辑时不会回显。</p>
                </div>
                <FieldGroup>
                  <PasswordField id="item-totp" label={hasTotpSecret ? '替换验证器密钥（可选）' : '验证器密钥（可选）'} value={totpSecret} placeholder="TOTP 密钥" onChange={(value) => { setTotpSecret(value); if (value) setClearTotpSecret(false); }} />
                  {hasTotpSecret && !clearTotpSecret && !item?.masterPasswordReprompt && (
                    <div className="rounded-lg bg-muted/50 p-4" aria-live="polite">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">当前验证码</p>
                          {totpError ? <p className="mt-1 text-sm text-destructive">{totpError}</p> : <p className="mt-1 font-mono text-3xl font-semibold tracking-[0.25em]">{totpCode?.code ?? '------'}</p>}
                          {!totpError && <p className="mt-1 text-xs text-muted-foreground">{totpCode ? `${totpCode.remainingSeconds} 秒后刷新` : '正在生成…'}</p>}
                        </div>
                        <div className="flex gap-2">
                          <Button variant="outline" size="icon" type="button" aria-label="刷新验证码" onClick={() => setTotpRefreshKey((value) => value + 1)}><RefreshCwIcon /></Button>
                          <Button type="button" disabled={!totpCode || copyingTotp} onClick={() => void copyTotp()}><CopyIcon data-icon="inline-start" />{copyingTotp ? '正在复制…' : '复制验证码'}</Button>
                        </div>
                      </div>
                    </div>
                  )}
                  {hasTotpSecret && !clearTotpSecret && item?.masterPasswordReprompt && <p className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">该项目已启用主密码二次验证，请从保险库列表查看或复制验证码。</p>}
                  {hasTotpSecret && !clearTotpSecret && <Button className="w-fit" variant="outline" type="button" onClick={() => { setClearTotpSecret(true); setHasTotpSecret(false); }}><Trash2Icon data-icon="inline-start" />移除验证器密钥</Button>}
                  <Field>
                    <FieldLabel htmlFor="item-recovery-codes">{hasRecoveryCodes && !clearRecoveryCodes ? '替换恢复码（可选）' : '恢复码（可选）'}</FieldLabel>
                    <Button className="w-fit" variant="outline" type="button" disabled={importingRecoveryCodes} onClick={() => void importRecoveryCodesFile()}>
                      {importingRecoveryCodes ? <RefreshCwIcon className="animate-spin" data-icon="inline-start" /> : <FileUpIcon data-icon="inline-start" />}
                      {importingRecoveryCodes ? '正在读取…' : '选择恢复码文件'}
                    </Button>
                    <Textarea id="item-recovery-codes" value={recoveryCodesInput} rows={5} maxLength={25_600} spellCheck={false} autoComplete="off" placeholder={'每行粘贴一个恢复码\n例如：ABCD-EFGH'} onChange={(event) => { setRecoveryCodesInput(event.target.value); if (event.target.value) setClearRecoveryCodes(false); }} />
                    <FieldDescription>可粘贴或选择不超过 32 KiB 的 UTF-8 文本文件，支持每行一个恢复码及 Google 下载的编号双栏格式；解析后会询问是否删除原文件。最多 100 个、每个不超过 256 个字符。保存后不会在编辑表单中回显。</FieldDescription>
                  </Field>
                  {item && hasRecoveryCodes && !clearRecoveryCodes && (
                    <div className="flex flex-wrap gap-2 rounded-lg bg-muted/50 p-4">
                      <div className="min-w-0 flex-1"><p className="text-sm font-medium">已保存恢复码</p><p className="text-xs text-muted-foreground">每次查看或复制都必须重新验证当前主密码。</p></div>
                      <Button variant="outline" type="button" onClick={() => { setRecoveryDialogOpen(true); setRecoveryCopyIndex(null); setRecoveryError(null); }}>查看恢复码</Button>
                      <Button variant="outline" type="button" onClick={() => { setClearRecoveryCodes(true); setHasRecoveryCodes(false); closeRecoveryDialog(); }}><Trash2Icon data-icon="inline-start" />移除恢复码</Button>
                    </div>
                  )}
                  {item && <div className="rounded-lg bg-muted/50 p-4">
                    <div className="flex items-start gap-3"><FingerprintIcon className="mt-0.5 size-5 text-primary" /><div><p className="text-sm font-medium">Passkey</p><p className="text-xs text-muted-foreground">Passkey 由对应网站注册并保存在此登录信息下，私钥不会显示或进入普通字段。</p></div></div>
                    {linkedPasskeys.length > 0 ? <div className="mt-3 grid gap-2">{linkedPasskeys.map((passkey) => <div className="flex items-center justify-between gap-3 rounded-md bg-background px-3 py-2" key={passkey.id}><div className="min-w-0"><p className="truncate text-sm font-medium">{passkey.title}</p><p className="truncate text-xs text-muted-foreground">{[passkey.account, passkey.website].filter(Boolean).join(' · ')}</p></div><Button variant="ghost" size="icon-sm" type="button" aria-label="删除 Passkey" disabled={busy} onClick={() => void (async () => { if (!window.confirm('删除后将无法再使用此 Passkey 登录，且无法恢复。确定删除吗？')) return; if (await deleteSecret(passkey.id)) toast.success('Passkey 已删除。'); })()}><Trash2Icon /></Button></div>)}</div> : <p className="mt-3 text-xs text-muted-foreground">此登录信息尚未关联 Passkey。请在网站的账户安全设置中选择“创建 Passkey”。</p>}
                  </div>}
                </FieldGroup>
              </section>

              <Separator className="my-8" />

              <section ref={(element) => { sectionRefs.current.additional = element; }} className="scroll-mt-6 outline-none" tabIndex={-1} aria-labelledby="item-editor-additional-title">
                <div className="mb-6">
                  <h2 id="item-editor-additional-title" className="text-xl font-semibold">附加选项</h2>
                  <p className="mt-1 text-sm text-muted-foreground">添加备注、自定义字段和访问保护。</p>
                </div>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="item-notes">备注</FieldLabel>
                    <Textarea id="item-notes" value={notes} maxLength={10_000} rows={5} onChange={(event) => setNotes(event.target.value)} />
                  </Field>
                  <Field orientation="horizontal">
                    <FieldLabel htmlFor="item-master-password-reprompt">主密码二次验证</FieldLabel>
                    <Switch id="item-master-password-reprompt" checked={masterPasswordReprompt} onCheckedChange={setMasterPasswordReprompt} />
                  </Field>
                  <FieldDescription>启用后，每次复制密码或读取/复制验证码都必须再次输入当前主密码。</FieldDescription>
                  <FieldGroup className="gap-3">
                    <FieldLabel>自定义字段</FieldLabel>
                    {customFields.map((field, index) => (
                      <div className="grid gap-2 rounded-md bg-muted/50 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" key={index}>
                        <Input aria-label="字段名称" value={field.label} maxLength={256} placeholder="字段名称" onChange={(event) => updateCustomField(index, 'label', event.target.value)} />
                        <Input aria-label="字段值" value={field.value} maxLength={10_000} placeholder="字段值" onChange={(event) => updateCustomField(index, 'value', event.target.value)} />
                        <Button variant="ghost" size="icon" type="button" aria-label="删除自定义字段" onClick={() => setCustomFields((current) => current.filter((_, candidate) => candidate !== index))}><Trash2Icon /></Button>
                      </div>
                    ))}
                    <Button className="w-fit" variant="outline" type="button" disabled={customFields.length >= 50} onClick={() => setCustomFields((current) => [...current, { label: '', value: '' }])}><PlusIcon data-icon="inline-start" />添加字段</Button>
                    <FieldDescription>字段名称不能为空；空白字段不会保存。</FieldDescription>
                  </FieldGroup>
                </FieldGroup>
              </section>
            </div>
          </div>
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t bg-background px-5 py-4 lg:px-8">
            <Button variant="outline" type="button" onClick={() => void navigate({ to: '/vault' })}>取消</Button>
            <div className="flex gap-2">
              {nextSection && (
                <Button variant="outline" type="button" onClick={() => goToSection(nextSection.id)}>
                  下一步：{nextSection.label}
                  <ChevronRightIcon data-icon="inline-end" />
                </Button>
              )}
              <Button type="submit" disabled={busy}>
                {busy ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
                {busy ? '正在保存…' : '保存登录信息'}
              </Button>
            </div>
          </footer>
      </form>
      <Dialog open={recoveryDialogOpen} onOpenChange={(open) => { if (!open) closeRecoveryDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{recoveryCopyIndex === null && revealedRecoveryCodes.length > 0 ? '2FA 恢复码' : '主密码二次验证'}</DialogTitle>
            <DialogDescription>{recoveryCopyIndex !== null ? '复制这个恢复码前，请再次输入当前主密码。' : revealedRecoveryCodes.length > 0 ? '恢复码只在此对话框打开期间短暂显示。' : '查看恢复码前，请输入当前主密码。'}</DialogDescription>
          </DialogHeader>
          {recoveryCopyIndex === null && revealedRecoveryCodes.length > 0 ? (
            <div className="grid max-h-80 gap-2 overflow-y-auto">
              {revealedRecoveryCodes.map((code, index) => (
                <div className="flex items-center gap-2 rounded-md border border-border p-2" key={`${index}-${code}`}>
                  <code className="min-w-0 flex-1 break-all px-2 text-sm">{code}</code>
                  <Button variant="outline" size="icon-sm" type="button" aria-label={`复制恢复码 ${index + 1}`} onClick={() => { setRecoveryCopyIndex(index); setRecoveryError(null); }}><CopyIcon /></Button>
                </div>
              ))}
            </div>
          ) : (
            <Field data-invalid={Boolean(recoveryError)}>
              <FieldLabel htmlFor="recovery-master-password">当前主密码</FieldLabel>
              <Input id="recovery-master-password" type="password" value={recoveryPassword} minLength={8} maxLength={1_024} autoComplete="current-password" autoFocus aria-invalid={Boolean(recoveryError)} onChange={(event) => setRecoveryPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void authenticateRecoveryAction(); } }} />
              <FieldError>{recoveryError}</FieldError>
            </Field>
          )}
          <DialogFooter>
            {recoveryCopyIndex !== null && <Button variant="outline" type="button" disabled={recoveryBusy} onClick={() => { setRecoveryCopyIndex(null); setRecoveryPassword(''); setRecoveryError(null); }}>返回</Button>}
            <Button variant="outline" type="button" disabled={recoveryBusy} onClick={closeRecoveryDialog}>关闭</Button>
            {(recoveryCopyIndex !== null || revealedRecoveryCodes.length === 0) && <Button type="button" disabled={recoveryBusy || recoveryPassword.length < 8} onClick={() => void authenticateRecoveryAction()}>{recoveryBusy ? '正在验证…' : recoveryCopyIndex === null ? '验证并查看' : '验证并复制'}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
