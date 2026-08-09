import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Building2Icon, ContactIcon, MailIcon, MapPinIcon, PlusIcon, SlidersHorizontalIcon, StarIcon, Trash2Icon } from 'lucide-react';

import type { IdentityDetail, IdentityInput } from '../../../shared/contracts';
import { DatePicker } from '@/components/DatePicker';
import { SectionedEditorForm } from '@/components/SectionedEditorForm';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { useVaultStore } from '@/stores/vault-store';

interface Props { identityId?: string; }
const optional = (value: string): string | null => value.trim() || null;
const newValue = () => ({ id: crypto.randomUUID(), label: '', value: '', preferred: false });
const newAddress = () => ({ id: crypto.randomUUID(), label: '', addressLine1: '', addressLine2: null, city: null, region: null, postalCode: null, countryCode: null, country: null, preferred: false });

export function IdentityEditorPage({ identityId }: Props) {
  const busy = useVaultStore((state) => state.busy);
  const error = useVaultStore((state) => state.error);
  const addIdentity = useVaultStore((state) => state.addIdentity);
  const updateIdentity = useVaultStore((state) => state.updateIdentity);
  const getIdentityDetail = useVaultStore((state) => state.getIdentityDetail);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(Boolean(identityId));
  const [title, setTitle] = useState(''); const [firstName, setFirstName] = useState(''); const [middleName, setMiddleName] = useState(''); const [lastName, setLastName] = useState(''); const [birthDate, setBirthDate] = useState('');
  const [emails, setEmails] = useState<IdentityDetail['emails']>([]); const [phones, setPhones] = useState<IdentityDetail['phones']>([]); const [addresses, setAddresses] = useState<IdentityDetail['addresses']>([]);
  const [organization, setOrganization] = useState(''); const [department, setDepartment] = useState(''); const [jobTitle, setJobTitle] = useState(''); const [website, setWebsite] = useState(''); const [notes, setNotes] = useState(''); const [folder, setFolder] = useState(''); const [favorite, setFavorite] = useState(false);

  useEffect(() => {
    if (!identityId) return;
    let active = true;
    void getIdentityDetail(identityId).then((item) => {
      if (!active || !item) return;
      setTitle(item.title); setFirstName(item.firstName ?? ''); setMiddleName(item.middleName ?? ''); setLastName(item.lastName ?? ''); setBirthDate(item.birthDate ?? ''); setEmails(item.emails); setPhones(item.phones); setAddresses(item.addresses); setOrganization(item.organization ?? ''); setDepartment(item.department ?? ''); setJobTitle(item.jobTitle ?? ''); setWebsite(item.website ?? ''); setNotes(item.notes ?? ''); setFolder(item.folder ?? ''); setFavorite(item.favorite); setLoading(false);
    });
    return () => { active = false; };
  }, [getIdentityDetail, identityId]);

  const payload = (): IdentityInput => ({ title, firstName: optional(firstName), middleName: optional(middleName), lastName: optional(lastName), birthDate: optional(birthDate), emails, phones, addresses, organization: optional(organization), department: optional(department), jobTitle: optional(jobTitle), website: optional(website), notes: optional(notes), folder: optional(folder), favorite });
  const save = async (event: FormEvent): Promise<void> => { event.preventDefault(); const saved = identityId ? await updateIdentity({ id: identityId, ...payload() }) : await addIdentity(payload()); if (saved) void navigate({ to: '/vault' }); };
  const updateValue = (kind: 'emails' | 'phones', id: string, field: 'label' | 'value' | 'preferred', value: string | boolean) => {
    const setter = kind === 'emails' ? setEmails : setPhones;
    setter((entries) => entries.map((entry) => field === 'preferred' ? { ...entry, preferred: entry.id === id ? Boolean(value) : false } : { ...entry, [field]: value }));
  };
  if (loading) return <div className="grid min-h-80 place-items-center"><Spinner /></div>;
  return <SectionedEditorForm
    formId="identity-editor"
    error={error}
    busy={busy}
    submitLabel="保存身份"
    onCancel={() => void navigate({ to: '/vault' })}
    onSubmit={(event) => void save(event)}
    sections={[
      {
        id: 'basics', label: '基本资料', description: '记录姓名与出生日期。', icon: ContactIcon,
        complete: Boolean(title.trim()),
        content: <FieldGroup><Field><FieldLabel htmlFor="identity-title">条目名称</FieldLabel><Input id="identity-title" required maxLength={256} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="个人身份" /></Field><div className="grid gap-5 sm:grid-cols-3"><Field><FieldLabel htmlFor="identity-first">名字</FieldLabel><Input id="identity-first" value={firstName} onChange={(event) => setFirstName(event.target.value)} autoComplete="given-name" /></Field><Field><FieldLabel htmlFor="identity-middle">中间名</FieldLabel><Input id="identity-middle" value={middleName} onChange={(event) => setMiddleName(event.target.value)} /></Field><Field><FieldLabel htmlFor="identity-last">姓氏</FieldLabel><Input id="identity-last" value={lastName} onChange={(event) => setLastName(event.target.value)} autoComplete="family-name" /></Field></div><Field><FieldLabel htmlFor="identity-birth">出生日期</FieldLabel><DatePicker id="identity-birth" value={birthDate} onValueChange={setBirthDate} placeholder="选择出生日期" endMonth={new Date()} maxDate={new Date()} /></Field></FieldGroup>,
      },
      {
        id: 'contacts', label: '联系方式', description: '管理电子邮件、电话号码和首选项。', icon: MailIcon,
        complete: emails.length > 0 || phones.length > 0,
        content: <FieldGroup><ContactValues title="电子邮件" entries={emails} kind="emails" add={() => setEmails((entries) => [...entries, newValue()])} remove={(id) => setEmails((entries) => entries.filter((entry) => entry.id !== id))} update={updateValue} inputType="email" /><ContactValues title="电话号码" entries={phones} kind="phones" add={() => setPhones((entries) => [...entries, newValue()])} remove={(id) => setPhones((entries) => entries.filter((entry) => entry.id !== id))} update={updateValue} inputType="tel" /></FieldGroup>,
      },
      {
        id: 'addresses', label: '地址', description: '添加一个或多个地址并指定首选地址。', icon: MapPinIcon,
        complete: addresses.length > 0,
        content: <FieldGroup>{addresses.map((address, index) => <FieldSet className="rounded-lg bg-muted/50 p-4" key={address.id}><FieldLegend>地址 {index + 1}</FieldLegend><div className="flex justify-end gap-1"><Button variant="ghost" size="sm" type="button" disabled={index === 0} onClick={() => setAddresses((entries) => { const next = [...entries]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; return next; })}>上移</Button><Button variant="ghost" size="sm" type="button" disabled={index === addresses.length - 1} onClick={() => setAddresses((entries) => { const next = [...entries]; [next[index], next[index + 1]] = [next[index + 1]!, next[index]!]; return next; })}>下移</Button><Button variant="ghost" size="sm" type="button" onClick={() => setAddresses((entries) => entries.filter((entry) => entry.id !== address.id))}><Trash2Icon data-icon="inline-start" />移除</Button></div><div className="grid gap-3 sm:grid-cols-2"><Input aria-label="地址标签" value={address.label} placeholder="标签（如：家庭）" onChange={(event) => setAddresses((entries) => entries.map((entry) => entry.id === address.id ? { ...entry, label: event.target.value } : entry))} /><Input aria-label="地址第一行" required value={address.addressLine1} placeholder="地址第一行" autoComplete="address-line1" onChange={(event) => setAddresses((entries) => entries.map((entry) => entry.id === address.id ? { ...entry, addressLine1: event.target.value } : entry))} /><Input aria-label="地址第二行" value={address.addressLine2 ?? ''} placeholder="地址第二行" autoComplete="address-line2" onChange={(event) => setAddresses((entries) => entries.map((entry) => entry.id === address.id ? { ...entry, addressLine2: optional(event.target.value) } : entry))} /><Input aria-label="城市" value={address.city ?? ''} placeholder="城市" autoComplete="address-level2" onChange={(event) => setAddresses((entries) => entries.map((entry) => entry.id === address.id ? { ...entry, city: optional(event.target.value) } : entry))} /><Input aria-label="省州或地区" value={address.region ?? ''} placeholder="省/州/地区" autoComplete="address-level1" onChange={(event) => setAddresses((entries) => entries.map((entry) => entry.id === address.id ? { ...entry, region: optional(event.target.value) } : entry))} /><Input aria-label="邮编" value={address.postalCode ?? ''} placeholder="邮编" autoComplete="postal-code" onChange={(event) => setAddresses((entries) => entries.map((entry) => entry.id === address.id ? { ...entry, postalCode: optional(event.target.value) } : entry))} /><Input aria-label="国家或地区名称" value={address.country ?? ''} placeholder="国家/地区名称" autoComplete="country-name" onChange={(event) => setAddresses((entries) => entries.map((entry) => entry.id === address.id ? { ...entry, country: optional(event.target.value) } : entry))} /><Input aria-label="国家代码" value={address.countryCode ?? ''} placeholder="国家代码（CN）" maxLength={2} autoComplete="country" onChange={(event) => setAddresses((entries) => entries.map((entry) => entry.id === address.id ? { ...entry, countryCode: optional(event.target.value)?.toUpperCase() ?? null } : entry))} /></div><label className="flex items-center gap-2 text-sm"><input type="radio" name="preferred-address" checked={address.preferred} onChange={() => setAddresses((entries) => entries.map((entry) => ({ ...entry, preferred: entry.id === address.id })))} />首选地址</label></FieldSet>)}<Button className="w-fit" variant="outline" type="button" onClick={() => setAddresses((entries) => [...entries, newAddress()])}><PlusIcon data-icon="inline-start" />添加地址</Button></FieldGroup>,
      },
      {
        id: 'organization', label: '组织信息', description: '记录组织、部门和职务。', icon: Building2Icon,
        complete: Boolean(organization.trim() || department.trim() || jobTitle.trim()),
        content: <FieldGroup><div className="grid gap-5 sm:grid-cols-2"><Field><FieldLabel htmlFor="identity-organization">组织</FieldLabel><Input id="identity-organization" value={organization} onChange={(event) => setOrganization(event.target.value)} autoComplete="organization" /></Field><Field><FieldLabel htmlFor="identity-job-title">职务</FieldLabel><Input id="identity-job-title" value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} autoComplete="organization-title" /></Field></div><Field><FieldLabel htmlFor="identity-department">部门</FieldLabel><Input id="identity-department" value={department} onChange={(event) => setDepartment(event.target.value)} /></Field></FieldGroup>,
      },
      {
        id: 'additional', label: '附加选项', description: '添加网站、备注、文件夹和收藏状态。', icon: SlidersHorizontalIcon,
        complete: Boolean(website.trim() || notes.trim() || folder.trim() || favorite),
        content: <FieldGroup><Field><FieldLabel htmlFor="identity-website">网站</FieldLabel><Input id="identity-website" type="url" value={website} onChange={(event) => setWebsite(event.target.value)} autoComplete="url" /></Field><Field><FieldLabel htmlFor="identity-notes">备注</FieldLabel><Textarea id="identity-notes" rows={5} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field><div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto]"><Field><FieldLabel htmlFor="identity-folder">文件夹</FieldLabel><Input id="identity-folder" value={folder} onChange={(event) => setFolder(event.target.value)} /></Field><Field className="sm:w-auto"><FieldLabel htmlFor="identity-favorite">收藏</FieldLabel><Button className="w-full sm:w-fit" id="identity-favorite" variant={favorite ? 'default' : 'outline'} type="button" aria-pressed={favorite} onClick={() => setFavorite((value) => !value)}><StarIcon data-icon="inline-start" className={favorite ? 'fill-current' : undefined} />{favorite ? '已收藏' : '加入收藏'}</Button></Field></div></FieldGroup>,
      },
    ]}
  />;
}

