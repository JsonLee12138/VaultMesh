import type { ContentMessage, FieldDescriptor, PageContext } from "@/lib/protocol";
import { createUuid } from "@/lib/uuid";

type NativeControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
export type SupportedControl = NativeControl | HTMLElement;
type DiscoveryRoot = Document | ShadowRoot;
export type AutofillFieldKind = "login" | "card" | "identity" | "secret" | "ssh";
export type PasswordFieldPurpose = "current" | "new";

const MAX_FIELDS = 300;
const MAX_OPTIONS = 200;
const CONTROL_READY_TIMEOUT_MS = 3_000;
const CONTROL_READY_POLL_MS = 50;
const CHARACTER_DELAY_MS = 32;
const FIELD_DELAY_MS = 120;
const TEXT_INPUT_TYPES = new Set(["", "text", "email", "tel", "url", "search", "password", "number", "month", "date", "datetime-local", "time"]);
// Password and payment controls are discovered without values. The desktop
// disclosure policy decides whether a selected login/card may populate them.
const SENSITIVE_METADATA = /\b(ssn|social[\s-]?security|tax|passport|national[\s-]?id|government|driver[\s-]?licen[cs]e)\b|身份证|护照/i;
const CURRENT_PASSWORD_METADATA = /\b(current|old|existing|previous|login)\s*[\s_-]*pass(word|code)\b|当前密码|原密码|旧密码|登录密码/i;
const NEW_PASSWORD_METADATA = /\b(new|set|create|choose|reset|confirm|repeat|verify|re[\s_-]*enter)\s*[\s_-]*pass(word|code)\b|password[\s_-]*(confirmation|confirm)|新密码|设置密码|创建密码|重置密码|确认密码|再次(?:输入)?密码|重复密码/i;
const CONFIRM_PASSWORD_METADATA = /\b(confirm|repeat|verify|re[\s_-]*enter)\s*[\s_-]*pass(word|code)\b|password[\s_-]*(confirmation|confirm)|确认密码|再次(?:输入)?密码|重复密码/i;
const SIGNUP_PASSWORD_CONTEXT = /\b(sign[\s_-]*up|register|registration|create\s+(an?\s+)?account|join\s+now)\b|注册|创建账号|创建账户/i;
const NEW_PASSWORD_CONTEXT = /\b(sign[\s_-]*up|register|registration|create\s+(an?\s+)?account|reset\s+pass(word|code)|set\s+(a\s+)?new\s+pass(word|code))\b|注册|创建账号|设置新密码|重置密码|找回密码/i;
const OTP_METADATA = /\b(?:otp|totp|2fa|mfa)\b|one[\s_-]?time[\s_-]?(?:code|password|passcode|token)|(?:verification|authentication|authenticator)[\s_-]?(?:code|passcode|token|pin)|two[\s_-]?factor|验证码|动态码|认证码/i;

export function discoverFields(root: DiscoveryRoot) {
  const handles = new Map<string, SupportedControl>();
  const descriptors: FieldDescriptor[] = [];
  const controls = composedControls(root)
    .filter(isSupportedControl)
    .map((control, index) => ({ control, index, priority: discoveryPriority(control) }))
    .sort((left, right) => right.priority - left.priority || left.index - right.index)
    .slice(0, MAX_FIELDS);

  for (const { control } of controls) {

    const descriptor = buildDescriptor(control);
    if (!descriptor) {
      continue;
    }

    handles.set(descriptor.handle, control);
    descriptors.push(descriptor);
  }

  return { handles, descriptors };
}

function discoveryPriority(control: SupportedControl) {
  if (classifyControl(control)) return 3;
  if (control.closest('form,[role="form"],dialog,[role="dialog"]')) return 2;
  return 1;
}

export function documentHttpOrigin(document: Document) {
  const ownOrigin = document.defaultView?.location.origin ?? "";
  if (isHttpOrigin(ownOrigin)) return ownOrigin;
  try {
    const topOrigin = document.defaultView?.top?.location.origin ?? "";
    return isHttpOrigin(topOrigin) ? topOrigin : ownOrigin;
  } catch {
    return ownOrigin;
  }
}

