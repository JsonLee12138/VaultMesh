import jsQR from "jsqr";

import {
  captureSubmittedData,
  hasCapturedData,
  type CapturedIdentity,
  type CapturedSaveData,
  type CapturedSecret,
  type CapturedSshCredential,
} from "@/lib/save-capture";

export type DetectedPageInformation = {
  pageUrl: string;
  pageTitle: string;
  data: CapturedSaveData;
  ignoredSensitiveFields: string[];
};

export function detectPageInformation(document: Document, pageUrl: string): DetectedPageInformation | null {
  const generic = captureSubmittedData(document, pageUrl);
  const siteSpecific = meiguodizhiCapture(document, pageUrl);
  const sensitive = sensitivePageCapture(document, pageUrl);
  const merged = mergeCapturedData(mergeCapturedData(generic, siteSpecific?.data ?? {}), sensitive);
  const enhanced = attachLoginEnhancements(merged, document, pageUrl);
  // TOTP belongs to a login. A QR-only setup page is handled by the explicit
  // "scan current page" action so the user can choose the destination login.
  const data = enhanced.login ? enhanced : withoutStandaloneTotp(enhanced);
  if (!hasCapturedData(data)) return null;
  return {
    pageUrl,
    pageTitle: document.title.trim().slice(0, 256) || safeHostname(pageUrl),
    data,
    ignoredSensitiveFields: siteSpecific?.ignoredSensitiveFields ?? [],
  };
}

export async function detectPageInformationWithQr(document: Document, pageUrl: string): Promise<DetectedPageInformation | null> {
  const detected = detectPageInformation(document, pageUrl);
  const qrValues = await scanTotpQrCodes(document);
  if (!qrValues.length || !detected?.data.login) return detected;
  const provider = providerForPage(pageUrl);
  const qrData: CapturedSaveData = {
    secrets: qrValues.map(({ uri }) => ({
      title: `${provider} TOTP 验证器`.slice(0, 256), kind: "authenticator-key", secret: uri,
      provider, account: null, environment: null, scopes: [], expiresAt: null, website: httpUrl(pageUrl),
    })),
  };
  const data = attachLoginEnhancements(mergeCapturedData(detected?.data ?? {}, qrData), document, pageUrl);
  return {
    pageUrl,
    pageTitle: detected?.pageTitle ?? (document.title.trim().slice(0, 256) || safeHostname(pageUrl)),
    data,
    ignoredSensitiveFields: detected?.ignoredSensitiveFields ?? [],
  };
}

export type ScannedTotpQrCode = { uri: string; issuer: string | null; account: string | null };
export type TotpQrTarget = HTMLElement | SVGSVGElement;
type QrVisualSource = HTMLImageElement | HTMLCanvasElement | SVGSVGElement;

export async function scanTotpQrCodes(document: Document): Promise<ScannedTotpQrCode[]> {
  return scanTotpQrScope(document, document);
}

/** Returns only visible QR-like sources. This is deliberately a cheap DOM
 * discovery pass: image pixels are decoded only after an explicit action. */
export function findTotpQrTargets(document: Document): TotpQrTarget[] {
  const direct = Array.from(document.querySelectorAll<HTMLElement>('[data-qr-value],a[href^="otpauth://"],img[alt*="otpauth://"]'));
  const visual = Array.from(document.querySelectorAll<Element>("img,canvas,svg"))
    .filter(isQrVisualSource)
    .filter((element) => qrHint(element) || (element instanceof SVGSVGElement && looksLikeQrSvg(element)));
  return Array.from(new Set([...direct, ...visual].filter((element) => isVisibleQrSource(document, element))));
}

/** Decodes only the source bound to the clicked inline action. */
export async function scanTotpQrTarget(document: Document, target: Element): Promise<ScannedTotpQrCode[]> {
  if (!(target instanceof HTMLElement || target instanceof SVGSVGElement)
    || !target.isConnected
    || !isVisibleQrSource(document, target)) return [];
  return scanTotpQrScope(document, target);
}

