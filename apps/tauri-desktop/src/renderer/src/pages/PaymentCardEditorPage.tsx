import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { CreditCardIcon, FileTextIcon, LandmarkIcon, MapPinIcon, ShieldCheckIcon, StarIcon, Trash2Icon } from 'lucide-react';

import { SectionedEditorForm } from '@/components/SectionedEditorForm';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { paymentCardNetworkOptions } from '@/lib/payment-card-networks';
import { useVaultStore } from '@/stores/vault-store';

interface PaymentCardEditorPageProps { cardId?: string; }

const optional = (value: string): string | null => value.trim() || null;
const NO_CARD_NETWORK = '__no_card_network__';

export function PaymentCardEditorPage({ cardId }: PaymentCardEditorPageProps) {
  const summary = useVaultStore((state) => state.cards.find((card) => card.id === cardId) ?? null);
  const busy = useVaultStore((state) => state.busy);
  const error = useVaultStore((state) => state.error);
  const addCard = useVaultStore((state) => state.addCard);
  const updateCard = useVaultStore((state) => state.updateCard);
  const getCardDetail = useVaultStore((state) => state.getCardDetail);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(Boolean(cardId));
  const [title, setTitle] = useState(summary?.title ?? '');
  const [cardholderName, setCardholderName] = useState(summary?.cardholderName ?? '');
  const [cardNumber, setCardNumber] = useState('');
  const [expirationMonth, setExpirationMonth] = useState(summary?.expirationMonth ?? 1);
  const [expirationYear, setExpirationYear] = useState(summary?.expirationYear ?? new Date().getFullYear() + 3);
  const [securityCode, setSecurityCode] = useState('');
  const [pin, setPin] = useState('');
  const [clearSecurityCode, setClearSecurityCode] = useState(false);
  const [clearPin, setClearPin] = useState(false);
  const [hasSecurityCode, setHasSecurityCode] = useState(false);
  const [hasPin, setHasPin] = useState(false);
  const [issuer, setIssuer] = useState('');
  const [network, setNetwork] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [folder, setFolder] = useState('');
  const [favorite, setFavorite] = useState(false);
  const [masterPasswordReprompt, setMasterPasswordReprompt] = useState(false);

  useEffect(() => {
    if (!cardId) return;
    let active = true;
    void getCardDetail(cardId).then((detail) => {
      if (!active || !detail) return;
      setTitle(detail.title); setCardholderName(detail.cardholderName);
      setExpirationMonth(detail.expirationMonth); setExpirationYear(detail.expirationYear);
      setHasSecurityCode(detail.hasSecurityCode); setHasPin(detail.hasPin);
      setIssuer(detail.issuer ?? ''); setNetwork(detail.network ?? '');
      setBillingAddress(detail.billingAddress ?? ''); setNotes(detail.notes ?? '');
      setFolder(detail.folder ?? ''); setFavorite(detail.favorite);
      setMasterPasswordReprompt(detail.masterPasswordReprompt); setLoading(false);
    });
    return () => { active = false; };
  }, [cardId, getCardDetail]);

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const succeeded = cardId
      ? await updateCard({
        id: cardId, title, cardholderName, cardNumber: optional(cardNumber),
        expirationMonth, expirationYear, securityCode: optional(securityCode), clearSecurityCode,
        pin: optional(pin), clearPin, issuer: optional(issuer), network: optional(network),
        billingAddress: optional(billingAddress), notes: optional(notes), folder: optional(folder),
        favorite, masterPasswordReprompt,
      })
      : await addCard({
        title, cardholderName, cardNumber, expirationMonth, expirationYear,
        securityCode: optional(securityCode), pin: optional(pin), issuer: optional(issuer),
        network: optional(network), billingAddress: optional(billingAddress), notes: optional(notes),
        folder: optional(folder), favorite, masterPasswordReprompt,
      });
    if (succeeded) void navigate({ to: '/vault' });
  };

  if (loading) return <div className="grid min-h-80 place-items-center"><Spinner /></div>;

  return (
    <SectionedEditorForm
      formId="payment-card-editor"
      error={error}
      busy={busy}
      submitLabel="保存支付卡"
      onCancel={() => void navigate({ to: '/vault' })}
      onSubmit={(event) => void save(event)}
      sections={[
        {
          id: 'basics', label: '基本信息', description: '为支付卡命名并整理归属。', icon: FileTextIcon,
          complete: Boolean(title.trim() && cardholderName.trim()),
          content: <FieldGroup>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field><FieldLabel htmlFor="card-title">名称</FieldLabel><Input id="card-title" required maxLength={256} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：日常消费卡" /></Field>
              <Field><FieldLabel htmlFor="cardholder">持卡人姓名</FieldLabel><Input id="cardholder" required maxLength={256} value={cardholderName} onChange={(event) => setCardholderName(event.target.value)} autoComplete="cc-name" /></Field>
            </div>
            <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Field><FieldLabel htmlFor="card-folder">文件夹</FieldLabel><Input id="card-folder" maxLength={256} value={folder} onChange={(event) => setFolder(event.target.value)} placeholder="例如：个人、工作" /></Field>
              <Field className="sm:w-auto"><FieldLabel htmlFor="card-favorite">收藏</FieldLabel><Button className="w-full sm:w-fit" id="card-favorite" variant={favorite ? 'default' : 'outline'} type="button" aria-pressed={favorite} onClick={() => setFavorite((value) => !value)}><StarIcon data-icon="inline-start" className={favorite ? 'fill-current' : undefined} />{favorite ? '已收藏' : '加入收藏'}</Button></Field>
            </div>
          </FieldGroup>,
        },
        {
          id: 'card', label: '卡片详情', description: '保存卡号、有效期和发卡信息。', icon: CreditCardIcon,
          complete: Boolean(cardId || cardNumber.trim()),
          content: <FieldGroup>
            <Field><FieldLabel htmlFor="card-number">卡号</FieldLabel><Input id="card-number" required={!cardId} minLength={cardId ? undefined : 12} maxLength={32} inputMode="numeric" autoComplete="cc-number" value={cardNumber} onChange={(event) => setCardNumber(event.target.value)} placeholder={cardId ? `${summary?.maskedNumber ?? '••••'}（留空以保留）` : '4111 1111 1111 1111'} /><FieldDescription>保存时会移除空格和连字符，并进行 Luhn 校验。</FieldDescription></Field>
            <div className="grid gap-5 sm:grid-cols-2"><Field><FieldLabel htmlFor="expiration-month">到期月份</FieldLabel><Input id="expiration-month" type="number" min={1} max={12} required value={expirationMonth} onChange={(event) => setExpirationMonth(Number(event.target.value))} autoComplete="cc-exp-month" /></Field><Field><FieldLabel htmlFor="expiration-year">到期年份</FieldLabel><Input id="expiration-year" type="number" min={1000} max={9999} required value={expirationYear} onChange={(event) => setExpirationYear(Number(event.target.value))} autoComplete="cc-exp-year" /></Field></div>
            <div className="grid gap-5 sm:grid-cols-2"><Field><FieldLabel htmlFor="issuer">发卡机构</FieldLabel><Input id="issuer" maxLength={256} value={issuer} onChange={(event) => setIssuer(event.target.value)} /></Field><Field><FieldLabel htmlFor="network">卡组织</FieldLabel><Select value={network || NO_CARD_NETWORK} onValueChange={(value) => setNetwork(value === NO_CARD_NETWORK ? '' : value)}><SelectTrigger id="network" className="w-full"><SelectValue placeholder="选择卡组织" /></SelectTrigger><SelectContent><SelectGroup><SelectItem value={NO_CARD_NETWORK}>未选择</SelectItem>{paymentCardNetworkOptions(network).map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field></div>
          </FieldGroup>,
        },
        {
          id: 'security', label: '安全字段', description: '管理安全码、PIN 与复制保护。', icon: ShieldCheckIcon,
          complete: hasSecurityCode || hasPin || Boolean(securityCode || pin || masterPasswordReprompt),
          content: <FieldGroup>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field><FieldLabel htmlFor="security-code">安全码（CVV/CVC）</FieldLabel><Input id="security-code" inputMode="numeric" minLength={3} maxLength={4} pattern="\d{3,4}" value={securityCode} onChange={(event) => { setSecurityCode(event.target.value); setClearSecurityCode(false); }} autoComplete="cc-csc" placeholder={hasSecurityCode ? '已保存；留空以保留' : '可选'} />{hasSecurityCode && <Button className="w-fit" variant="outline" size="sm" type="button" onClick={() => { setClearSecurityCode(true); setSecurityCode(''); }}><Trash2Icon data-icon="inline-start" />{clearSecurityCode ? '保存后将清除' : '清除已保存安全码'}</Button>}</Field>
              <Field><FieldLabel htmlFor="card-pin">PIN</FieldLabel><Input id="card-pin" type="password" inputMode="numeric" minLength={4} maxLength={12} pattern="\d{4,12}" value={pin} onChange={(event) => { setPin(event.target.value); setClearPin(false); }} placeholder={hasPin ? '已保存；留空以保留' : '可选'} />{hasPin && <Button className="w-fit" variant="outline" size="sm" type="button" onClick={() => { setClearPin(true); setPin(''); }}><Trash2Icon data-icon="inline-start" />{clearPin ? '保存后将清除' : '清除已保存 PIN'}</Button>}</Field>
            </div>
            <Field orientation="horizontal"><FieldLabel htmlFor="card-reprompt">复制秘密字段前再次验证主密码</FieldLabel><Switch id="card-reprompt" checked={masterPasswordReprompt} onCheckedChange={setMasterPasswordReprompt} /></Field>
          </FieldGroup>,
        },
        {
          id: 'billing', label: '账单信息', description: '记录支付卡对应的账单地址。', icon: MapPinIcon,
          complete: Boolean(billingAddress.trim()),
          content: <FieldGroup><Field><FieldLabel htmlFor="billing-address">账单地址</FieldLabel><Textarea id="billing-address" rows={6} maxLength={10_000} value={billingAddress} onChange={(event) => setBillingAddress(event.target.value)} /></Field></FieldGroup>,
        },
        {
          id: 'additional', label: '附加选项', description: '补充备注等加密信息。', icon: LandmarkIcon,
          complete: Boolean(notes.trim()),
          content: <FieldGroup><Field><FieldLabel htmlFor="card-notes">备注</FieldLabel><Textarea id="card-notes" rows={6} maxLength={10_000} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field></FieldGroup>,
        },
      ]}
    />
  );
}