export function classifyControl(control: Element): AutofillFieldKind | null {
  if (!isControlElement(control) || !isSupportedControl(control)) return null;
  const metadata = getMetadata(control);
  const tokens = metadata.autocomplete;
  const text = [metadata.label, metadata.name, metadata.id, metadata.placeholder].join(" ");
  const context = pageContextForControl(control);
  if (/private[\s_-]*key|public[\s_-]*key|ssh[\s_-]*(key|user|password|host|port)|passphrase|authorized[\s_-]*keys|私钥|公钥|私钥口令/i.test(text)) return "ssh";
  if (context === "ssh-console" && /\bhost(?:name)?\b|\bserver\b|\bport\b|主机|服务器|端口/i.test(text)) return "ssh";
  if (/api[\s_-]*key|access[\s_-]*token|client[\s_-]*secret|webhook[\s_-]*(secret|token)|bearer[\s_-]*token|authenticator[\s_-]*(key|secret)|接口密钥|访问令牌|客户端密钥|认证密钥/i.test(text)) return "secret";
  if (context === "otp") return "login";
  if (tokens.some((token) => token.startsWith("cc-")) || /card.?number|card.?holder|cvv|cvc|security.?code|expir|billing.?address|卡号|持卡人|安全码|有效期|账单地址/i.test(text)) return "card";
  // Once a form is explicitly identified as a developer-secret or SSH form,
  // its supporting account/password fields belong to that item type rather
  // than to the generic login classifier below.
  if (context === "developer-secret") return "secret";
  if (context === "ssh-console") return "ssh";
  if (OTP_METADATA.test(text)) return "login";
  if (control instanceof HTMLInputElement && control.type === "password") return "login";
  if (tokens.includes("username") || tokens.includes("current-password") || tokens.includes("one-time-code") || /user(name)?|login|account|用户名|账号|密码/i.test(text)) return "login";
  const form = control.closest("form");
  // An email next to a password is the account identifier for that credential,
  // including on signup forms. Treating signup email as identity data makes the
  // inline menu offer personal-profile records instead of login/generator UI.
  if ((tokens.includes("email") || control instanceof HTMLInputElement && control.type === "email") && form?.querySelector('input[type="password"], input[autocomplete~="current-password"]')) return "login";
  if (tokens.some((token) => IDENTITY_AUTOCOMPLETE.has(token)) || /name|e-?mail|phone|tel|address|city|state|province|postal|zip|country|department|姓名|邮箱|电话|手机|地址|城市|省|邮编|国家|部门/i.test(text)) return "identity";
  return null;
}

export function pageContextForFields(fields: FieldDescriptor[]): PageContext {
  const priority: PageContext[] = ["password-change", "signup", "password-reset", "otp", "login", "checkout", "developer-secret", "ssh-console", "profile", "unknown"];
  return priority.find((context) => fields.some((field) => field.context === context)) ?? "unknown";
}

export function pageContextForControl(control: SupportedControl): PageContext {
  const contextualParent = control.parentElement && !control.parentElement.matches('body,html') ? control.parentElement : control;
  const container = control.closest("form") ?? control.closest('[role="form"],dialog,[role="dialog"]') ?? contextualParent;
  const controlMetadata = getMetadata(control);
  // A verification-code control can remain inside the same form as an earlier
  // signup or password-reset step. Its own semantics must win over stale
  // new-password controls elsewhere in that form, otherwise focusing an OTP
  // digit opens the generated-credential menu.
  if (controlMetadata.autocomplete.includes("one-time-code") || OTP_METADATA.test(metadataText(controlMetadata))) return "otp";
  const text = `${metadataText(controlMetadata)} ${limit(container?.textContent ?? "", 2_000)}`;
  const passwords = container ? Array.from(container.querySelectorAll<HTMLInputElement>('input[type="password"]')).filter(isSupportedControl) : [];
  const hasCurrent = passwords.some((entry) => getMetadata(entry).autocomplete.includes("current-password") || CURRENT_PASSWORD_METADATA.test(metadataText(getMetadata(entry))));
  const hasNew = passwords.some((entry) => getMetadata(entry).autocomplete.includes("new-password") || NEW_PASSWORD_METADATA.test(metadataText(getMetadata(entry))));
  if (hasCurrent && hasNew) return "password-change";
  if (hasNew && /sign[\s_-]*up|register|registration|create\s+(an?\s+)?account|join\s+now|注册|创建账号|创建账户/i.test(text)) return "signup";
  if (hasNew && /reset|forgot|recover|set\s+(a\s+)?new\s+pass|重置|找回|忘记密码/i.test(text)) return "password-reset";
  if (hasNew && container?.querySelector('[autocomplete~="name"],[autocomplete~="given-name"],[autocomplete~="family-name"],[autocomplete~="tel"]')) return "signup";
  if (OTP_METADATA.test(text)) return "otp";
  if (/api[\s_-]*key|access[\s_-]*token|client[\s_-]*secret|webhook[\s_-]*secret|接口密钥|访问令牌/i.test(text)) return "developer-secret";
  if (/ssh|private[\s_-]*key|public[\s_-]*key|authorized[\s_-]*keys|私钥|公钥/i.test(text)) return "ssh-console";
  if (controlMetadata.autocomplete.some((token) => token.startsWith("cc-")) || /card.?number|checkout|billing|payment|卡号|支付|账单/i.test(text)) return "checkout";
  if (hasNew) return "password-reset";
  if (control instanceof HTMLInputElement && control.type === "password") return isNewPasswordControl(control) ? "password-reset" : "login";
  if (controlMetadata.autocomplete.includes("username") || controlMetadata.autocomplete.includes("current-password") || /user(?:name)?|login|account|用户名|账号/i.test(metadataText(controlMetadata))) return "login";
  if (passwords.length > 0 || /login|sign[\s_-]*in|登录/i.test(text)) return "login";
  if (/profile|contact|address|姓名|联系|地址/i.test(text)) return "profile";
  return "unknown";
}

