import type { CapturedIdentity } from "@/lib/save-capture";

type IdentityEntry = Record<string, unknown>;
export type ExistingIdentity = Record<string, unknown> & { id: string };

export function identityMatchesCapture(detail: Record<string, unknown>, identity: CapturedIdentity): boolean {
  const capturedEmails = new Set(identity.emails.map((entry) => normalizedEmail(entry.value)));
  const capturedPhones = new Set(identity.phones.map((entry) => normalizedPhone(entry.value)).filter(Boolean));
  const emails = entries(detail.emails);
  const phones = entries(detail.phones);
  const addresses = entries(detail.addresses);
  return emails.some((entry) => capturedEmails.has(normalizedEmail(entry.value)))
    || phones.some((entry) => capturedPhones.has(normalizedPhone(entry.value)))
    || identity.addresses.some((captured) => addresses.some((existing) => addressMatches(existing, captured)));
}

export function buildIdentityUpdate(existing: ExistingIdentity, identity: CapturedIdentity): Record<string, unknown> {
  const { identityId: _identityId, ...captured } = identity;
  return {
    ...existing,
    id: existing.id,
    // Website-derived titles are useful for new profiles but must never rename
    // an existing vault profile during an automatic update.
    title: existing.title,
    firstName: captured.firstName ?? existing.firstName ?? null,
    middleName: captured.middleName ?? existing.middleName ?? null,
    lastName: captured.lastName ?? existing.lastName ?? null,
    birthDate: captured.birthDate ?? existing.birthDate ?? null,
    emails: mergeCapturedEntries(entries(existing.emails), captured.emails, (entry) => normalizedEmail(entry.value)),
    phones: mergeCapturedEntries(entries(existing.phones), captured.phones, (entry) => normalizedPhone(entry.value)),
    addresses: mergeCapturedEntries(entries(existing.addresses), captured.addresses, addressKey, addressMatches),
    organization: captured.organization ?? existing.organization ?? null,
    department: captured.department ?? existing.department ?? null,
    jobTitle: captured.jobTitle ?? existing.jobTitle ?? null,
    website: captured.website ?? existing.website ?? null,
    notes: existing.notes ?? null,
    folder: existing.folder ?? null,
    favorite: existing.favorite ?? false,
  };
}

export function identityUpdateChanges(existing: ExistingIdentity, update: Record<string, unknown>): boolean {
  return JSON.stringify(identityComparable(existing)) !== JSON.stringify(identityComparable(update));
}

function mergeCapturedEntries(
  existing: IdentityEntry[],
  captured: IdentityEntry[],
  key: (entry: IdentityEntry) => string,
  equivalent: (existing: IdentityEntry, captured: IdentityEntry) => boolean = (left, right) => Boolean(key(right)) && key(left) === key(right),
): IdentityEntry[] {
  if (captured.length === 0) return existing;
  const result = existing.map((entry) => ({ ...entry }));
  for (const entry of captured) {
    if (result.some((candidate) => equivalent(candidate, entry))) continue;
    // A form filled from a profile with one value is editing that value, not
    // adding an unrelated second preferred value. Preserve its stable id.
    if (captured.length === 1 && result.length === 1) {
      const capturedValues = Object.fromEntries(Object.entries(entry).filter(([field, value]) =>
        !["id", "label", "preferred"].includes(field) && value != null && value !== "",
      ));
      result[0] = { ...result[0], ...capturedValues, ...(result[0]?.id ? { id: result[0].id } : {}) };
      continue;
    }
    result.push({ ...entry });
  }
  // The native identity model permits at most one preferred value in each
  // collection. A captured value is usually marked preferred, but appending it
  // to a profile that already has a preferred value must not create an invalid
  // identity update.
  return normalizePreferredEntries(result.slice(0, 20));
}

function normalizePreferredEntries(values: IdentityEntry[]): IdentityEntry[] {
  let hasPreferred = false;
  return values.map((entry) => {
    const preferred = entry.preferred === true && !hasPreferred;
    if (preferred) hasPreferred = true;
    return { ...entry, preferred };
  });
}

function identityComparable(value: Record<string, unknown>) {
  return {
    title: value.title ?? "",
    firstName: value.firstName ?? null,
    middleName: value.middleName ?? null,
    lastName: value.lastName ?? null,
    birthDate: value.birthDate ?? null,
    emails: entries(value.emails),
    phones: entries(value.phones),
    addresses: entries(value.addresses),
    organization: value.organization ?? null,
    department: value.department ?? null,
    jobTitle: value.jobTitle ?? null,
    website: value.website ?? null,
  };
}

function entries(value: unknown): IdentityEntry[] {
  return Array.isArray(value) ? value as IdentityEntry[] : [];
}

function normalizedEmail(value: unknown): string {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function normalizedPhone(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

function addressKey(entry: IdentityEntry): string {
  return [entry.addressLine1, entry.addressLine2, entry.city, entry.region, entry.postalCode, entry.countryCode, entry.country]
    .map((value) => String(value ?? "").trim().toLocaleLowerCase())
    .join("|");
}

function addressMatches(existing: IdentityEntry, captured: IdentityEntry): boolean {
  const line1 = normalizedText(captured.addressLine1);
  if (!line1 || normalizedText(existing.addressLine1) !== line1) return false;
  const optionalFields = ["addressLine2", "city", "region", "postalCode", "countryCode", "country"] as const;
  return optionalFields.every((field) => {
    const capturedValue = normalizedText(captured[field]);
    return !capturedValue || normalizedText(existing[field]) === capturedValue;
  });
}

function normalizedText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}