function ContactValues({ title, entries, kind, add, remove, update, inputType }: { title: string; entries: IdentityDetail['emails']; kind: 'emails' | 'phones'; add: () => void; remove: (id: string) => void; update: (kind: 'emails' | 'phones', id: string, field: 'label' | 'value' | 'preferred', value: string | boolean) => void; inputType: 'email' | 'tel' }) {
  return <FieldSet><FieldLegend>{title}</FieldLegend><FieldDescription>可添加多条记录，并选择一条作为首选。</FieldDescription><FieldGroup className="gap-3">{entries.map((entry) => <div className="grid gap-3 rounded-lg bg-muted/50 p-3 sm:grid-cols-[9rem_minmax(0,1fr)_auto_auto]" key={entry.id}><Input aria-label={`${title}标签`} value={entry.label} placeholder="标签" onChange={(event) => update(kind, entry.id, 'label', event.target.value)} /><Input aria-label={title} required type={inputType} value={entry.value} placeholder={inputType === 'email' ? 'name@example.com' : '+86 138 0000 0000'} onChange={(event) => update(kind, entry.id, 'value', event.target.value)} /><label className="flex items-center gap-1 text-sm"><input type="radio" name={`preferred-${kind}`} checked={entry.preferred} onChange={() => update(kind, entry.id, 'preferred', true)} />首选</label><Button variant="ghost" size="icon" type="button" aria-label={`移除${title}`} onClick={() => remove(entry.id)}><Trash2Icon /></Button></div>)}<Button className="w-fit" variant="outline" type="button" onClick={add}><PlusIcon data-icon="inline-start" />添加{title}</Button></FieldGroup></FieldSet>;
}