export function passwordFieldPurpose(control: Element): PasswordFieldPurpose | null {
  if (!(control instanceof HTMLInputElement) || control.type !== "password" || !isSupportedControl(control)) return null;
  const metadata = getMetadata(control);
  if (metadata.autocomplete.includes("new-password")) return "new";
  if (metadata.autocomplete.includes("current-password")) return "current";

  const directMetadata = metadataText(metadata);
  if (CURRENT_PASSWORD_METADATA.test(directMetadata)) return "current";
  if (NEW_PASSWORD_METADATA.test(directMetadata)) return "new";

  const group = passwordFieldGroup(control);
  const confirmationIndex = group.findIndex((candidate) =>
    CONFIRM_PASSWORD_METADATA.test(metadataText(getMetadata(candidate))),
  );
  const firstNewPassword = group.findIndex((candidate) => {
    const candidateMetadata = getMetadata(candidate);
    return candidateMetadata.autocomplete.includes("new-password") || NEW_PASSWORD_METADATA.test(metadataText(candidateMetadata));
  });

  const containerText = limit((control.form ?? control.parentElement)?.textContent ?? "", 1_000);
  // A two-field Password + Confirm Password pair is a new credential even
  // when the site leaves the primary input as a generic `name="password"`.
  // Direct current/old-password metadata returned above still wins for real
  // password-change forms.
  if (group.length === 2 && confirmationIndex === 1) return "new";
  if (SIGNUP_PASSWORD_CONTEXT.test(containerText) && !group.some((candidate) => {
    const candidateMetadata = getMetadata(candidate);
    return candidateMetadata.autocomplete.includes("current-password") || CURRENT_PASSWORD_METADATA.test(metadataText(candidateMetadata));
  })) return "new";
  if (firstNewPassword >= 0) {
    return group.indexOf(control) < firstNewPassword ? "current" : "new";
  }
  return NEW_PASSWORD_CONTEXT.test(containerText) && !CURRENT_PASSWORD_METADATA.test(containerText) ? "new" : "current";
}

export function isNewPasswordControl(control: Element) {
  return passwordFieldPurpose(control) === "new";
}

export function shouldPreserveExistingLoginAccount(target: Element) {
  return isControlElement(target) && classifyControl(target) === "login" && !isLoginAccountControl(target);
}

export function isEmailAccountControl(control: Element) {
  if (!isControlElement(control) || !isSupportedControl(control)) return false;
  const metadata = getMetadata(control);
  return metadata.autocomplete.includes("email") ||
    control instanceof HTMLInputElement && control.type === "email" ||
    /\be[\s_-]?mail\b|电子邮件|邮箱/i.test(metadataText(metadata));
}

