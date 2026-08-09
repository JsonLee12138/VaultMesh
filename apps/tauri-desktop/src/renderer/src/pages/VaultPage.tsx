import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowUpIcon, BoxesIcon, BracesIcon, CheckIcon, ContactIcon, CopyIcon, CpuIcon, ExternalLinkIcon, EyeIcon, EyeOffIcon, FileKeyIcon, FingerprintIcon, KeyRoundIcon, PencilIcon, SearchIcon, ShieldCheckIcon, TerminalIcon, Trash2Icon, UploadIcon, XIcon } from 'lucide-react';
import { toast } from 'sonner';

import { ErrorBanner } from '../components/ErrorBanner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useVaultStore } from '@/stores/vault-store';
import type { LoginItemSummary, PaymentCardSummary, SecretItemSummary, ServiceDetail, ServiceItemKind, ServiceRelationship, ServiceSummary, SshCredentialSummary, TotpCode } from '../../../shared/contracts';
import { AddItemMenu } from '@/components/AddItemMenu';
import { SshPublicKeyInstallDialog } from '@/components/SshPublicKeyInstallDialog';
import { SshExternalLauncher } from '@/components/SshExternalLauncher';
import { VirtualizedVaultGrid } from '@/components/VirtualizedVaultGrid';
import { formatCardExpiration, paymentCardMatchesSearch } from '@/lib/payment-card';
import { formatSshEndpoint, sshCredentialMatchesSearch } from '@/lib/ssh-credential';
import { secretItemDisplayTitle, secretItemKindLabel, secretItemMatchesSearch } from '@/lib/secret-item';
import { VAULT_CARD_VISUALS, vaultCardVisualFor } from '@/lib/vault-card-visual';
import { parseVaultItemSelectionKey, vaultItemSelectionKey, type VaultItemSelectionKey } from '@/lib/vault-item-selection';
import { VAULT_ITEM_TYPE_TABS, isVaultItemTypeVisible, readVaultItemTypeFilter, writeVaultItemTypeFilter, type VaultItemTypeFilter } from '@/lib/vault-item-type-filter';

type ProtectedAction = { kind: 'copyPassword' | 'showPassword' | 'showTotp' | 'copyTotp' | 'cardNumber' | 'cardSecurityCode' | 'cardPin' | 'sshPassword' | 'sshPrivateKey' | 'sshPassphrase' | 'secretValue'; id: string };

function displayDomain(url: string): string {
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).hostname.replace(/^www\./i, '');
  } catch {
    return url.replace(/^https?:\/\//i, '').split('/')[0] || url;
  }
}

const serviceGroupLabels: Record<ServiceItemKind, string> = {
  login: '登录账号',
  secret: 'API / 密钥',
  ssh: 'SSH',
  identity: '其他',
};

function serviceRelationshipKey(relationship: ServiceRelationship): string {
  return `${relationship.itemKind}:${relationship.itemId}`;
}

function VaultSelectionControl({ checked, label, inverted = true, onChange }: { checked: boolean; label: string; inverted?: boolean; onChange: () => void }) {
  return (
    <label className={cn('relative grid size-7 shrink-0 cursor-pointer place-items-center rounded-full border transition-colors', inverted ? 'border-white/20 bg-black/20 hover:border-white/60 hover:bg-white/10' : 'border-border bg-background/80 hover:border-primary/60 hover:bg-primary/10')} aria-label={label}>
      <input className="peer sr-only" type="checkbox" checked={checked} onChange={onChange} />
      <span className={cn('size-3 rounded-full border transition-colors', inverted ? 'border-white/50 peer-checked:border-white peer-checked:bg-white' : 'border-muted-foreground/50 peer-checked:border-primary peer-checked:bg-primary')} aria-hidden="true" />
      <CheckIcon className={cn('pointer-events-none absolute size-3 scale-0 transition-transform peer-checked:scale-100', inverted ? 'text-primary' : 'text-primary-foreground')} aria-hidden="true" />
    </label>
  );
}

const vaultCardActionClassName = 'text-white/70 hover:bg-white/10 hover:text-white';

function VaultCardActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute right-2 bottom-2 z-20 flex max-w-[calc(100%-1rem)] items-center gap-0.5 rounded-xl bg-black/55 p-1 opacity-0 shadow-lg backdrop-blur-md transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
      {children}
    </div>
  );
}