async function scanTotpQrScope(document: Document, root: ParentNode): Promise<ScannedTotpQrCode[]> {
  const directElements = root instanceof Element
    ? [root, ...Array.from(root.querySelectorAll<HTMLElement>('[data-qr-value],a[href^="otpauth://"],img[alt*="otpauth://"]'))]
    : Array.from(root.querySelectorAll<HTMLElement>('[data-qr-value],a[href^="otpauth://"],img[alt*="otpauth://"]'));
  const direct = directElements
    .map((element) => element.getAttribute("data-qr-value") ?? element.getAttribute("href") ?? element.getAttribute("alt") ?? "")
    .flatMap((value) => value.match(/otpauth:\/\/totp\/[^\s"'<>]+/gi) ?? [])
    .filter((value) => /[?&]secret=[A-Z2-7]+=*/i.test(value));
  const BarcodeDetectorConstructor = (globalThis as unknown as {
    BarcodeDetector?: new (options: { formats: string[] }) => { detect(source: QrVisualSource): Promise<Array<{ rawValue: string }>> };
  }).BarcodeDetector;
  const sources = (isQrVisualSource(root)
    ? [root]
    : Array.from(root.querySelectorAll<Element>("img,canvas,svg"))
      .filter(isQrVisualSource)
      .filter((source) => !(source instanceof SVGSVGElement) || qrHint(source) || looksLikeQrSvg(source)))
    .filter((element) => isVisibleQrSource(document, element))
    .slice(0, 20);
  if (BarcodeDetectorConstructor) {
    try {
      const detector = new BarcodeDetectorConstructor({ formats: ["qr_code"] });
      const decoded = await Promise.all(sources.map((source) => detector.detect(source).catch(() => [])));
      const values = decoded.flat().map((barcode) => barcode.rawValue.trim()).filter(isTotpUri);
      if (direct.length || values.length) return totpQrCodes([...direct, ...values]);
    } catch {
      // Fall through to the bundled decoder for browsers without a usable
      // Barcode Detection implementation.
    }
  }
  const decoded: string[] = [];
  for (const source of sources) {
    const value = await decodeQrWithJsQr(document, source);
    if (value && isTotpUri(value)) decoded.push(value);
  }
  return totpQrCodes([...direct, ...decoded]);
}

function isQrVisualSource(element: unknown): element is QrVisualSource {
  return element instanceof HTMLImageElement
    || element instanceof HTMLCanvasElement
    || element instanceof SVGSVGElement;
}

function qrHint(element: Element): boolean {
  let current: Element | null = element;
  for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
    const metadata = [
      current.id,
      current.className,
      current.getAttribute("alt"),
      current.getAttribute("aria-label"),
      current.getAttribute("title"),
      current.getAttribute("data-target"),
      current.getAttribute("data-testid"),
    ].filter((value): value is string => typeof value === "string").join(" ");
    if (/(?:qr[-_\s]?code|totp|authenticator|two[-_\s]?factor|2fa)/i.test(metadata)) return true;
  }
  return false;
}

function looksLikeQrSvg(element: SVGSVGElement): boolean {
  const viewBox = element.viewBox.baseVal;
  const modules = viewBox.width;
  if (viewBox.width !== viewBox.height
    || !Number.isInteger(modules)
    || modules < 21
    || modules > 177
    || (modules - 21) % 4 !== 0) return false;
  return Array.from(element.querySelectorAll("path"))
    .some((path) => path.getAttribute("shape-rendering") === "crispEdges"
      && (path.getAttribute("d")?.length ?? 0) >= 100);
}

function isVisibleQrSource(document: Document, element: Element): boolean {
  if ((element instanceof HTMLElement && element.hidden) || element.closest("[hidden],[aria-hidden='true']")) return false;
  const view = document.defaultView;
  if (view) {
    for (let current: Element | null = element; current; current = current.parentElement) {
      const style = view.getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
    }
  }
  return true;
}

async function decodeQrWithJsQr(document: Document, source: QrVisualSource): Promise<string | null> {
  try {
    if (source instanceof HTMLImageElement && (!source.complete || !source.naturalWidth)) await source.decode();
    const { width: sourceWidth, height: sourceHeight } = qrSourceDimensions(source);
    if (!sourceWidth || !sourceHeight) return null;
    const scale = Math.min(1, 1_600 / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    // QR readers expect a four-module quiet zone. Some inline SVG generators
    // render the module grid flush to the viewBox, so add one before decoding.
    const quietZone = Math.max(4, Math.ceil(Math.min(width, height) * 0.13));
    const canvas = document.createElement("canvas");
    canvas.width = width + quietZone * 2;
    canvas.height = height + quietZone * 2;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (source instanceof SVGSVGElement) {
      const image = await rasterizeSvg(document, source);
      if (!image) return null;
      context.drawImage(image, quietZone, quietZone, width, height);
    } else {
      context.drawImage(source, quietZone, quietZone, width, height);
    }
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(pixels.data, canvas.width, canvas.height, { inversionAttempts: "attemptBoth" })?.data?.trim() ?? null;
  } catch {
    // Cross-origin images can taint a canvas. Other images and canvases on the
    // page are still scanned, while the native detector remains the preferred
    // path when available.
    return null;
  }
}

function qrSourceDimensions(source: QrVisualSource): { width: number; height: number } {
  if (source instanceof HTMLCanvasElement) return { width: source.width, height: source.height };
  if (source instanceof HTMLImageElement) return { width: source.naturalWidth, height: source.naturalHeight };
  const viewBox = source.viewBox.baseVal;
  const rect = source.getBoundingClientRect();
  return {
    width: source.width.baseVal.value || viewBox.width || rect.width,
    height: source.height.baseVal.value || viewBox.height || rect.height,
  };
}

async function rasterizeSvg(document: Document, source: SVGSVGElement): Promise<HTMLImageElement | null> {
  const view = document.defaultView;
  if (!view) return null;
  const svg = source.cloneNode(true) as SVGSVGElement;
  if (!svg.hasAttribute("xmlns")) svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const blob = new view.Blob([new view.XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" });
  const url = view.URL.createObjectURL(blob);
  const image = document.createElement("img");
  image.src = url;
  try {
    await image.decode();
    return image;
  } catch {
    return null;
  } finally {
    view.URL.revokeObjectURL(url);
  }
}

function isTotpUri(value: string): boolean {
  return /^otpauth:\/\/totp\//i.test(value) && /[?&]secret=[A-Z2-7]+=*/i.test(value);
}

function totpQrCodes(values: string[]): ScannedTotpQrCode[] {
  return uniqueBy(values.map(parseTotpQrCode).filter((value): value is ScannedTotpQrCode => Boolean(value)), (value) => value.uri).slice(0, 20);
}

function parseTotpQrCode(rawValue: string): ScannedTotpQrCode | null {
  try {
    const uri = new URL(rawValue.trim());
    const secret = uri.searchParams.get("secret")?.replace(/\s/g, "") ?? "";
    const algorithm = uri.searchParams.get("algorithm");
    const digits = uri.searchParams.get("digits");
    const period = uri.searchParams.get("period");
    if (uri.protocol.toLocaleLowerCase() !== "otpauth:"
      || uri.hostname.toLocaleLowerCase() !== "totp"
      || !uri.pathname.replace(/^\//, "")
      || uri.searchParams.getAll("secret").length !== 1
      || !/^[A-Z2-7]+=*$/i.test(secret)
      || algorithm && algorithm.toLocaleLowerCase() !== "sha1"
      || digits && digits !== "6"
      || period && period !== "30") return null;
    const label = decodeURIComponent(uri.pathname.replace(/^\//, "")).trim();
    const separator = label.indexOf(":");
    const labelIssuer = separator >= 0 ? label.slice(0, separator).trim() : "";
    const account = (separator >= 0 ? label.slice(separator + 1) : label).trim();
    return {
      uri: rawValue.trim().slice(0, 10_000),
      issuer: (uri.searchParams.get("issuer")?.trim() || labelIssuer).slice(0, 256) || null,
      account: account.slice(0, 2_048) || null,
    };
  } catch {
    return null;
  }
}

function withoutStandaloneTotp(data: CapturedSaveData): CapturedSaveData {
  return { ...data, secrets: data.secrets?.filter((secret) => secret.kind !== "authenticator-key") };
}

function meiguodizhiCapture(document: Document, pageUrl: string): Pick<DetectedPageInformation, "data" | "ignoredSensitiveFields"> | null {
  if (!isMeiguodizhiPage(pageUrl)) return null;
  const fullName = siteValue(document, "Full_Name");
  const name = splitPersonName(fullName);
  const email = siteValue(document, "Temporary_mail");
  const phone = siteValue(document, "Telephone");
  const addressLine1 = siteValue(document, "Address");
  const city = siteValue(document, "City");
  const region = siteValue(document, "State_Full") || siteValue(document, "State");
  const postalCode = siteValue(document, "Zip_Code");
  const organization = withoutPlaceholder(siteValue(document, "Company_Name"));
  const jobTitle = withoutPlaceholder(siteValue(document, "Occupation"));
  const website = httpUrl(siteValue(document, "Website"));
  const birthDate = normalizedBirthDate(siteValue(document, "Birthday"));

  const meaningfulIdentity = Boolean(fullName || email || phone || addressLine1 || organization || jobTitle);
  const identity: CapturedIdentity | undefined = meaningfulIdentity ? {
    title: fullName || email || phone || `${safeHostname(pageUrl)} 地址`,
    firstName: name.firstName,
    middleName: name.middleName,
    lastName: name.lastName,
    birthDate,
    emails: email ? [{ label: "主要", value: email.slice(0, 2_048), preferred: true }] : [],
    phones: phone ? [{ label: "主要", value: phone.slice(0, 2_048), preferred: true }] : [],
    addresses: addressLine1 ? [{
      label: "主要",
      addressLine1: addressLine1.slice(0, 512),
      addressLine2: null,
      city: nullableText(city, 256),
      region: nullableText(region, 256),
      postalCode: nullableText(postalCode, 256),
      countryCode: "US",
      country: "United States",
      preferred: true,
    }] : [],
    organization: nullableText(organization, 256),
    department: null,
    jobTitle: nullableText(jobTitle, 256),
    website,
  } : undefined;

  const username = siteValue(document, "Username");
  const password = siteValue(document, "Password");
  const login = password ? { username: username.slice(0, 2_048), password: password.slice(0, 10_000) } : undefined;

  const cardNumber = siteValue(document, "Credit_Card_Number").replace(/\D/g, "");
  const expiration = parseExpiration(siteValue(document, "Expires"));
  const securityCodeValue = siteValue(document, "CVV2");
  const card = fullName && isLikelyCardNumber(cardNumber) && expiration ? {
    title: `${safeHostname(pageUrl)} •••• ${cardNumber.slice(-4)}`,
    cardholderName: fullName.slice(0, 256),
    cardNumber,
    expirationMonth: expiration.month,
    expirationYear: expiration.year,
    securityCode: /^\d{3,4}$/.test(securityCodeValue) ? securityCodeValue : null,
    pin: /^\d{4,12}$/.test(siteValue(document, "Credit_Card_PIN")) ? siteValue(document, "Credit_Card_PIN") : null,
    issuer: nullableText(siteValue(document, "Credit_Card_Issuer") || siteValue(document, "Bank"), 256),
    network: nullableText(siteValue(document, "Credit_Card_Type") || cardNetworkFromNumber(cardNumber), 256),
    billingAddress: [addressLine1, city, region, postalCode, "United States"].filter(Boolean).join(", ").slice(0, 10_000) || null,
  } : undefined;

  const secrets: CapturedSecret[] = [];
  const socialSecurityNumber = siteValue(document, "Social_Security_Number");
  if (socialSecurityNumber) secrets.push(otherSecret("社会安全号", socialSecurityNumber, "identity-document", "Identity document", pageUrl));
  const identityNumber = siteValue(document, "Chain_ID_Card");
  if (identityNumber) secrets.push(otherSecret("身份证明号码", identityNumber, "identity-document", "Identity document", pageUrl));
  const securityQuestion = siteValue(document, "Security_Question");
  const securityAnswer = siteValue(document, "Security_Answer");
  if (securityQuestion || securityAnswer) {
    secrets.push(otherSecret("安全问题与答案", [`问题：${securityQuestion}`, `答案：${securityAnswer}`].filter((line) => !line.endsWith("：")).join("\n"), "secure-note", "Security question", pageUrl));
  }

  return { data: { login, identity, card, ...(secrets.length ? { secrets } : {}) }, ignoredSensitiveFields: [] };
}

function mergeCapturedData(primary: CapturedSaveData, secondary: CapturedSaveData): CapturedSaveData {
  return {
    login: mergeLogin(primary.login, secondary.login),
    identity: secondary.identity ?? primary.identity,
    card: secondary.card ?? primary.card,
    secrets: uniqueBy([...(primary.secrets ?? []), ...(secondary.secrets ?? [])], (secret) => `${secret.kind}\u0000${secret.secret}`),
    sshCredentials: uniqueBy([...(primary.sshCredentials ?? []), ...(secondary.sshCredentials ?? [])], (ssh) => `${ssh.publicKey ?? ""}\u0000${ssh.privateKey ?? ""}\u0000${ssh.host ?? ""}`),
  };
}

function mergeLogin(primary?: CapturedSaveData["login"], secondary?: CapturedSaveData["login"]): CapturedSaveData["login"] {
  if (!primary) return secondary;
  if (!secondary) return primary;
  return {
    ...primary,
    ...secondary,
    username: secondary.username || primary.username,
    password: secondary.password || primary.password,
    totpSecret: secondary.totpSecret ?? primary.totpSecret,
    additionalUrls: uniqueBy([...(primary.additionalUrls ?? []), ...(secondary.additionalUrls ?? [])], (value) => value),
    customFields: uniqueBy([...(primary.customFields ?? []), ...(secondary.customFields ?? [])], (field) => `${field.label}\u0000${field.value}`),
  };
}

type SensitiveCandidate = { value: string; metadata: string; source: "control" | "code"; group: Element | null };
type SecretMatch = { value: string; kind: CapturedSecret["kind"]; label?: string };

function sensitivePageCapture(document: Document, pageUrl: string): CapturedSaveData {
  const candidates = sensitiveCandidates(document);
  const provider = providerForPage(pageUrl);
  const sshCredentials = capturedSshCredentials(candidates, provider);
  const matchedSecrets = candidates
    .map((candidate) => ({ candidate, match: secretMatch(candidate.value, candidate.metadata), score: secretScore(candidate) }))
    .filter((entry): entry is { candidate: SensitiveCandidate; match: SecretMatch; score: number } => Boolean(entry.match) && entry.score >= 60)
    .sort((left, right) => right.score - left.score)
    .map(({ candidate, match }) => ({
      title: `${provider} ${match.label ?? secretKindLabel(match.kind)}`.slice(0, 256),
      kind: match.kind,
      secret: match.value.slice(0, 10_000),
      provider: provider.slice(0, 256),
      account: relatedIdentifier(candidates, candidate.value),
      environment: environmentFromMetadata(candidate.metadata),
      scopes: relatedScopes(candidates, candidate),
      expiresAt: relatedExpiration(candidates, candidate),
      website: httpUrl(pageUrl),
    }));
  const secrets = consolidateSecurityQuestionAnswers(matchedSecrets, candidates, provider, pageUrl);
  return {
    ...(secrets.length ? { secrets: uniqueBy(secrets, (secret) => `${secret.kind}\u0000${secret.secret}`).slice(0, 100) } : {}),
    ...(sshCredentials.length ? { sshCredentials: sshCredentials.slice(0, 50) } : {}),
  };
}

function consolidateSecurityQuestionAnswers(secrets: CapturedSecret[], candidates: SensitiveCandidate[], provider: string, pageUrl: string): CapturedSecret[] {
  const question = candidates.find((candidate) => /security[\s_-]*question|密保问题|安全问题/i.test(candidate.metadata));
  const answer = candidates.find((candidate) => /security[\s_-]*answer|密保答案|安全问题答案/i.test(candidate.metadata));
  if (!question || !answer) return secrets;
  return [
    ...secrets.filter((secret) => secret.kind !== "secure-note" || ![question.value, answer.value].includes(secret.secret)),
    {
      title: `${provider} 安全问题与答案`.slice(0, 256), kind: "secure-note",
      secret: `问题：${question.value}\n答案：${answer.value}`.slice(0, 10_000), provider,
      account: null, environment: null, scopes: [], expiresAt: null, website: httpUrl(pageUrl),
    },
  ];
}

function sensitiveCandidates(document: Document): SensitiveCandidate[] {
  const elements = Array.from(document.querySelectorAll<HTMLElement>(
    'input:not([type="hidden"]),textarea,code,pre,clipboard-copy,[data-clipboard-text]',
  )).slice(0, 500);
  const seen = new Set<string>();
  const candidates: SensitiveCandidate[] = [];
  for (const element of elements) {
    if (element.hidden || element.getAttribute("aria-hidden") === "true") continue;
    const value = sensitiveElementValue(element);
    if (!value || value.length > 200_000 || seen.has(value)) continue;
    seen.add(value);
    candidates.push({
      value,
      metadata: sensitiveElementMetadata(element, value, document.title),
      source: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? "control" : "code",
      group: element.closest("fieldset,section,article,li,tr,form"),
    });
  }
  return candidates;
}

function sensitiveElementValue(element: HTMLElement): string {
  const attributeValue = element.getAttribute("data-clipboard-text") ?? (element.tagName.toLocaleLowerCase() === "clipboard-copy" ? element.getAttribute("value") : null);
  const value = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
    ? element.value
    : attributeValue ?? element.textContent ?? "";
  return value.replace(/\r\n/g, "\n").trim();
}

function sensitiveElementMetadata(element: HTMLElement, value: string, pageTitle: string): string {
  const labels = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
    ? Array.from(element.labels ?? []).map((label) => label.textContent ?? "")
    : [];
  const parentText = nearestDescriptiveAncestorText(element, value);
  return [
    pageTitle,
    ...labels,
    element.getAttribute("aria-label") ?? "",
    element.getAttribute("name") ?? "",
    element.id,
    element.className,
    element.getAttribute("placeholder") ?? "",
    parentText,
  ].join(" ").replace(/\s+/g, " ").trim().slice(0, 2_000);
}

function nearestDescriptiveAncestorText(element: HTMLElement, value: string): string {
  let ancestor = element.parentElement;
  for (let depth = 0; ancestor && depth < 5 && !ancestor.matches("body,html"); depth += 1, ancestor = ancestor.parentElement) {
    const text = (ancestor.textContent ?? "")
      .replace(value, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) return text.slice(0, 800);
  }
  return "";
}

function secretMatch(rawValue: string, metadata: string): SecretMatch | null {
  if (ephemeralCredentialMetadata(metadata)) return null;
  const otpauth = rawValue.match(/otpauth:\/\/totp\/[^\s"'<>]+/i)?.[0];
  if (otpauth && /[?&]secret=[A-Z2-7]+=*/i.test(otpauth)) return { value: otpauth, kind: "authenticator-key", label: "TOTP 验证器" };
  const databaseUrl = rawValue.match(/(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqp|amqps):\/\/[^\s"'<>]+/i)?.[0];
  if (databaseUrl && !looksLikeExplicitPlaceholder(databaseUrl)) return { value: databaseUrl, kind: "database-credential", label: "数据库连接串" };
  const jwt = rawValue.match(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/)?.[0];
  if (jwt && !looksLikePlaceholder(jwt)) return { value: jwt, kind: "access-token", label: "JWT" };
  const bearer = rawValue.match(/\bBearer\s+([A-Za-z0-9._~+/-]{16,}=*)/i)?.[1];
  if (bearer && !looksLikePlaceholder(bearer)) return { value: bearer, kind: "access-token", label: "Bearer Token" };
  const serviceAccount = serviceAccountJson(rawValue);
  if (serviceAccount) return { value: serviceAccount, kind: "client-secret", label: "服务账号 JSON" };
  const certificate = certificateBundle(rawValue, metadata);
  if (certificate) return { value: certificate, kind: "certificate", label: "证书或 PEM 密钥" };
  const recoveryCodes = recoveryCodeBundle(rawValue, metadata);
  if (recoveryCodes) return { value: recoveryCodes, kind: "recovery-codes", label: "恢复码" };
  const seedPhrase = walletSeedPhrase(rawValue, metadata);
  if (seedPhrase) return { value: seedPhrase, kind: "crypto-wallet", label: "钱包助记词（高风险）" };
  const identityDocument = identityDocumentValue(rawValue, metadata);
  if (identityDocument) return { value: identityDocument, kind: "identity-document", label: "身份证件" };
  const secureNote = secureNoteValue(rawValue, metadata);
  if (secureNote) return { value: secureNote, kind: "secure-note", label: "安全笔记" };
  if (/webhook|callback signing|签名/i.test(metadata)) {
    const webhookUrl = rawValue.match(/https:\/\/[^\s"'<>]+/)?.[0];
    if (webhookUrl && !looksLikeExplicitPlaceholder(webhookUrl)) return { value: webhookUrl, kind: "webhook-secret", label: "Webhook 地址" };
  }
  const knownPatterns: Array<[RegExp, CapturedSecret["kind"]]> = [
    [/(?:github_pat_|gh[pousr]_)[A-Za-z0-9._-]{20,}/, "access-token"],
    [/ghs_[A-Za-z0-9._-]{20,}/, "access-token"],
    [/glpat-[A-Za-z0-9_-]{20,}/, "access-token"],
    [/xox[baprs]-[A-Za-z0-9-]{16,}/, "access-token"],
    [/(?:sk|rk)_(?:live|test)_[A-Za-z0-9_]{16,}/, "api-key"],
    [/sk-(?:proj-)?[A-Za-z0-9_-]{20,}/, "api-key"],
    [/AIza[0-9A-Za-z_-]{30,}/, "api-key"],
    [/whsec_[A-Za-z0-9_-]{16,}/, "webhook-secret"],
    [/npm_[A-Za-z0-9]{30,}/, "access-token"],
    [/pypi-[A-Za-z0-9_-]{30,}/, "access-token"],
    [/SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/, "api-key"],
    [/dop_v1_[A-Fa-f0-9]{32,}/, "access-token"],
    [/hf_[A-Za-z0-9]{20,}/, "access-token"],
    [/hvs\.[A-Za-z0-9_-]{20,}/, "access-token"],
    [/(?:shpat|shpca|shppa|shpss)_[A-Fa-f0-9]{24,}/, "access-token"],
    [/(?:sbp|sb_secret)_[A-Za-z0-9_-]{20,}/, "api-key"],
  ];
  for (const [pattern, kind] of knownPatterns) {
    const match = rawValue.match(pattern);
    if (match && !looksLikePlaceholder(match[0])) return { value: match[0], kind };
  }
  const value = normalizedSingleLineSecret(rawValue);
  if (value && /license|licence|activation|product.?key|serial|许可证|激活码|序列号/i.test(metadata) && looksLikeLicenseKey(value)) {
    return { value, kind: "software-license", label: "软件许可证" };
  }
  if (!value || !sensitiveMetadata(metadata) || !looksLikeSecretValue(value)) return null;
  return { value, kind: secretKindFromMetadata(metadata) };
}

function secretScore(candidate: SensitiveCandidate): number {
  const known = /(?:github_pat_|gh[pousr]_|ghs_|glpat-|xox[baprs]-|(?:sk|rk)_(?:live|test)_|sk-(?:proj-)?|AIza|whsec_|npm_|pypi-|SG\.|dop_v1_|hf_|hvs\.|(?:shpat|shpca|shppa|shpss)_|(?:sbp|sb_secret)_)/;
  let score = 0;
  if (known.test(candidate.value)) score += 100;
  if (/otpauth:\/\/totp\/|(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqp|amqps):\/\/|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.|-----BEGIN CERTIFICATE-----/.test(candidate.value)) score += 100;
  if (serviceAccountJson(candidate.value) || recoveryCodeBundle(candidate.value, candidate.metadata) || walletSeedPhrase(candidate.value, candidate.metadata)
    || identityDocumentValue(candidate.value, candidate.metadata) || secureNoteValue(candidate.value, candidate.metadata)) score += 100;
  if (strongSensitiveMetadata(candidate.metadata)) score += 70;
  else if (sensitiveMetadata(candidate.metadata)) score += 45;
  if (candidate.source === "control") score += 20;
  if (looksLikeSecretValue(normalizedSingleLineSecret(candidate.value) ?? "")) score += 20;
  if (candidate.source === "code" && /example|sample|示例|文档|documentation/i.test(candidate.metadata)) score -= 60;
  return score;
}

function capturedSshCredentials(candidates: SensitiveCandidate[], provider: string): CapturedSshCredential[] {
  const materials = candidates.map((candidate) => ({ candidate, privateKey: sshPrivateKeyFrom(candidate.value, candidate.metadata), publicKey: publicKeyFrom(candidate.value) }))
    .filter((entry) => entry.privateKey || entry.publicKey);
  if (!materials.length) return [];
  const related = materials[0]?.candidate.group ? candidates.filter((candidate) => candidate.group === materials[0]!.candidate.group) : candidates;
  const host = relatedShortValue(related, /\b(?:ssh[ _-]?)?host(?:name)?\b|服务器|主机/i, /private|public|key|密钥/i);
  const username = relatedShortValue(related, /\b(?:ssh[ _-]?)?(?:user|username)\b|登录用户|用户名/i, /private|public|key|密钥/i) ?? "";
  const portValue = relatedShortValue(related, /\b(?:ssh[ _-]?)?port\b|端口/i);
  const port = portValue && /^\d{1,5}$/.test(portValue) && Number(portValue) <= 65_535 ? Number(portValue) : 22;
  const keyPassphrase = relatedSecretValue(related, /passphrase|key.?password|密钥口令|私钥密码/i);
  const password = relatedSecretValue(related, /ssh.?password|服务器密码/i);
  const make = (publicKey: string | null, privateKey: string | null, suffix = ""): CapturedSshCredential => ({
    title: `${provider} SSH 密钥${suffix}`.slice(0, 256), host, port, username, password, publicKey, privateKey, keyPassphrase,
  });
  if (materials.length <= 2) {
    const publicKey = materials.find((entry) => entry.publicKey)?.publicKey ?? null;
    const privateKey = materials.find((entry) => entry.privateKey)?.privateKey ?? null;
    return [make(publicKey, privateKey)];
  }
  return uniqueBy(materials.map((entry, index) => make(entry.publicKey, entry.privateKey, ` ${index + 1}`)), (ssh) => `${ssh.publicKey ?? ""}\u0000${ssh.privateKey ?? ""}`);
}

function sshPrivateKeyFrom(value: string, metadata: string): string | null {
  const match = value.match(/-----BEGIN ((?:OPENSSH |RSA |EC |DSA |ED25519 |ENCRYPTED )?PRIVATE KEY)-----[\s\S]+?-----END \1-----/);
  if (!match) return null;
  if (!/OPENSSH/i.test(match[1] ?? "") && !/ssh|deploy.?key|服务器|主机/i.test(metadata)) return null;
  return match[0].slice(0, 200_000);
}

function publicKeyFrom(value: string): string | null {
  const openssh = value.match(/(?:^|\n)((?:ssh-(?:rsa|ed25519)|ecdsa-sha2-nistp\d+)\s+[A-Za-z0-9+/=]+(?:\s+[^\r\n]+)?)(?:$|\n)/);
  if (openssh?.[1]) return openssh[1].trim().slice(0, 200_000);
  const pem = value.match(/-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/);
  return pem?.[0].slice(0, 200_000) ?? null;
}

function normalizedSingleLineSecret(value: string): string | null {
  const normalized = value.trim().replace(/^[`'\"]|[`'\"]$/g, "");
  return normalized && !/[\r\n\s]/.test(normalized) ? normalized.slice(0, 10_000) : null;
}

function looksLikeSecretValue(value: string): boolean {
  if (value.length < 16 || value.length > 10_000 || looksLikePlaceholder(value)) return false;
  if (/^(?:https?:\/\/|www\.)/i.test(value) || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) || /^\d+$/.test(value)) return false;
  const classes = [/[a-z]/.test(value), /[A-Z]/.test(value), /\d/.test(value), /[-_./+=]/.test(value)].filter(Boolean).length;
  return classes >= 2 && new Set(value).size >= 8;
}

function looksLikePlaceholder(value: string): boolean {
  return /your[_-]?(?:token|key|secret)|replace[_-]?me|example|sample|<[^>]+>|\*{4,}|x{8,}/i.test(value);
}

function looksLikeExplicitPlaceholder(value: string): boolean {
  return /your[_-]?(?:token|key|secret)|replace[_-]?me|<[^>]+>|\*{4,}|x{8,}/i.test(value);
}

function sensitiveMetadata(metadata: string): boolean {
  return /api[\s_-]*key|access[\s_-]*token|personal[\s_-]*access[\s_-]*token|client[\s_-]*secret|webhook[\s_-]*(?:secret|url)|secret[\s_-]*(?:access[\s_-]*)?(?:key|value|token)|token[\s_-]*value|license|licence|activation|product.?key|recovery.?code|backup.?code|seed.?phrase|mnemonic|private.?key|certificate|密钥|令牌|许可证|激活码|恢复码|助记词|证书/i.test(metadata);
}

function strongSensitiveMetadata(metadata: string): boolean {
  return /api[\s_-]*key|access[\s_-]*token|personal[\s_-]*access[\s_-]*token|client[\s_-]*secret|webhook[\s_-]*secret|secret[\s_-]*(?:access[\s_-]*)?(?:key|value|token)|密钥值|访问令牌/i.test(metadata);
}

function relatedIdentifier(candidates: SensitiveCandidate[], selectedValue: string): string | null {
  const selected = candidates.find((candidate) => candidate.value === selectedValue);
  for (const candidate of candidates) {
    if (selected?.group && candidate.group !== selected.group) continue;
    if (candidate.value === selectedValue || !/(?:client|application|access|api|key|account)[\s_-]*id|fingerprint|serial[\s_-]*(?:number|no)|客户端[\s_-]*ID|应用[\s_-]*ID|指纹|序列号/i.test(candidate.metadata)) continue;
    const value = normalizedSingleLineSecret(candidate.value);
    if (value && value.length <= 256 && !looksLikePlaceholder(value)) return value;
  }
  return null;
}

function relatedScopes(candidates: SensitiveCandidate[], selected: SensitiveCandidate): string[] {
  const scopeCandidate = candidates.find((candidate) => candidate !== selected && (!selected.group || candidate.group === selected.group) && /scope|permission|权限|授权范围/i.test(candidate.metadata));
  if (!scopeCandidate || scopeCandidate.value.length > 2_000) return [];
  return uniqueBy(scopeCandidate.value.split(/[\s,;\n]+/).map((value) => value.trim()).filter((value) => /^[\w:./-]{2,256}$/.test(value) && !/scope|permission|权限/i.test(value)), (value) => value).slice(0, 50);
}

function relatedExpiration(candidates: SensitiveCandidate[], selected: SensitiveCandidate): string | null {
  const expiration = candidates.find((candidate) => candidate !== selected && (!selected.group || candidate.group === selected.group) && /expir|valid.?until|到期|过期|有效期/i.test(candidate.metadata));
  return expiration ? normalizedDate(expiration.value) : null;
}

function secretKindFromMetadata(metadata: string): CapturedSecret["kind"] {
  if (/database|connection.?string|dsn|数据库|连接串/i.test(metadata)) return "database-credential";
  if (/recovery.?codes?|backup.?codes?|恢复码|备用代码/i.test(metadata)) return "recovery-codes";
  if (/certificate|pem|证书/i.test(metadata)) return "certificate";
  if (/license|licence|activation|product.?key|许可证|激活码/i.test(metadata)) return "software-license";
  if (/identity|passport|social.?security|身份证|护照|证件/i.test(metadata)) return "identity-document";
  if (/security.?(?:question|answer)|secure.?note|安全问题|安全笔记/i.test(metadata)) return "secure-note";
  if (/wallet|seed.?phrase|mnemonic|钱包|助记词/i.test(metadata)) return "crypto-wallet";
  if (/webhook/i.test(metadata)) return "webhook-secret";
  if (/client/i.test(metadata)) return "client-secret";
  if (/access|personal|token|访问令牌/i.test(metadata)) return "access-token";
  if (/authenticator|认证/i.test(metadata)) return "authenticator-key";
  if (/api/i.test(metadata)) return "api-key";
  return "other";
}

function secretKindLabel(kind: CapturedSecret["kind"]): string {
  return kind === "api-key" ? "API Key"
    : kind === "access-token" ? "访问令牌"
      : kind === "authenticator-key" ? "认证密钥"
        : kind === "client-secret" ? "客户端密钥"
          : kind === "webhook-secret" ? "Webhook 密钥"
            : kind === "database-credential" ? "数据库凭据"
              : kind === "recovery-codes" ? "恢复码"
                : kind === "certificate" ? "证书与 PEM"
                  : kind === "software-license" ? "软件许可证"
                    : kind === "identity-document" ? "身份证件"
                      : kind === "secure-note" ? "安全笔记"
                        : kind === "crypto-wallet" ? "加密钱包"
                          : "密钥";
}

function environmentFromMetadata(metadata: string): string | null {
  return /\bproduction\b|\bprod\b|生产/i.test(metadata) ? "Production"
    : /\bstaging\b|预发布/i.test(metadata) ? "Staging"
      : /\bdevelopment\b|\bdev\b|开发/i.test(metadata) ? "Development"
        : /\btest\b|测试/i.test(metadata) ? "Test"
          : null;
}

function attachLoginEnhancements(data: CapturedSaveData, document: Document, pageUrl: string): CapturedSaveData {
  const candidates = sensitiveCandidates(document);
  const totp = data.secrets?.find((secret) => secret.kind === "authenticator-key" && (/^otpauth:\/\/totp\//i.test(secret.secret) || /^[A-Z2-7]{16,}=*$/i.test(secret.secret)));
  const customFields = candidates
    .filter((candidate) => /\b(?:client|application|project|account|tenant|organization)[ _-]*id\b|客户端ID|应用ID|项目ID|租户ID/i.test(candidate.metadata))
    .map((candidate) => ({ label: identifierLabel(candidate.metadata), value: candidate.value.slice(0, 10_000) }))
    .filter((field) => field.value.length > 0 && field.value.length <= 10_000 && !looksLikePlaceholder(field.value));
  const additionalUrls = candidates
    .filter((candidate) => /additional.?url|login.?url|sign.?in.?url|附加网址|登录地址/i.test(candidate.metadata))
    .map((candidate) => httpUrl(candidate.value))
    .filter((value): value is string => Boolean(value));
  if (!data.login) return data;
  const login = {
    ...data.login,
    title: data.login.title ?? providerForPage(pageUrl),
    url: data.login.url ?? httpUrl(pageUrl),
    totpSecret: data.login.totpSecret ?? totp?.secret ?? null,
    additionalUrls: uniqueBy([...(data.login.additionalUrls ?? []), ...additionalUrls], (value) => value).filter((value) => value !== httpUrl(pageUrl)).slice(0, 20),
    customFields: uniqueBy([...(data.login.customFields ?? []), ...customFields], (field) => `${field.label}\u0000${field.value}`).slice(0, 50),
  };
  return { ...data, login, secrets: data.secrets?.filter((secret) => secret.kind !== "authenticator-key") };
}

function serviceAccountJson(value: string): string | null {
  if (value.length > 10_000 || !value.trim().startsWith("{")) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const hasPrivateMaterial = typeof parsed.private_key === "string" || typeof parsed.client_secret === "string" || typeof parsed.privateKey === "string";
    const hasAccountIdentity = typeof parsed.client_email === "string" || typeof parsed.client_id === "string" || typeof parsed.project_id === "string" || typeof parsed.tenant_id === "string";
    return hasPrivateMaterial && hasAccountIdentity ? value.trim() : null;
  } catch {
    return null;
  }
}

function certificateBundle(value: string, metadata: string): string | null {
  if (value.length > 10_000 || /OPENSSH/i.test(value) || /\bssh\b/i.test(metadata)) return null;
  const certificate = value.match(/-----BEGIN (?:CERTIFICATE|PKCS7|PKCS12|RSA PRIVATE KEY|EC PRIVATE KEY|ENCRYPTED PRIVATE KEY)-----[\s\S]+?-----END (?:CERTIFICATE|PKCS7|PKCS12|RSA PRIVATE KEY|EC PRIVATE KEY|ENCRYPTED PRIVATE KEY)-----/);
  return certificate?.[0].slice(0, 10_000) ?? null;
}

function recoveryCodeBundle(value: string, metadata: string): string | null {
  if (!/recovery.?codes?|backup.?codes?|备用代码|恢复码|备份码/i.test(metadata) || value.length > 10_000) return null;
  const lines = value.split(/\r?\n|\s{2,}/).map((line) => line.trim()).filter(Boolean);
  const codeLines = lines.filter((line) => /^[A-Za-z0-9][A-Za-z0-9-]{5,31}$/.test(line) && !looksLikePlaceholder(line));
  return codeLines.length >= 2 ? uniqueBy(codeLines, (line) => line).join("\n") : null;
}

function walletSeedPhrase(value: string, metadata: string): string | null {
  if (!/seed.?phrase|recovery.?phrase|mnemonic|助记词|钱包恢复词/i.test(metadata) || value.length > 1_000) return null;
  const words = value.trim().split(/\s+/);
  return [12, 15, 18, 21, 24].includes(words.length) && words.every((word) => /^[\p{L}]+$/u.test(word)) ? words.join(" ") : null;
}

function identityDocumentValue(value: string, metadata: string): string | null {
  if (!/passport|social[\s_-]*security|\bssn\b|national[\s_-]*id|driver'?s[\s_-]*licen[cs]e|身份证|护照|社会安全号|证件(?:号|号码)|驾照/i.test(metadata)) return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 256 && !looksLikeExplicitPlaceholder(normalized) ? normalized : null;
}

function secureNoteValue(value: string, metadata: string): string | null {
  if (!/secure[\s_-]*note|security[\s_-]*(?:question|answer)|安全笔记|安全问题|密保问题|密保答案/i.test(metadata)) return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 10_000 && !looksLikeExplicitPlaceholder(normalized) ? normalized : null;
}

function ephemeralCredentialMetadata(metadata: string): boolean {
  return /session.?cookie|csrf|xsrf|oauth.?authorization.?code|authorization.?code|temporary.?code|会话.?cookie|临时授权码/i.test(metadata);
}

function looksLikeLicenseKey(value: string): boolean {
  return value.length >= 8 && value.length <= 256 && /^[A-Za-z0-9][A-Za-z0-9._/-]*(?:-[A-Za-z0-9._/-]+)+$/.test(value) && !looksLikePlaceholder(value);
}

function relatedShortValue(candidates: SensitiveCandidate[], label: RegExp, reject?: RegExp): string | null {
  const candidate = candidates.find((entry) => label.test(entry.metadata) && (!reject || !reject.test(entry.metadata.replace(label, ""))));
  const value = candidate?.value.trim() ?? "";
  return value && value.length <= 2_048 && !looksLikeExplicitPlaceholder(value) ? value : null;
}

function relatedSecretValue(candidates: SensitiveCandidate[], label: RegExp): string | null {
  const candidate = candidates.find((entry) => label.test(entry.metadata) && entry.value.length <= 10_000 && !looksLikePlaceholder(entry.value));
  return candidate?.value ?? null;
}

function normalizedDate(value: string): string | null {
  const match = value.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})|(?:\b)(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:\b)/);
  if (!match) return null;
  const year = Number(match[1] ?? match[6]);
  const month = Number(match[2] ?? match[4]);
  const day = Number(match[3] ?? match[5]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`
    : null;
}

function identifierLabel(metadata: string): string {
  const match = metadata.match(/(?:client|application|project|account|tenant|organization)[ _-]*id|客户端ID|应用ID|项目ID|租户ID/i)?.[0];
  return (match || "标识符").replace(/[_-]+/g, " ").slice(0, 256);
}

function otherSecret(title: string, secret: string, kind: CapturedSecret["kind"], provider: string, pageUrl: string): CapturedSecret {
  return { title, kind, secret: secret.slice(0, 10_000), provider, account: null, environment: null, scopes: [], expiresAt: null, website: httpUrl(pageUrl) };
}

function cardNetworkFromNumber(number: string): string {
  if (/^4/.test(number)) return "Visa";
  if (/^(?:5[1-5]|2(?:2[2-9]|[3-6]\d|7[01]|720))/.test(number)) return "Mastercard";
  if (/^3[47]/.test(number)) return "American Express";
  if (/^(?:6011|65|64[4-9])/.test(number)) return "Discover";
  if (/^35/.test(number)) return "JCB";
  if (/^62/.test(number)) return "UnionPay";
  return "";
}

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const identity = key(value);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function providerForPage(pageUrl: string): string {
  try {
    const hostname = new URL(pageUrl).hostname.toLocaleLowerCase().replace(/^www\./, "");
    const known: Record<string, string> = {
      "github.com": "GitHub",
      "gitlab.com": "GitLab",
      "platform.openai.com": "OpenAI",
      "api.slack.com": "Slack",
      "dashboard.stripe.com": "Stripe",
      "console.cloud.google.com": "Google Cloud",
      "console.aws.amazon.com": "AWS",
    };
    return known[hostname] ?? (hostname.slice(0, 256) || "网站");
  } catch {
    return "网站";
  }
}

function siteValue(document: Document, field: string): string {
  const control = document.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`.data_${field}`);
  return control?.value.trim().slice(0, 10_000) ?? "";
}

function isMeiguodizhiPage(pageUrl: string): boolean {
  try {
    const hostname = new URL(pageUrl).hostname.toLocaleLowerCase();
    return hostname === "meiguodizhi.com" || hostname.endsWith(".meiguodizhi.com");
  } catch {
    return false;
  }
}

function splitPersonName(value: string): Pick<CapturedIdentity, "firstName" | "middleName" | "lastName"> {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return { firstName: null, middleName: null, lastName: null };
  if (/^[\u3400-\u9fff]{2,4}$/.test(normalized)) {
    return { firstName: normalized.slice(1), middleName: null, lastName: normalized.slice(0, 1) };
  }
  const parts = normalized.split(" ");
  if (parts.length === 1) return { firstName: parts[0]!.slice(0, 256), middleName: null, lastName: null };
  return {
    firstName: parts[0]!.slice(0, 256),
    middleName: parts.length > 2 ? parts.slice(1, -1).join(" ").slice(0, 256) : null,
    lastName: parts[parts.length - 1]!.slice(0, 256),
  };
}

function normalizedBirthDate(value: string): string | null {
  const match = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$|^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (!match) return null;
  const year = Number(match[1] ?? match[6]);
  const month = Number(match[2] ?? match[4]);
  const day = Number(match[3] ?? match[5]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function parseExpiration(value: string): { month: number; year: number } | null {
  const match = value.match(/^(\d{1,2})\D+(\d{2,4})$|^(\d{4})-(\d{1,2})$/);
  if (!match) return null;
  const month = Number(match[1] ?? match[4]);
  let year = Number(match[2] ?? match[3]);
  if (year > 0 && year < 100) year += 2_000;
  return month >= 1 && month <= 12 && year >= new Date().getFullYear() && year <= new Date().getFullYear() + 30 ? { month, year } : null;
}

function isLikelyCardNumber(number: string): boolean {
  if (!/^\d{12,19}$/.test(number)) return false;
  let sum = 0;
  let double = false;
  for (let index = number.length - 1; index >= 0; index -= 1) {
    let digit = Number(number[index]);
    if (double && (digit *= 2) > 9) digit -= 9;
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function withoutPlaceholder(value: string): string {
  return /^(无|none|n\/a)$/i.test(value) ? "" : value;
}

function nullableText(value: string, maximum: number): string | null {
  return value ? value.slice(0, maximum) : null;
}

function httpUrl(value: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href.slice(0, 2_048) : null;
  } catch {
    return null;
  }
}

function safeHostname(pageUrl: string): string {
  try { return new URL(pageUrl).hostname.slice(0, 256) || "网站"; } catch { return "网站"; }
}