export function passwordFieldGroup(control: HTMLInputElement) {
  if (control.form) return supportedPasswordControls(control.form);

  const root = control.getRootNode();
  for (let container = control.parentElement; container; container = container.parentElement) {
    const controls = supportedPasswordControls(container).filter((candidate) => candidate.form === null && candidate.getRootNode() === root);
    if (controls.length === 2 || (controls.length > 0 && container.matches('dialog,[role="dialog"],[role="form"]'))) return controls;
  }
  if (root instanceof ShadowRoot) {
    const controls = supportedPasswordControls(root).filter((candidate) => candidate.form === null);
    if (controls.length === 2) return controls;
  }
  return [control];
}

export function hasLoginFields(fields: FieldDescriptor[]) {
  return fields.some(isLoginFieldDescriptor);
}

export function loginFormSignature(fields: FieldDescriptor[]) {
  return fields
    .filter(isLoginFieldDescriptor)
    .map((field) => [field.control, field.inputType ?? "", field.autocomplete.join(","), field.name, field.id].join(":"))
    .join("|")
    .slice(0, 512);
}

function isLoginFieldDescriptor(field: FieldDescriptor) {
  return field.inputType === "password" || field.context === "otp" ||
    field.autocomplete.some((token) => ["username", "current-password", "one-time-code"].includes(token)) ||
    OTP_METADATA.test([field.label, field.name, field.id, field.placeholder].join(" "));
}

export async function applyAssignments({
  message,
  documentId,
  fields,
  currentOrigin,
}: {
  message: Extract<ContentMessage, { kind: "vaultmesh.apply-assignments" }>;
  documentId: string;
  fields: Map<string, SupportedControl>;
  currentOrigin: string;
}) {
  if (
    message.documentId !== documentId ||
    message.frameOrigin !== currentOrigin ||
    Date.parse(message.expiresAt) <= Date.now()
  ) {
    return { status: "stale-document" as const, results: [] };
  }

  // Login pages commonly list the password assignment first even though users
  // expect to see the account entered before the password. Keep all other
  // assignments stable while always moving password controls to the end.
  const assignments = [...message.assignments].sort((left, right) =>
    assignmentPriority(fields.get(left.handle)) - assignmentPriority(fields.get(right.handle)),
  );
  const results = [];

  if (message.clearBeforeFill) {
    let clearedAny = false;
    const controlsToClear = message.selectedItem
      ? Array.from(fields.values()).filter((control) => classifyControl(control) === message.selectedItem!.kind)
      : assignments.flatMap((assignment) => {
          const control = fields.get(assignment.handle);
          return control ? [control] : [];
        });
    for (const control of controlsToClear) {
      if (!control.isConnected || !hasValue(control)) continue;
      if (!await waitForControlReady(control, message.expiresAt)) continue;
      if (!assignValue(control, "")) continue;
      dispatchInput(control, null, "deleteContentBackward");
      control.dispatchEvent(new Event("change", { bubbles: true }));
      clearedAny = true;
    }
    if (clearedAny) await delay(FIELD_DELAY_MS);
  }

  for (const assignment of assignments) {
    const control = fields.get(assignment.handle);
    if (!control || !control.isConnected) {
      results.push({ handle: assignment.handle, status: "missing" as const });
      continue;
    }
    if (!message.clearBeforeFill && !assignment.overwrite && hasValue(control)) {
      results.push({ handle: assignment.handle, status: "skipped-non-empty" as const });
      continue;
    }
    if (!await waitForControlReady(control, message.expiresAt)) {
      results.push({ handle: assignment.handle, status: "not-ready" as const });
      continue;
    }

    if (control instanceof HTMLSelectElement) {
      if (!assignValue(control, assignment.value)) {
        results.push({ handle: assignment.handle, status: "invalid-select-option" as const });
        continue;
      }
      dispatchInput(control);
    } else if (!await typeValue(control, assignment.value, message.expiresAt)) {
      results.push({ handle: assignment.handle, status: "invalid-value" as const });
      continue;
    }

    control.dispatchEvent(new Event("change", { bubbles: true }));
    results.push({ handle: assignment.handle, status: "filled" as const });
    if (!(control instanceof HTMLInputElement && control.maxLength === 1)) await delay(FIELD_DELAY_MS);
  }

  return { status: "completed" as const, results };
}

function assignmentPriority(control: SupportedControl | undefined) {
  return control instanceof HTMLInputElement && control.type === "password" ? 1 : 0;
}