export function VaultPage() {
  const items = useVaultStore((state) => state.items);
  const cards = useVaultStore((state) => state.cards);
  const sshCredentials = useVaultStore((state) => state.sshCredentials);
  const identities = useVaultStore((state) => state.identities);
  const secrets = useVaultStore((state) => state.secrets);
  const error = useVaultStore((state) => state.error);
  const busy = useVaultStore((state) => state.busy);
  const copiedId = useVaultStore((state) => state.copiedId);
  const copyPassword = useVaultStore((state) => state.copyPassword);
  const deleteItems = useVaultStore((state) => state.deleteItems);
  const deleteCard = useVaultStore((state) => state.deleteCard);
  const copyCardSecret = useVaultStore((state) => state.copyCardSecret);
  const deleteSshCredential = useVaultStore((state) => state.deleteSshCredential);
  const deleteIdentity = useVaultStore((state) => state.deleteIdentity);
  const copySshSecret = useVaultStore((state) => state.copySshSecret);
  const deleteSecret = useVaultStore((state) => state.deleteSecret);
  const copySecretValue = useVaultStore((state) => state.copySecretValue);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [activeType, setActiveType] = useState<VaultItemTypeFilter>(readVaultItemTypeFilter);
  const [selectedKeys, setSelectedKeys] = useState<Set<VaultItemSelectionKey>>(() => new Set());
  const [pendingDeleteKeys, setPendingDeleteKeys] = useState<VaultItemSelectionKey[]>([]);
  const [installingSshKey, setInstallingSshKey] = useState<SshCredentialSummary | null>(null);
  const [visibleTotpId, setVisibleTotpId] = useState<string | null>(null);
  const [visiblePasswordId, setVisiblePasswordId] = useState<string | null>(null);
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, string>>({});
  const [totpCodes, setTotpCodes] = useState<Record<string, TotpCode>>({});
  const [totpErrorIds, setTotpErrorIds] = useState<Set<string>>(() => new Set());
  const [copyingTotpId, setCopyingTotpId] = useState<string | null>(null);
  const [protectedAction, setProtectedAction] = useState<ProtectedAction | null>(null);
  const [repromptPassword, setRepromptPassword] = useState('');
  const [repromptBusy, setRepromptBusy] = useState(false);
  const [showScrollToTop, setShowScrollToTop] = useState(false);
  const [cardVisualOffset] = useState(() => Math.floor(Math.random() * VAULT_CARD_VISUALS.length));
  const [services, setServices] = useState<ServiceSummary[]>([]);
  const [servicesLoaded, setServicesLoaded] = useState(false);
  const [selectedService, setSelectedService] = useState<ServiceSummary | null>(null);
  const [selectedServiceDetail, setSelectedServiceDetail] = useState<ServiceDetail | null>(null);
  const [serviceDetailBusy, setServiceDetailBusy] = useState(false);
  const serviceDetailRequestRef = useRef(0);

  useEffect(() => { writeVaultItemTypeFilter(activeType); }, [activeType]);

  useEffect(() => {
    let active = true;
    void window.vaultMesh.services.list()
      .then((nextServices) => { if (active) setServices(nextServices); })
      .catch(() => { if (active) toast.error('无法加载网站/服务。'); })
      .finally(() => { if (active) setServicesLoaded(true); });
    return () => {
      active = false;
      serviceDetailRequestRef.current += 1;
    };
  }, []);

  useEffect(() => window.vaultMesh.vault.onLocked(() => {
    serviceDetailRequestRef.current += 1;
    setServices([]);
    setSelectedService(null);
    setSelectedServiceDetail(null);
    setServiceDetailBusy(false);
  }), []);

  useEffect(() => {
    let lastScrollY = window.scrollY;

    const handleScroll = (): void => {
      const currentScrollY = Math.max(window.scrollY, 0);
      if (currentScrollY <= 8) {
        setShowScrollToTop(false);
      } else if (currentScrollY < lastScrollY) {
        setShowScrollToTop(true);
      } else if (currentScrollY > lastScrollY) {
        setShowScrollToTop(false);
      }
      lastScrollY = currentScrollY;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const filteredItems = useMemo(() => {
    const searchTerm = query.trim().toLocaleLowerCase();
    if (!searchTerm) return items;

    return items.filter((item) => [item.title, item.username, item.url, item.notes]
      .some((value) => value?.toLocaleLowerCase().includes(searchTerm)));
  }, [items, query]);

  const filteredCards = useMemo(() => {
    return cards.filter((card) => paymentCardMatchesSearch(card, query));
  }, [cards, query]);

  const filteredSsh = useMemo(() => {
    return sshCredentials.filter((item) => sshCredentialMatchesSearch(item, query));
  }, [sshCredentials, query]);
  const filteredIdentities = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return term ? identities.filter((item) => [item.title, item.displayName, item.organization, item.folder].some((value) => value?.toLocaleLowerCase().includes(term))) : identities;
  }, [identities, query]);
  const passkeys = useMemo(() => secrets.filter((item) => item.isPasskey), [secrets]);
  const filteredPasskeys = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return term ? passkeys.filter((item) => [item.title, item.account, item.website].some((value) => value?.toLocaleLowerCase().includes(term))) : passkeys;
  }, [passkeys, query]);
  const filteredSecrets = useMemo(() => secrets.filter((item) => !item.isPasskey && secretItemMatchesSearch(item, query)), [query, secrets]);
  const filteredServices = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return term
      ? services.filter((service) => [service.name, service.description, ...service.tags].some((value) => value?.toLocaleLowerCase().includes(term)))
      : services;
  }, [query, services]);
  const loginIds = useMemo(() => new Set(items.map((item) => item.id)), [items]);
  const passkeyCountByLogin = useMemo(() => {
    const counts = new Map<string, number>();
    for (const passkey of passkeys) if (passkey.loginId && loginIds.has(passkey.loginId)) counts.set(passkey.loginId, (counts.get(passkey.loginId) ?? 0) + 1);
    return counts;
  }, [loginIds, passkeys]);

  const visibleServices = isVaultItemTypeVisible(activeType, 'service') ? filteredServices : [];
  const visibleItems = isVaultItemTypeVisible(activeType, 'login') ? filteredItems : [];
  const visibleCards = isVaultItemTypeVisible(activeType, 'paymentCard') ? filteredCards : [];
  const visibleSsh = isVaultItemTypeVisible(activeType, 'sshCredential') ? filteredSsh : [];
  const visibleIdentities = isVaultItemTypeVisible(activeType, 'identity') ? filteredIdentities : [];
  const visibleSecrets = isVaultItemTypeVisible(activeType, 'secret') ? filteredSecrets : [];
  const standalonePasskeys = useMemo(() => filteredPasskeys.filter((item) => !item.loginId || !loginIds.has(item.loginId)), [filteredPasskeys, loginIds]);
  const visibleStandalonePasskeys = isVaultItemTypeVisible(activeType, 'login') ? standalonePasskeys : [];
  const visibleSelectionCount = visibleItems.length + visibleStandalonePasskeys.length + visibleCards.length + visibleSsh.length + visibleSecrets.length + visibleIdentities.length;
  const activeTypeLabel = VAULT_ITEM_TYPE_TABS.find((tab) => tab.id === activeType)?.label ?? '全部';
  const serviceItemLabels = useMemo(() => new Map<string, string>([
    ...items.map((item) => [`login:${item.id}`, item.title] as const),
    ...secrets.filter((item) => !item.isPasskey).map((item) => [`secret:${item.id}`, item.title] as const),
    ...sshCredentials.map((item) => [`ssh:${item.id}`, item.title] as const),
    ...identities.map((item) => [`identity:${item.id}`, item.title] as const),
  ]), [identities, items, secrets, sshCredentials]);
  useEffect(() => {
    const availableKeys = new Set<VaultItemSelectionKey>([
      ...items.map((item) => vaultItemSelectionKey('login', item.id)),
      ...cards.map((item) => vaultItemSelectionKey('paymentCard', item.id)),
      ...sshCredentials.map((item) => vaultItemSelectionKey('sshCredential', item.id)),
      ...secrets.map((item) => vaultItemSelectionKey('secret', item.id)),
      ...identities.map((item) => vaultItemSelectionKey('identity', item.id)),
    ]);
    setSelectedKeys((current) => {
      const next = new Set([...current].filter((key) => availableKeys.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [cards, identities, items, secrets, sshCredentials]);

  useEffect(() => {
    if (!visibleTotpId) return;

    const refreshTimer = window.setInterval(() => {
      setTotpCodes((current) => {
        const code = current[visibleTotpId];
        if (!code || code.remainingSeconds <= 1) { setVisibleTotpId(null); return current; }
        return { ...current, [visibleTotpId]: { ...code, remainingSeconds: code.remainingSeconds - 1 } };
      });
    }, 1_000);
    return () => {
      window.clearInterval(refreshTimer);
    };
  }, [visibleTotpId]);

  const selectedCount = selectedKeys.size;
  const everyVisibleItemSelected = (): boolean => visibleItems.every((item) => selectedKeys.has(vaultItemSelectionKey('login', item.id)))
    && visibleStandalonePasskeys.every((item) => selectedKeys.has(vaultItemSelectionKey('secret', item.id)))
    && visibleCards.every((item) => selectedKeys.has(vaultItemSelectionKey('paymentCard', item.id)))
    && visibleSsh.every((item) => selectedKeys.has(vaultItemSelectionKey('sshCredential', item.id)))
    && visibleSecrets.every((item) => selectedKeys.has(vaultItemSelectionKey('secret', item.id)))
    && visibleIdentities.every((item) => selectedKeys.has(vaultItemSelectionKey('identity', item.id)));
  const allFilteredSelected = visibleSelectionCount > 0 && selectedKeys.size >= visibleSelectionCount && everyVisibleItemSelected();
  const pendingPermanentDeleteCount = pendingDeleteKeys.filter((key) => parseVaultItemSelectionKey(key).kind === 'secret').length;

  const copy = async (item: LoginItemSummary, masterPassword?: string): Promise<boolean> => {
    if (item.masterPasswordReprompt && !masterPassword) { setProtectedAction({ kind: 'copyPassword', id: item.id }); return false; }
    if (await copyPassword(item.id, masterPassword)) {
      toast.success('密码已复制到剪贴板。');
      return true;
    }
    return false;
  };

  const copyUsername = async (item: LoginItemSummary): Promise<void> => {
    try {
      await window.vaultMesh.items.copyUsername(item.id);
      toast.success('用户名已复制到剪贴板。');
    } catch { toast.error('无法复制用户名。'); }
  };

  const showPassword = async (item: LoginItemSummary, masterPassword?: string): Promise<boolean> => {
    if (item.masterPasswordReprompt && !masterPassword) { setProtectedAction({ kind: 'showPassword', id: item.id }); return false; }
    try {
      const { password } = await window.vaultMesh.items.revealPassword(item.id, masterPassword);
      setRevealedPasswords((current) => ({ ...current, [item.id]: password }));
      setVisiblePasswordId(item.id);
      window.setTimeout(() => {
        setVisiblePasswordId((current) => current === item.id ? null : current);
        setRevealedPasswords((current) => {
          const { [item.id]: _, ...remaining } = current;
          return remaining;
        });
      }, 30_000);
      return true;
    } catch { toast.error('无法显示密码。'); return false; }
  };

  const togglePassword = (item: LoginItemSummary): void => {
    if (visiblePasswordId === item.id) {
      setVisiblePasswordId(null);
      setRevealedPasswords((current) => { const { [item.id]: _, ...remaining } = current; return remaining; });
      return;
    }
    void showPassword(item);
  };

  const removePendingItems = async (): Promise<void> => {
    if (pendingDeleteKeys.length === 0) return;
    const selections = pendingDeleteKeys.map(parseVaultItemSelectionKey);
    const deletedKeys = new Set<VaultItemSelectionKey>();
    const loginSelections = selections.filter((selection) => selection.kind === 'login');
    if (loginSelections.length > 0 && await deleteItems(loginSelections.map((selection) => selection.id))) {
      loginSelections.forEach((selection) => deletedKeys.add(vaultItemSelectionKey(selection.kind, selection.id)));
    }
    for (const selection of selections.filter((candidate) => candidate.kind !== 'login')) {
      const deleted = selection.kind === 'paymentCard' ? await deleteCard(selection.id)
        : selection.kind === 'sshCredential' ? await deleteSshCredential(selection.id)
          : selection.kind === 'identity' ? await deleteIdentity(selection.id)
            : await deleteSecret(selection.id);
      if (deleted) deletedKeys.add(vaultItemSelectionKey(selection.kind, selection.id));
    }
    setSelectedKeys((current) => {
      const next = new Set(current);
      deletedKeys.forEach((key) => next.delete(key));
      return next;
    });
    setPendingDeleteKeys([]);
    if (deletedKeys.size === pendingDeleteKeys.length) {
      toast.success(pendingDeleteKeys.length === 1 ? '项目已删除。' : `已删除 ${pendingDeleteKeys.length} 个项目。`);
    } else if (deletedKeys.size > 0) {
      toast.warning(`已删除 ${deletedKeys.size} 个项目，${pendingDeleteKeys.length - deletedKeys.size} 个项目删除失败。`);
    }
  };

  const toggleSelection = (key: VaultItemSelectionKey): void => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectAllFiltered = (): void => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      const updateSelection = (key: VaultItemSelectionKey): void => { if (allFilteredSelected) next.delete(key); else next.add(key); };
      visibleItems.forEach((item) => updateSelection(vaultItemSelectionKey('login', item.id)));
      visibleStandalonePasskeys.forEach((item) => updateSelection(vaultItemSelectionKey('secret', item.id)));
      visibleCards.forEach((item) => updateSelection(vaultItemSelectionKey('paymentCard', item.id)));
      visibleSsh.forEach((item) => updateSelection(vaultItemSelectionKey('sshCredential', item.id)));
      visibleSecrets.forEach((item) => updateSelection(vaultItemSelectionKey('secret', item.id)));
      visibleIdentities.forEach((item) => updateSelection(vaultItemSelectionKey('identity', item.id)));
      return next;
    });
  };

  const showTotp = async (id: string, masterPassword?: string): Promise<boolean> => {
    try {
      const code = await window.vaultMesh.items.totpCode(id, masterPassword);
      setTotpCodes((current) => ({ ...current, [id]: code }));
      setTotpErrorIds((current) => { const next = new Set(current); next.delete(id); return next; });
      setVisibleTotpId(id);
      return true;
    } catch { setTotpErrorIds((current) => new Set(current).add(id)); toast.error('无法读取验证码。'); return false; }
  };

  const toggleTotp = (item: LoginItemSummary): void => {
    if (visibleTotpId === item.id) { setVisibleTotpId(null); return; }
    if (item.masterPasswordReprompt) { setProtectedAction({ kind: 'showTotp', id: item.id }); return; }
    void showTotp(item.id);
  };

  const copyTotp = async (item: LoginItemSummary, masterPassword?: string): Promise<boolean> => {
    if (item.masterPasswordReprompt && !masterPassword) { setProtectedAction({ kind: 'copyTotp', id: item.id }); return false; }
    setCopyingTotpId(item.id);
    try {
      await window.vaultMesh.items.copyTotp(item.id, masterPassword);
      toast.success('验证码已复制到剪贴板。');
      return true;
    } catch {
      toast.error('无法复制验证码。');
      return false;
    } finally {
      setCopyingTotpId((current) => current === item.id ? null : current);
    }
  };

  const copyCard = async (item: PaymentCardSummary, kind: 'number' | 'securityCode' | 'pin', masterPassword?: string): Promise<boolean> => {
    if (item.masterPasswordReprompt && !masterPassword) {
      setProtectedAction({ kind: kind === 'number' ? 'cardNumber' : kind === 'securityCode' ? 'cardSecurityCode' : 'cardPin', id: item.id });
      return false;
    }
    if (await copyCardSecret(item.id, kind, masterPassword)) {
      toast.success(kind === 'number' ? '卡号已复制到剪贴板。' : kind === 'securityCode' ? '安全码已复制到剪贴板。' : 'PIN 已复制到剪贴板。');
      return true;
    }
    return false;
  };

  const copySsh = async (item: SshCredentialSummary, kind: 'password' | 'publicKey' | 'privateKey' | 'keyPassphrase', masterPassword?: string): Promise<boolean> => {
    if (kind !== 'publicKey' && item.masterPasswordReprompt && !masterPassword) {
      setProtectedAction({ kind: kind === 'password' ? 'sshPassword' : kind === 'privateKey' ? 'sshPrivateKey' : 'sshPassphrase', id: item.id });
      return false;
    }
    if (await copySshSecret(item.id, kind, masterPassword)) {
      toast.success(kind === 'password' ? 'SSH 密码已复制。' : kind === 'publicKey' ? 'SSH 公钥已复制。' : kind === 'privateKey' ? 'SSH 私钥已复制。' : '私钥口令已复制。');
      return true;
    }
    return false;
  };

  const copySecret = async (item: SecretItemSummary, masterPassword?: string): Promise<boolean> => {
    if (item.masterPasswordReprompt && !masterPassword) {
      setProtectedAction({ kind: 'secretValue', id: item.id });
      return false;
    }
    if (await copySecretValue(item.id, masterPassword)) {
      toast.success('密钥已复制到剪贴板。');
      return true;
    }
    return false;
  };

  const confirmReprompt = async (): Promise<void> => {
    if (!protectedAction) return;
    const item = items.find((candidate) => candidate.id === protectedAction.id);
    const card = cards.find((candidate) => candidate.id === protectedAction.id);
    const ssh = sshCredentials.find((candidate) => candidate.id === protectedAction.id);
    const secret = secrets.find((candidate) => candidate.id === protectedAction.id);
    if (!item && !card && !ssh && !secret) return;
    setRepromptBusy(true);
    try {
      const succeeded = protectedAction.kind === 'copyPassword' && item ? await copy(item, repromptPassword)
        : protectedAction.kind === 'showPassword' && item ? await showPassword(item, repromptPassword)
        : protectedAction.kind === 'showTotp' && item ? await showTotp(item.id, repromptPassword)
          : protectedAction.kind === 'copyTotp' && item ? await copyTotp(item, repromptPassword)
            : card ? await copyCard(card, protectedAction.kind === 'cardNumber' ? 'number' : protectedAction.kind === 'cardSecurityCode' ? 'securityCode' : 'pin', repromptPassword)
              : ssh ? await copySsh(ssh, protectedAction.kind === 'sshPassword' ? 'password' : protectedAction.kind === 'sshPrivateKey' ? 'privateKey' : 'keyPassphrase', repromptPassword)
                : secret ? await copySecret(secret, repromptPassword) : false;
      if (succeeded) setProtectedAction(null);
    } finally {
      setRepromptPassword('');
      setRepromptBusy(false);
    }
  };

  const closeServiceDetail = (): void => {
    serviceDetailRequestRef.current += 1;
    setSelectedService(null);
    setSelectedServiceDetail(null);
    setServiceDetailBusy(false);
  };

  const openServiceDetail = (service: ServiceSummary): void => {
    const requestId = serviceDetailRequestRef.current + 1;
    serviceDetailRequestRef.current = requestId;
    setSelectedService(service);
    setSelectedServiceDetail(null);
    setServiceDetailBusy(true);
    void window.vaultMesh.services.detail(service.id)
      .then((detail) => {
        if (serviceDetailRequestRef.current === requestId) setSelectedServiceDetail(detail);
      })
      .catch(() => {
        if (serviceDetailRequestRef.current === requestId) toast.error('无法加载网站/服务详情。');
      })
      .finally(() => {
        if (serviceDetailRequestRef.current === requestId) setServiceDetailBusy(false);
      });
  };

  const goToServiceItem = (relationship: ServiceRelationship): void => {
    closeServiceDetail();
    if (relationship.itemKind === 'login') void navigate({ to: '/vault/items/$itemId', params: { itemId: relationship.itemId } });
    else if (relationship.itemKind === 'secret') void navigate({ to: '/vault/secrets/$secretId', params: { secretId: relationship.itemId } });
    else if (relationship.itemKind === 'ssh') void navigate({ to: '/vault/ssh/$sshId', params: { sshId: relationship.itemId } });
    else void navigate({ to: '/vault/identities/$identityId', params: { identityId: relationship.itemId } });
  };

  const selectedServiceGroups = (Object.keys(serviceGroupLabels) as ServiceItemKind[])
    .map((kind) => ({
      kind,
      relationships: selectedServiceDetail?.relationships.filter((relationship) => relationship.itemKind === kind) ?? [],
    }))
    .filter((group) => group.relationships.length > 0);

  return (
    <section className="mx-auto w-full max-w-6xl px-5 pt-5 pb-10">
      <div className="flex flex-col gap-5">
        <ErrorBanner message={error} />
      {servicesLoaded && services.length === 0 && items.length === 0 && cards.length === 0 && sshCredentials.length === 0 && identities.length === 0 && secrets.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><KeyRoundIcon /></EmptyMedia>
            <EmptyTitle>保险库为空</EmptyTitle>
            <EmptyDescription>添加登录信息、支付卡、SSH 凭据或开发者密钥。秘密字段不会显示在此列表中。</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <AddItemMenu />
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex shrink-0 gap-1 overflow-x-auto rounded-lg border bg-muted/40 p-1" role="tablist" aria-label="保险库项目类型">
              {VAULT_ITEM_TYPE_TABS.map((tab) => <Button
                key={tab.id}
                role="tab"
                aria-selected={activeType === tab.id}
                variant={activeType === tab.id ? 'default' : 'ghost'}
                size="sm"
                type="button"
                className="shrink-0"
                onClick={() => setActiveType(tab.id)}
              >{tab.label}</Button>)}
            </div>
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                className="pl-9 pr-9"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索网站/服务、登录信息、支付卡、SSH 凭据、密钥或备注"
                aria-label="搜索保险库"
              />
              {query && (
                <Button className="absolute top-1/2 right-1 -translate-y-1/2" variant="ghost" size="icon-xs" type="button" aria-label="清除搜索" onClick={() => setQuery('')}>
                  <XIcon />
                </Button>
              )}
            </div>
            {activeType !== 'service' && <Button variant="outline" type="button" disabled={visibleSelectionCount === 0} onClick={toggleSelectAllFiltered}>
              {allFilteredSelected ? '取消全选' : '全选结果'}
            </Button>}
          </div>
          {selectedCount > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2">
              <span className="text-sm font-medium">已选择 {selectedCount} 个项目</span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" type="button" onClick={() => setSelectedKeys(new Set())}>取消选择</Button>
                <Button variant="destructive" size="sm" type="button" disabled={busy} onClick={() => setPendingDeleteKeys([...selectedKeys])}>
                  <Trash2Icon data-icon="inline-start" />
                  删除所选
                </Button>
              </div>
            </div>
          )}
          {visibleServices.length === 0 && visibleItems.length === 0 && visibleStandalonePasskeys.length === 0 && visibleCards.length === 0 && visibleSsh.length === 0 && visibleIdentities.length === 0 && visibleSecrets.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon"><SearchIcon /></EmptyMedia>
                <EmptyTitle>{query.trim() ? '没有找到匹配的保险库项目' : `${activeTypeLabel}暂无项目`}</EmptyTitle>
                <EmptyDescription>{query.trim() ? `当前“${activeTypeLabel}”分类中没有匹配结果，请尝试其他关键词。` : `切换其他类型，或添加新的${activeTypeLabel === '全部' ? '保险库项目' : activeTypeLabel}。`}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {query.trim()
                  ? <Button variant="outline" type="button" onClick={() => setQuery('')}>清除搜索</Button>
                  : activeType === 'service'
                    ? <Button variant="outline" type="button" onClick={() => void navigate({ to: '/vault/services' })}>管理网站/服务</Button>
                    : <AddItemMenu variant="outline" />}
              </EmptyContent>
            </Empty>
          ) : (
            <VirtualizedVaultGrid layoutKey={`${activeType}:${query}:${visibleServices.length}:${visibleItems.length}:${visibleStandalonePasskeys.length}:${visibleCards.length}:${visibleSsh.length}:${visibleSecrets.length}:${visibleIdentities.length}`} sections={[
              {
                itemCount: visibleServices.length,
                getItemKey: (index) => `service-${visibleServices[index]?.id ?? index}`,
                renderItem: (index) => {
                  const service = visibleServices[index];
                  if (!service) return null;
                  const visual = vaultCardVisualFor(service.id, cardVisualOffset);
                  const itemCount = service.counts.login + service.counts.secret + service.counts.ssh + service.counts.identity;
                  return (
                    <Card className={cn('relative aspect-[1.72/1] min-h-0 cursor-pointer text-white shadow-lg shadow-black/15 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/20', visual.surface)}>
                      <span className={cn('pointer-events-none absolute inset-0', visual.pattern)} aria-hidden="true" />
                      <span className="pointer-events-none absolute -right-10 -bottom-20 size-48 rounded-full border border-white/10" aria-hidden="true" />
                      <button className="absolute inset-0 z-10 rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" type="button" aria-label={`查看网站/服务：${service.name}`} onClick={() => openServiceDetail(service)} />
                      <CardHeader className="pointer-events-none relative">
                        <BoxesIcon className="size-8 stroke-[1.5] text-white/75" aria-hidden="true" />
                        <CardTitle className="truncate text-xl font-black tracking-tight text-white/95">{service.name}</CardTitle>
                        <CardDescription className="line-clamp-2 text-white/65">{service.description ?? '网站与服务关联内容'}</CardDescription>
                      </CardHeader>
                      <CardContent className="pointer-events-none relative mt-auto grid grid-cols-2 gap-4">
                        <div><p className="text-[0.6rem] font-medium tracking-[0.16em] text-white/50 uppercase">站点</p><p className="mt-0.5 text-sm font-semibold text-white/90">{service.siteCount}</p></div>
                        <div className="text-right"><p className="text-[0.6rem] font-medium tracking-[0.16em] text-white/50 uppercase">关联项目</p><p className="mt-0.5 text-sm font-semibold text-white/90">{itemCount}</p></div>
                      </CardContent>
                    </Card>
                  );
                },
              },
              {
                itemCount: visibleItems.length,
                getItemKey: (index) => `login-${visibleItems[index]?.id ?? index}`,
                renderItem: (index) => {
                const item = visibleItems[index];
                if (!item) return null;
                const visual = vaultCardVisualFor(item.id, cardVisualOffset);
                const selectionKey = vaultItemSelectionKey('login', item.id);
                return (
                  <article
                    key={item.id}
                    data-card-visual={visual.name}
                    className={cn(
                      'group relative flex aspect-[1.72/1] min-h-0 flex-col overflow-hidden rounded-2xl border p-4 text-white shadow-lg shadow-black/15 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/25',
                      'after:pointer-events-none after:absolute after:inset-0 after:bg-[linear-gradient(120deg,transparent_30%,rgb(255_255_255_/_0.06)_48%,transparent_66%)]',
                      visual.surface,
                      selectedKeys.has(selectionKey) && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
                    )}
                    aria-label={`登录信息：${item.title}`}
                  >
                  <span className={cn('pointer-events-none absolute inset-0', visual.pattern)} aria-hidden="true" />
                  <span className="pointer-events-none absolute -right-10 -bottom-20 size-48 rounded-full border border-white/10" aria-hidden="true" />
                  <div className="relative z-10 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <KeyRoundIcon className="size-8 stroke-[1.5] text-white/75" aria-hidden="true" />
                      <h2 className="mt-1 max-w-36 truncate text-xs font-medium tracking-wide text-white/65">{item.url ? displayDomain(item.url) : item.title}</h2>
                    </div>
                    <div className="flex shrink-0 items-start gap-2"><span className="text-lg font-black tracking-tight text-white/90 italic uppercase">LOGIN</span><VaultSelectionControl checked={selectedKeys.has(selectionKey)} label={`选择 ${item.title}`} onChange={() => toggleSelection(selectionKey)} /></div>
                  </div>

                  <p className="relative z-10 mt-3 truncate font-mono text-lg font-medium tracking-[0.16em] text-white/95">{visiblePasswordId === item.id ? revealedPasswords[item.id] : '•••• •••• ••••'}</p>

                  <div className="relative z-10 mt-auto grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4">
                    <div className="min-w-0"><p className="text-[0.6rem] font-medium tracking-[0.16em] text-white/50 uppercase">用户名</p><p className="mt-0.5 truncate text-sm font-medium text-white/90">{item.username || '未填写用户名'}</p></div>
                    <div className="text-right"><p className="text-[0.6rem] font-medium tracking-[0.16em] text-white/50 uppercase">{item.hasTotpSecret ? '验证码' : '状态'}</p><p className="mt-0.5 truncate font-mono text-sm font-semibold text-white/90">{item.hasTotpSecret ? totpErrorIds.has(item.id) ? '无法生成' : visibleTotpId === item.id ? totpCodes[item.id]?.code ?? '------' : '••• •••' : (passkeyCountByLogin.get(item.id) ?? 0) > 0 ? `${passkeyCountByLogin.get(item.id)} Passkey` : copiedId === item.id ? '已复制' : '已保护'}</p></div>
                  </div>

                  <VaultCardActionBar>
                    <Button className={vaultCardActionClassName} variant="ghost" size="icon-sm" type="button" aria-label="复制用户名" title="复制用户名" onClick={() => void copyUsername(item)}><ContactIcon /></Button>
                    <Button className={vaultCardActionClassName} variant="ghost" size="icon-sm" type="button" aria-label={visiblePasswordId === item.id ? '隐藏密码' : '显示密码'} onClick={() => togglePassword(item)}>{visiblePasswordId === item.id ? <EyeOffIcon /> : <EyeIcon />}</Button>
                    <Button className={vaultCardActionClassName} variant="ghost" size="icon-sm" type="button" aria-label="复制密码" disabled={busy} onClick={() => void copy(item)}><CopyIcon /></Button>
                    {item.hasTotpSecret && <Button className={vaultCardActionClassName} variant="ghost" size="icon-sm" type="button" aria-label={visibleTotpId === item.id ? '隐藏验证码' : '显示验证码'} onClick={() => toggleTotp(item)}>{visibleTotpId === item.id ? <EyeOffIcon /> : <FingerprintIcon />}</Button>}
                    {item.hasTotpSecret && <Button className={vaultCardActionClassName} variant="ghost" size="icon-sm" type="button" aria-label="复制验证码" disabled={copyingTotpId === item.id} onClick={() => void copyTotp(item)}><CopyIcon /></Button>}
                    <Button className={vaultCardActionClassName} variant="ghost" size="icon-sm" type="button" aria-label="编辑登录信息" onClick={() => void navigate({ to: '/vault/items/$itemId', params: { itemId: item.id } })}><PencilIcon /></Button>
                    <Button className="text-rose-200 hover:bg-rose-400/20 hover:text-rose-100" variant="ghost" size="icon-sm" type="button" aria-label="删除登录信息" disabled={busy} onClick={() => setPendingDeleteKeys([selectionKey])}><Trash2Icon /></Button>
                  </VaultCardActionBar>

                  </article>
                );
              } },
              {
                itemCount: visibleStandalonePasskeys.length,
                getItemKey: (index) => `passkey-${visibleStandalonePasskeys[index]?.id ?? index}`,
                renderItem: (index) => {
                const passkey = visibleStandalonePasskeys[index];
                if (!passkey) return null;
                const visual = vaultCardVisualFor(passkey.id, cardVisualOffset);
                const selectionKey = vaultItemSelectionKey('secret', passkey.id);
                return (
                  <article key={passkey.id} className={cn('group relative flex aspect-[1.72/1] min-h-0 flex-col overflow-hidden rounded-2xl border p-4 text-white shadow-lg shadow-black/15 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl', visual.surface, selectedKeys.has(selectionKey) && 'ring-2 ring-primary ring-offset-2 ring-offset-background')} aria-label={`Passkey：${passkey.title}`}>
                    <span className={cn('pointer-events-none absolute inset-0', visual.pattern)} aria-hidden="true" />
                    <div className="relative z-10 flex items-start justify-between gap-3"><div className="min-w-0"><FingerprintIcon className="size-8 stroke-[1.5] text-white/75" aria-hidden="true" /><h2 className="mt-1 max-w-36 truncate text-xs font-medium tracking-wide text-white/65">{passkey.title}</h2></div><div className="flex shrink-0 items-start gap-2"><span className="text-lg font-black tracking-tight text-white/90 italic uppercase">PASSKEY</span><VaultSelectionControl checked={selectedKeys.has(selectionKey)} label={`选择 ${passkey.title}`} onChange={() => toggleSelection(selectionKey)} /></div></div>
                    <p className="relative z-10 mt-3 truncate font-mono text-lg font-medium tracking-wide text-white/95">{passkey.website ? displayDomain(passkey.website) : '未知网站'}</p>
                    <div className="relative z-10 mt-auto grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4"><div className="min-w-0"><p className="text-[0.6rem] font-medium tracking-[0.16em] text-white/50 uppercase">用户名</p><p className="mt-0.5 truncate text-sm font-medium text-white/90">{passkey.account ?? '未提供账号'}</p></div><div className="text-right"><p className="text-[0.6rem] font-medium tracking-[0.16em] text-white/50 uppercase">私钥</p><p className="mt-0.5 text-sm font-semibold text-white/90">已保护</p></div></div>
                    <VaultCardActionBar><Button className="text-rose-200 hover:bg-rose-400/20 hover:text-rose-100" variant="ghost" size="icon-sm" type="button" aria-label="删除 Passkey" disabled={busy} onClick={() => setPendingDeleteKeys([selectionKey])}><Trash2Icon /></Button></VaultCardActionBar>
                  </article>
                );
              } },
              {
                itemCount: visibleCards.length,
                getItemKey: (index) => `card-${visibleCards[index]?.id ?? index}`,
                renderItem: (index) => {
                const card = visibleCards[index];
                if (!card) return null;
                const visual = vaultCardVisualFor(card.id, cardVisualOffset);
                const selectionKey = vaultItemSelectionKey('paymentCard', card.id);
                return (
                  <article
                    key={card.id}
                    data-card-visual={visual.name}
                    className={cn(
                      'group relative flex aspect-[1.72/1] min-h-0 flex-col overflow-hidden rounded-2xl border p-4 text-white shadow-lg shadow-black/15 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/20',
                      visual.surface,
                      selectedKeys.has(selectionKey) && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
                    )}
                    aria-label={`支付卡：${card.title}`}
                  >
                    <span className={cn('pointer-events-none absolute inset-0', visual.pattern)} aria-hidden="true" />
                    <span className="pointer-events-none absolute -right-10 -bottom-20 size-48 rounded-full border border-white/10" aria-hidden="true" />
                    <span className="pointer-events-none absolute -right-2 -bottom-12 size-32 rounded-full border border-white/10" aria-hidden="true" />

                    <div className="relative z-10 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <CpuIcon className="size-9 stroke-[1.5] text-white/75" aria-hidden="true" />
                        <h2 className="mt-1 max-w-32 truncate text-[0.65rem] font-medium tracking-[0.12em] text-white/60 uppercase">{card.title}</h2>
                      </div>
                      <div className="flex shrink-0 items-start gap-2">
                        <span className="max-w-24 truncate text-right text-xl font-black tracking-tight text-white/90 italic uppercase">{card.network ?? card.issuer ?? 'CARD'}</span>
                        <VaultSelectionControl checked={selectedKeys.has(selectionKey)} label={`选择 ${card.title}`} onChange={() => toggleSelection(selectionKey)} />
                      </div>
                    </div>

                    <p className="relative z-10 mt-4 truncate font-mono text-lg font-medium tracking-[0.16em] text-white/95">{card.maskedNumber}</p>

                    <div className="relative z-10 mt-auto grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4">
                      <div className="min-w-0"><p className="text-[0.6rem] font-medium tracking-[0.16em] text-white/50 uppercase">持卡人</p><p className="mt-0.5 truncate text-sm font-medium text-white/90">{card.cardholderName}</p></div>
                      <div><p className="text-[0.6rem] font-medium tracking-[0.16em] text-white/50 uppercase">有效期</p><p className="mt-0.5 text-sm font-semibold text-white/90">{formatCardExpiration(card.expirationMonth, card.expirationYear)}</p></div>
                    </div>

                    <VaultCardActionBar>
                      <Button className={vaultCardActionClassName} variant="ghost" size="icon-sm" type="button" aria-label="复制卡号" title="复制卡号" disabled={busy} onClick={() => void copyCard(card, 'number')}><CopyIcon /></Button>
                      {card.hasSecurityCode && <Button className={vaultCardActionClassName} variant="ghost" size="icon-sm" type="button" aria-label="复制安全码" title="复制安全码" disabled={busy} onClick={() => void copyCard(card, 'securityCode')}><ShieldCheckIcon /></Button>}
                      {card.hasPin && <Button className={vaultCardActionClassName} variant="ghost" size="icon-sm" type="button" aria-label="复制 PIN" title="复制 PIN" disabled={busy} onClick={() => void copyCard(card, 'pin')}><KeyRoundIcon /></Button>}
                      <Button className={vaultCardActionClassName} variant="ghost" size="icon-sm" type="button" aria-label="编辑支付卡" onClick={() => void navigate({ to: '/vault/cards/$cardId', params: { cardId: card.id } })}><PencilIcon /></Button>
                      <Button className="text-rose-200 hover:bg-rose-400/20 hover:text-rose-100" variant="ghost" size="icon-sm" type="button" aria-label="删除支付卡" disabled={busy} onClick={() => setPendingDeleteKeys([selectionKey])}><Trash2Icon /></Button>
                    </VaultCardActionBar>
                  </article>
                );
              } },
              {
                itemCount: visibleSsh.length,
                getItemKey: (index) => `ssh-${visibleSsh[index]?.id ?? index}`,
                renderItem: (index) => {
                const ssh = visibleSsh[index];
                if (!ssh) return null;
                const visual = vaultCardVisualFor(ssh.id, cardVisualOffset);
                const selectionKey = vaultItemSelectionKey('sshCredential', ssh.id);
                const sshPrimaryValue = ssh.recordKind === 'account'
                  ? formatSshEndpoint(ssh)
                  : ssh.managedSshAlias ? `ssh ${ssh.managedSshAlias}` : ssh.publicKeyFingerprint ?? 'SSH 公钥';
                return (
                  <article key={ssh.id} data-card-visual={visual.name} className={cn('group relative flex aspect-[1.72/1] min-h-0 flex-col overflow-hidden rounded-2xl border p-4 text-white shadow-lg shadow-black/15 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/20', visual.surface, selectedKeys.has(selectionKey) && 'ring-2 ring-primary ring-offset-2 ring-offset-background')} aria-label={`SSH 凭据：${ssh.title}`}>
                    <span className={cn('pointer-events-none absolute inset-0', visual.pattern)} aria-hidden="true" />
                    <span className="pointer-events-none absolute -right-10 -bottom-20 size-48 rounded-full border border-white/10" aria-hidden="true" />
                    <div className="relative z-10 flex items-start justify-between gap-3"><div className="min-w-0"><TerminalIcon className="size-8 stroke-[1.5] text-white/75" aria-hidden="true" /><h2 className="mt-1 max-w-36 truncate text-xs font-medium tracking-wide text-white/65">{ssh.title}</h2></div><div className="flex shrink-0 items-start gap-2"><span className="text-lg font-black tracking-tight text-white/90 italic uppercase">SSH</span><VaultSelectionControl checked={selectedKeys.has(selectionKey)} label={`选择 ${ssh.title}`} onChange={() => toggleSelection(selectionKey)} /></div></div>
                    <p className="relative z-10 mt-3 truncate font-mono text-base font-medium tracking-wide text-white/95">{sshPrimaryValue}</p>
                    <div className="relative z-10 mt-auto grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4"><div className="min-w-0"><p className="text-[0.6rem] font-medium tracking-[0.16em] text-white/50 uppercase">类型</p><p className="mt-0.5 truncate text-sm font-medium text-white/90">{ssh.recordKind === 'account' ? 'SSH 账号' : ssh.keyAlgorithm ?? 'SSH 密钥'}</p></div><div className="text-right"><p className="text-[0.6rem] font-medium tracking-[0.16em] text-white/50 uppercase">认证</p><p className="mt-0.5 text-sm font-semibold text-white/90">{ssh.hasPassword ? '密码' : ssh.hasPrivateKey ? '私钥' : copiedId === ssh.id ? '已复制' : '已保护'}</p></div></div>
                    <VaultCardActionBar>
                      <Button className={vaultCardActionClassName} variant="ghost" size="icon-sm" type="button" aria-label={ssh.recordKind === 'key' ? '将此公钥安装到服务器' : '选择密钥并安装到服务器'} title={ssh.recordKind === 'key' ? '将此公钥安装到服务器' : '选择密钥并安装到服务器'} disabled={busy} onClick={() => setInstallingSshKey(ssh)}><UploadIcon /></Button>
                      {ssh.host && ssh.username && <SshExternalLauncher account={ssh} />}
                      {ssh.hasPassword && <Button className={vaultCardActionClassName} variant="ghost" size="icon-sm" type="button" aria-label="复制 SSH 密码" title="复制 SSH 密码" disabled={busy} onClick={() => void copySsh(ssh, 'password')}><KeyRoundIcon /></Button>}
                      {ssh.recordKind === 'key' && ssh.hasPublicKey && <Button className={vaultCardActionClassName} variant="ghost" size="icon-sm" type="button" aria-label="复制 SSH 公钥" title="复制 SSH 公钥" disabled={busy} onClick={() => void copySsh(ssh, 'publicKey')}><CopyIcon /></Button>}
                      {ssh.recordKind === 'key' && ssh.hasPrivateKey && <Button className={vaultCardActionClassName} variant="ghost" size="icon-sm" type="button" aria-label="复制 SSH 私钥" title="复制 SSH 私钥" disabled={busy} onClick={() => void copySsh(ssh, 'privateKey')}><FileKeyIcon /></Button>}
                      {ssh.recordKind === 'key' && ssh.hasKeyPassphrase && <Button className={vaultCardActionClassName} variant="ghost" size="icon-sm" type="button" aria-label="复制私钥口令" title="复制私钥口令" disabled={busy} onClick={() => void copySsh(ssh, 'keyPassphrase')}><ShieldCheckIcon /></Button>}
                      <Button className={vaultCardActionClassName} variant="ghost" size="icon-sm" type="button" aria-label="编辑 SSH 凭据" onClick={() => void navigate({ to: '/vault/ssh/$sshId', params: { sshId: ssh.id } })}><PencilIcon /></Button>
                      <Button className="text-rose-200 hover:bg-rose-400/20 hover:text-rose-100" variant="ghost" size="icon-sm" type="button" aria-label="删除 SSH 凭据" disabled={busy} onClick={() => setPendingDeleteKeys([selectionKey])}><Trash2Icon /></Button>
                    </VaultCardActionBar>
                  </article>
                );
              } },
              {
                itemCount: visibleSecrets.length,
                getItemKey: (index) => `secret-${visibleSecrets[index]?.id ?? index}`,
                renderItem: (index) => {
                const secret = visibleSecrets[index];
                if (!secret) return null;
                const visual = vaultCardVisualFor(secret.id, cardVisualOffset);
                const selectionKey = vaultItemSelectionKey('secret', secret.id);
                return (
                  <article key={secret.id} data-card-visual={visual.name} className={cn('group relative flex aspect-[1.72/1] min-h-0 flex-col overflow-hidden rounded-2xl border p-4 text-white shadow-lg shadow-black/15 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/20', visual.surface, selectedKeys.has(selectionKey) && 'ring-2 ring-primary ring-offset-2 ring-offset-background')} aria-label={`机密信息：${secret.title}`}>
                    <span className={cn('pointer-events-none absolute inset-0', visual.pattern)} aria-hidden="true" />
                    <span className="pointer-events-none absolute -right-10 -bottom-20 size-48 rounded-full border border-white/10" aria-hidden="true" />
                    <div className="relative z-10 flex items-start justify-between gap-3"><div className="min-w-0"><BracesIcon className="size-8 stroke-[1.5] text-white/75" aria-hidden="true" /><h2 className="mt-1 max-w-36 truncate text-xs font-medium tracking-wide text-white/65">{secretItemDisplayTitle(secret)}</h2></div><div className="flex shrink-0 items-start gap-2"><span className="max-w-24 truncate text-right text-sm font-black tracking-tight text-white/90 italic uppercase">{secretItemKindLabel(secret.kind)}</span><VaultSelectionControl checked={selectedKeys.has(selectionKey)} label={`选择 ${secret.title}`} onChange={() => toggleSelection(selectionKey)} /></div></div>
                    <p className="relative z-10 mt-3 truncate font-mono text-lg font-medium tracking-[0.16em] text-white/95">•••• •••• ••••</p>
                    <div className="relative z-10 mt-auto grid grid-cols-2 items-end gap-4"><div className="min-w-0"><p className="text-[0.6rem] font-medium tracking-[0.16em] text-white/50 uppercase">服务商</p><p className="mt-0.5 truncate text-sm font-medium text-white/90">{secret.provider ?? '—'}</p></div><div className="min-w-0 text-right"><p className="text-[0.6rem] font-medium tracking-[0.16em] text-white/50 uppercase">账号或项目</p><p className="mt-0.5 truncate text-sm font-semibold text-white/90">{secret.account ?? secret.environment ?? (copiedId === secret.id ? '已复制' : '已保护')}</p></div></div>
                    <VaultCardActionBar><Button className={vaultCardActionClassName} variant="ghost" size="icon-sm" type="button" aria-label="复制内容" title="复制内容" disabled={busy} onClick={() => void copySecret(secret)}><CopyIcon /></Button><Button className={vaultCardActionClassName} variant="ghost" size="icon-sm" type="button" aria-label="编辑机密信息" onClick={() => void navigate({ to: '/vault/secrets/$secretId', params: { secretId: secret.id } })}><PencilIcon /></Button><Button className="text-rose-200 hover:bg-rose-400/20 hover:text-rose-100" variant="ghost" size="icon-sm" type="button" aria-label="删除机密信息" disabled={busy} onClick={() => setPendingDeleteKeys([selectionKey])}><Trash2Icon /></Button></VaultCardActionBar>
                  </article>
                );
              } },
              {
                itemCount: visibleIdentities.length,
                getItemKey: (index) => `identity-${visibleIdentities[index]?.id ?? index}`,
                renderItem: (index) => {
                const identity = visibleIdentities[index];
                if (!identity) return null;
                const visual = vaultCardVisualFor(identity.id, cardVisualOffset);
                const selectionKey = vaultItemSelectionKey('identity', identity.id);
                return (
                  <article key={identity.id} data-card-visual={visual.name} className={cn('group relative flex aspect-[1.72/1] min-h-0 flex-col overflow-hidden rounded-2xl border p-4 text-white shadow-lg shadow-black/15 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/20', visual.surface, selectedKeys.has(selectionKey) && 'ring-2 ring-primary ring-offset-2 ring-offset-background')} aria-label={`身份：${identity.title}`}>
                    <span className={cn('pointer-events-none absolute inset-0', visual.pattern)} aria-hidden="true" />
                    <span className="pointer-events-none absolute -right-10 -bottom-20 size-48 rounded-full border border-white/10" aria-hidden="true" />
                    <div className="relative z-10 flex items-start justify-between gap-3"><div className="min-w-0"><ContactIcon className="size-8 stroke-[1.5] text-white/75" aria-hidden="true" /><h2 className="mt-1 max-w-36 truncate text-xs font-medium tracking-wide text-white/65">{identity.title}</h2></div><div className="flex shrink-0 items-start gap-2"><span className="text-lg font-black tracking-tight text-white/90 italic uppercase">IDENTITY</span><VaultSelectionControl checked={selectedKeys.has(selectionKey)} label={`选择 ${identity.title}`} onChange={() => toggleSelection(selectionKey)} /></div></div>
                    <p className="relative z-10 mt-3 truncate text-lg font-medium tracking-wide text-white/95">{identity.displayName ?? '未填写姓名'}</p>
                    <div className="relative z-10 mt-auto grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4"><div className="min-w-0"><p className="text-[0.6rem] font-medium tracking-[0.16em] text-white/50 uppercase">组织</p><p className="mt-0.5 truncate text-sm font-medium text-white/90">{identity.organization ?? '未知'}</p></div><div className="text-right"><p className="text-[0.6rem] font-medium tracking-[0.16em] text-white/50 uppercase">状态</p><p className="mt-0.5 text-sm font-semibold text-white/90">{identity.favorite ? '已收藏' : '已保护'}</p></div></div>
                    <VaultCardActionBar><Button className={vaultCardActionClassName} variant="ghost" size="icon-sm" type="button" aria-label="编辑身份" onClick={() => void navigate({ to: '/vault/identities/$identityId', params: { identityId: identity.id } })}><PencilIcon /></Button><Button className="text-rose-200 hover:bg-rose-400/20 hover:text-rose-100" variant="ghost" size="icon-sm" type="button" aria-label="删除身份" disabled={busy} onClick={() => setPendingDeleteKeys([selectionKey])}><Trash2Icon /></Button></VaultCardActionBar>
                  </article>
                );
              } },
            ]} />
          )}
        </>
      )}
      </div>
      {showScrollToTop && (
        <Button
          className="fixed right-6 bottom-6 z-30 size-10 rounded-full shadow-lg"
          size="icon-lg"
          type="button"
          aria-label="回到页面顶部"
          title="回到顶部"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          <ArrowUpIcon />
        </Button>
      )}
      <Dialog open={selectedService !== null} onOpenChange={(open) => { if (!open) closeServiceDetail(); }}>
        <DialogContent className="max-h-[85vh] overflow-x-hidden overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedService?.name ?? '网站/服务详情'}</DialogTitle>
            <DialogDescription>{selectedService?.description ?? '查看这个网站/服务的站点与关联内容。所有秘密操作仍由原项目控制。'}</DialogDescription>
          </DialogHeader>
          {serviceDetailBusy ? (
            <p className="py-8 text-center text-sm text-muted-foreground">正在加载详情…</p>
          ) : selectedServiceDetail ? (
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap gap-2">
                {selectedServiceDetail.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
                {selectedServiceDetail.sites.map((site) => (
                  <Button key={site} variant="outline" size="sm" type="button" onClick={() => void window.vaultMesh.services.openSite(selectedServiceDetail.id, site).catch(() => toast.error('无法打开站点。'))}>
                    {site}<ExternalLinkIcon data-icon="inline-end" />
                  </Button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(Object.keys(serviceGroupLabels) as ServiceItemKind[]).map((kind) => (
                  <div key={kind} className="rounded-lg bg-muted/50 p-3">
                    <p className="text-xs text-muted-foreground">{serviceGroupLabels[kind]}</p>
                    <p className="mt-1 text-xl font-semibold">{selectedServiceDetail.counts[kind]}</p>
                  </div>
                ))}
              </div>
              <section className="flex flex-col gap-3">
                <div>
                  <h3 className="font-medium">关联内容</h3>
                  <p className="text-sm text-muted-foreground">点击项目可进入原详情；此处不展示受保护字段。</p>
                </div>
                {selectedServiceGroups.length === 0 ? <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">尚未关联项目。</p> : selectedServiceGroups.map((group) => (
                  <div key={group.kind} className="flex flex-col gap-2">
                    <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{serviceGroupLabels[group.kind]}</h4>
                    {group.relationships.map((relationship) => {
                      const label = serviceItemLabels.get(serviceRelationshipKey(relationship));
                      return (
                        <Button key={serviceRelationshipKey(relationship)} variant="outline" type="button" className="h-auto justify-between py-3 text-left" disabled={!label} onClick={() => goToServiceItem(relationship)}>
                          <span className="truncate">{label ?? '不可导航的项目'}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{relationship.source === 'manual' ? '手动关联' : '精确主机自动关联'}</span>
                        </Button>
                      );
                    })}
                  </div>
                ))}
              </section>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">详情暂时不可用，请关闭后重试。</p>
          )}
          <DialogFooter>
            <Button variant="outline" type="button" onClick={closeServiceDetail}>关闭</Button>
            <Button type="button" onClick={() => { closeServiceDetail(); void navigate({ to: '/vault/services' }); }}>管理网站/服务</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={pendingDeleteKeys.length > 0} onOpenChange={(open) => { if (!open) setPendingDeleteKeys([]); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingDeleteKeys.length === 1 ? '要删除这个项目吗？' : `要删除选中的 ${pendingDeleteKeys.length} 个项目吗？`}</AlertDialogTitle>
            <AlertDialogDescription>{pendingPermanentDeleteCount === 0
              ? '所选项目会移入加密回收站，可在安全中心恢复或永久删除。'
              : pendingPermanentDeleteCount === pendingDeleteKeys.length
                ? '所选密钥或 Passkey 会被永久删除，且无法恢复。'
                : `其中 ${pendingPermanentDeleteCount} 个密钥或 Passkey 会被永久删除，其余项目会移入加密回收站。`}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={busy} onClick={() => void removePendingItems()}>{pendingPermanentDeleteCount === pendingDeleteKeys.length ? '永久删除' : '删除所选项目'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <SshPublicKeyInstallDialog item={installingSshKey} items={sshCredentials} onClose={() => setInstallingSshKey(null)} />
      <AlertDialog open={protectedAction !== null} onOpenChange={(open) => { if (!open) { setProtectedAction(null); setRepromptPassword(''); } }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>主密码二次验证</AlertDialogTitle><AlertDialogDescription>此项目要求在访问秘密字段前再次验证当前主密码。</AlertDialogDescription></AlertDialogHeader>
          <Input type="password" value={repromptPassword} minLength={8} maxLength={1_024} autoFocus autoComplete="current-password" placeholder="当前主密码" onChange={(event) => setRepromptPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void confirmReprompt(); }} />
          <AlertDialogFooter><AlertDialogCancel disabled={repromptBusy}>取消</AlertDialogCancel><Button type="button" disabled={repromptBusy || repromptPassword.length < 8} onClick={() => void confirmReprompt()}>{repromptBusy ? '正在验证…' : '验证并继续'}</Button></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