async function waitForControlReady(control: SupportedControl, expiresAt: string) {
  const deadline = Math.min(Date.parse(expiresAt), Date.now() + CONTROL_READY_TIMEOUT_MS);
  while (Date.now() < deadline) {
    if (isControlReady(control)) return true;
    await delay(CONTROL_READY_POLL_MS);
  }
  return isControlReady(control);
}

function isControlReady(control: SupportedControl) {
  return control.isConnected &&
    !(isNativeControl(control) && control.disabled) &&
    (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) || !control.readOnly) &&
    isVisible(control);
}

async function typeValue(control: Exclude<SupportedControl, HTMLSelectElement>, value: string, expiresAt: string) {
  control.focus({ preventScroll: true });
  assignValue(control, "");
  let typed = "";
  for (const character of Array.from(value)) {
    if (!isControlReady(control) || Date.parse(expiresAt) <= Date.now()) break;
    typed += character;
    assignValue(control, typed);
    dispatchInput(control, character);
    await delay(CHARACTER_DELAY_MS);
  }
  return isNativeControl(control) ? control.value === value : control.textContent === value;
}

function dispatchInput(control: SupportedControl, data: string | null = null, inputType = "insertText") {
  const InputEventConstructor = control.ownerDocument.defaultView?.InputEvent;
  const event = InputEventConstructor
    ? new InputEventConstructor("input", { bubbles: true, inputType, data })
    : new Event("input", { bubbles: true });
  control.dispatchEvent(event);
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function isHttpOrigin(value: string) {
  return value.startsWith("http://") || value.startsWith("https://");
}

function isSupportedControl(control: SupportedControl) {
  if (
    (isNativeControl(control) && control.disabled) ||
    ((control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) && control.readOnly) ||
    !isVisible(control)
  ) {
    return false;
  }
  if (control instanceof HTMLInputElement && !TEXT_INPUT_TYPES.has(control.type)) {
    return false;
  }

  const metadata = getMetadata(control);
  return !SENSITIVE_METADATA.test([metadata.label, metadata.name, metadata.id, metadata.placeholder].join(" "));
}

function buildDescriptor(control: SupportedControl): FieldDescriptor | null {
  const metadata = getMetadata(control);
  const handle = createUuid();
  const base = {
    handle,
    isEmpty: !hasValue(control),
    autocomplete: metadata.autocomplete,
    label: metadata.label,
    name: metadata.name,
    id: metadata.id,
    placeholder: metadata.placeholder,
    context: pageContextForControl(control),
  };

  if (control instanceof HTMLInputElement) {
    return { ...base, control: "input", inputType: control.type, ...(control.maxLength > 0 ? { maxLength: control.maxLength } : {}) };
  }
  if (control instanceof HTMLTextAreaElement) {
    return { ...base, control: "textarea" };
  }
  if (!(control instanceof HTMLSelectElement)) return { ...base, control: "contenteditable" };
  return {
    ...base,
    control: "select",
    options: Array.from(control.options)
      .slice(0, MAX_OPTIONS)
      .map((option) => ({ value: limit(option.value, 160), text: limit(option.textContent ?? "", 160) })),
  };
}

function getMetadata(control: SupportedControl) {
  return {
    autocomplete: (control.getAttribute("autocomplete") ?? "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 8),
    label: limit(getLabels(control).join(" "), 240),
    name: limit(control.getAttribute("name") ?? "", 160),
    id: limit(control.id, 160),
    placeholder: limit(control.getAttribute("placeholder") ?? "", 160),
  };
}

function isLoginAccountControl(control: SupportedControl) {
  if (control instanceof HTMLInputElement && control.type === "password") return false;
  const metadata = getMetadata(control);
  return metadata.autocomplete.some((token) => token === "username" || token === "email") ||
    control instanceof HTMLInputElement && (control.type === "email" || control.type === "tel") ||
    /user(name)?|login|account|e-?mail|phone|mobile|用户名|账号|邮箱|电话|手机/i.test(metadataText(metadata));
}

function metadataText(metadata: ReturnType<typeof getMetadata>) {
  return [metadata.label, metadata.name, metadata.id, metadata.placeholder].join(" ");
}

function supportedPasswordControls(root: ParentNode) {
  return Array.from(root.querySelectorAll<HTMLInputElement>('input[type="password"]')).filter(isSupportedControl);
}

function getLabels(control: SupportedControl) {
  const labels = Array.from(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement ? control.labels ?? [] : []).map((label) => label.textContent ?? "");
  const ariaLabel = control.getAttribute("aria-label");
  if (ariaLabel) {
    labels.push(ariaLabel);
  }
  const labelledBy = control.getAttribute("aria-labelledby");
  if (labelledBy) {
    const root = control.getRootNode();
    for (const id of labelledBy.split(/\s+/)) {
      const labelledElement = root instanceof ShadowRoot ? root.getElementById(id) : control.ownerDocument.getElementById(id);
      labels.push(labelledElement?.textContent ?? "");
    }
  }
  return labels.filter(Boolean).map((label) => limit(label, 160));
}

function isVisible(control: SupportedControl) {
  const view = control.ownerDocument.defaultView;
  if (!view) return false;
  for (let element: Element | null = control; element; element = composedParentElement(element)) {
    const style = view.getComputedStyle(element);
    if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden")?.toLowerCase() === "true") return false;
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
    if (element !== control && clipsCollapsedContent(style)) return false;
  }
  return control.getClientRects().length > 0;
}

function composedParentElement(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

function clipsCollapsedContent(style: CSSStyleDeclaration) {
  const clipsVertically = style.overflow === "hidden" || style.overflow === "clip" || style.overflowY === "hidden" || style.overflowY === "clip";
  const clipsHorizontally = style.overflow === "hidden" || style.overflow === "clip" || style.overflowX === "hidden" || style.overflowX === "clip";
  return (clipsVertically && Number.parseFloat(style.height) === 0) || (clipsHorizontally && Number.parseFloat(style.width) === 0);
}

function hasValue(control: SupportedControl) {
  return isNativeControl(control) ? control.value.length > 0 : (control.textContent ?? "").length > 0;
}

function assignValue(control: SupportedControl, value: string) {
  if (!isNativeControl(control)) {
    control.textContent = value;
    return control.textContent === value;
  }
  const prototype = control instanceof HTMLInputElement
    ? HTMLInputElement.prototype
    : control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLSelectElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) return false;
  setter.call(control, value);
  return !(control instanceof HTMLSelectElement) || control.value === value;
}

function composedControls(root: DiscoveryRoot) {
  const controls: SupportedControl[] = [];
  const roots: DiscoveryRoot[] = [root];
  for (let index = 0; index < roots.length; index += 1) {
    const current = roots[index]!;
    controls.push(...current.querySelectorAll<SupportedControl>('input, textarea, select, [contenteditable="true"], [role="textbox"][contenteditable], [role="combobox"][contenteditable]'));
    for (const element of current.querySelectorAll<HTMLElement>("*")) {
      const shadowRoot = accessibleShadowRoot(element);
      if (shadowRoot) roots.push(shadowRoot);
    }
  }
  return controls;
}

/**
 * Chromium and Firefox expose closed component roots to extension content
 * scripts through their DOM extension API. Fall back to the normal open-root
 * property so the discovery code remains portable and straightforward to test.
 */
export function accessibleShadowRoot(element: Element): ShadowRoot | null {
  if (element.shadowRoot) return element.shadowRoot;
  const globals = globalThis as typeof globalThis & {
    browser?: { dom?: { openOrClosedShadowRoot?: (target: Element) => ShadowRoot | null } };
    chrome?: { dom?: { openOrClosedShadowRoot?: (target: Element) => ShadowRoot | null } };
  };
  const resolver = globals.browser?.dom?.openOrClosedShadowRoot ?? globals.chrome?.dom?.openOrClosedShadowRoot;
  if (!resolver) return null;
  try {
    return resolver(element);
  } catch {
    return null;
  }
}

function isNativeControl(control: SupportedControl): control is NativeControl {
  return control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement;
}

function isControlElement(control: Element): control is SupportedControl {
  return isNativeControl(control as SupportedControl) || control instanceof HTMLElement && (control.isContentEditable || control.getAttribute("contenteditable") === "true");
}

function limit(value: string, maximum: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, maximum);
}

const IDENTITY_AUTOCOMPLETE = new Set([
  "name", "given-name", "additional-name", "family-name", "email", "tel", "organization", "organization-title", "url",
  "bday", "address-line1", "address-line2", "address-level1", "address-level2", "postal-code", "country", "country-name",
]);
