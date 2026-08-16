import { accessibleShadowRoot, analyzeControlSemantics, credentialFieldRole, discoverFields, classifyControl, hasLoginFields, isEmailAccountControl, isNewPasswordControl, loginFormSignature, passwordFieldGroup, selectAutofillPageContext, shouldPreserveExistingLoginAccount } from "@/lib/form-discovery";
import { InlineAutofillMenu } from "@/lib/inline-autofill";
import { InlineAutofillTrigger } from "@/lib/inline-autofill-trigger";
import { fillResultStatus, inlineFillFailureMessage } from "@/lib/autofill-selection";
import { fillGeneratedLogin, fillGeneratedPassword } from "@/lib/generated-login-fill";
import { generatePassword } from "@/lib/generated-credentials";
import { AutofillAvailabilityResponseSchema, AutofillCandidatesResponseSchema, SaveCaptureDecisionResponseSchema, SaveCapturePendingResponseSchema, SaveCaptureQueuedResponseSchema, type AutofillCandidate, type InlineAutofillCandidate } from "@/lib/protocol";
import { loadPasswordGeneratorOptions, loadUsernameGeneratorOptions } from "@/lib/generator-preferences";
import { captureSubmittedData, capturedDataSignature, hasCapturedData, submittedDataContext, type CapturedSaveData } from "@/lib/save-capture";
import { SaveCapturePrompt } from "@/lib/save-capture-prompt";
import { createUuid } from "@/lib/uuid";

type SendMessage = (message: unknown) => Promise<unknown>;

export function startAutofillPage(document: Document, documentId: string, sendMessage: SendMessage) {
  let disposed = false;
  let scanTimer: ReturnType<typeof setTimeout> | null = null;
  let unlockPollTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingCaptureResumeTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingCaptureResumeAttempts = 0;
  let unlockPollRemaining = 0;
  let focusRequest = 0;
  let availabilityRequest = 0;
  let availability: "unknown" | "ready" | "locked" | "unavailable" = "unknown";
  let generatedCapture: { username?: string; password: string; pageContext: "signup" | "password-change" | "password-reset"; loginId?: string } | null = null;
  let lastCapture: { signature: string; sentAt: number } | null = null;
  let activeCaptureId: string | null = null;
  type FilledFormState = { loginId?: string; identityId?: string; cardId?: string; loginEdited: boolean; identityEdited: boolean; cardEdited: boolean };
  const filledFormStates = new WeakMap<ParentNode, FilledFormState>();
  const pendingCaptureKinds = new Map<string, { login: boolean; identity: boolean; card: boolean; root: ParentNode; state?: FilledFormState }>();
  const observers: MutationObserver[] = [];
  const observedRoots = new WeakSet<Node>();
  const menu = new InlineAutofillMenu(document, (candidate, target) => {
    if (candidate.kind === "email-otp") {
      void sendMessage({ kind: "vaultmesh.email-otp-select", candidateId: candidate.id });
      return;
    }
    void selectCandidate(candidate, target);
  }, (login, target) => {
    generatedCapture = { username: login.username, password: login.password, pageContext: "signup" };
    void fillGeneratedLogin(document, documentId, login, target);
  }, (password, target) => {
    if (target instanceof HTMLInputElement) {
      const context = analyzeControlSemantics(target).context;
      if (context === "signup" || context === "password-change" || context === "password-reset") {
        const loginId = filledFormStates.get(formRoot(target))?.loginId;
        generatedCapture = { password, pageContext: context, ...(context !== "signup" && loginId ? { loginId } : {}) };
      }
      void fillGeneratedPassword(document, documentId, target, password);
    }
  });
  const trigger = new InlineAutofillTrigger(document, (target) => void openCandidates(target));
  const savePrompt = new SaveCapturePrompt(document, async (captureId, decision) => {
    const response = SaveCaptureDecisionResponseSchema.safeParse(await sendMessage({
      kind: "vaultmesh.save-capture-decision",
      captureId,
      decision,
    }).catch(() => null));
    const result = response.success ? response.data : { status: "failed" as const };
    const kinds = pendingCaptureKinds.get(captureId);
    pendingCaptureKinds.delete(captureId);
    if (activeCaptureId === captureId) activeCaptureId = null;
    if (result.status === "saved" && kinds) {
      if (kinds.state) {
        if (kinds.login) kinds.state.loginEdited = false;
        if (kinds.identity) kinds.state.identityEdited = false;
        if (kinds.card) kinds.state.cardEdited = false;
      }
    } else {
      // Ignoring, timing out, or failing must allow the same user-edited data
      // to be offered again on the next real submission.
      lastCapture = null;
    }
    return result;
  });

  async function selectCandidate(candidate: AutofillCandidate, target: HTMLElement) {
    const replaceExistingAccount = candidate.kind === "login" && !shouldPreserveExistingLoginAccount(target);
    const response = await sendMessage({
      kind: "vaultmesh.autofill-select",
      selectedItem: {
        kind: candidate.kind,
        id: candidate.id,
        title: candidate.title,
        ...(candidate.masterPasswordReprompt ? { masterPasswordReprompt: true } : {}),
      },
      ...(replaceExistingAccount ? { replaceExistingAccount: true } : {}),
    }).catch(() => null);
    if (disposed || !target.isConnected) return;
    if (fillResultStatus(response) === "unlock-required") {
      availability = "locked";
      trigger.setLocked(true);
    }
    const failure = inlineFillFailureMessage(response);
    if (failure) menu.showStatus(target, failure);
  }

  async function resumePendingCapture() {
    pendingCaptureResumeTimer = null;
    if (disposed || activeCaptureId || savePrompt.visible) return;
    pendingCaptureResumeAttempts += 1;
    const response = SaveCapturePendingResponseSchema.safeParse(
      await sendMessage({ kind: "vaultmesh.save-capture-pending" }).catch(() => null),
    );
    if (disposed || activeCaptureId || savePrompt.visible) return;
    if (response.success && response.data.status === "queued") {
      showPendingCapture(response.data);
      return;
    }
    if (response.success && response.data.status === "preparing" && pendingCaptureResumeAttempts < 240) {
      pendingCaptureResumeTimer = setTimeout(() => void resumePendingCapture(), 500);
    } else if (response.success && response.data.status === "none" && pendingCaptureResumeAttempts < 3) {
      pendingCaptureResumeTimer = setTimeout(() => void resumePendingCapture(), pendingCaptureResumeAttempts * 250);
    }
  }

  function showPendingCapture(details: import("@/lib/protocol").SaveCaptureQueuedResponse) {
    if (disposed || activeCaptureId && activeCaptureId !== details.captureId) return false;
    if (activeCaptureId === details.captureId) activeCaptureId = null;
    pendingCaptureKinds.delete(details.captureId);
    savePrompt.hide();
    return true;
  }

  async function refreshAvailability() {
    const request = ++availabilityRequest;
    const response = AutofillAvailabilityResponseSchema.safeParse(await sendMessage({ kind: "vaultmesh.autofill-state" }).catch(() => null));
    if (disposed || request !== availabilityRequest || !response.success) return availability;
    availability = response.data.status;
    trigger.setLocked(availability === "locked");
    return availability;
  }

  function openUnlock() {
    menu.hide();
    void sendMessage({ kind: "vaultmesh.open-unlock" });
    unlockPollRemaining = 120;
    if (unlockPollTimer) clearTimeout(unlockPollTimer);
    const poll = async () => {
      unlockPollTimer = null;
      const state = await refreshAvailability();
      unlockPollRemaining -= 1;
      if (!disposed && state !== "ready" && unlockPollRemaining > 0) unlockPollTimer = setTimeout(poll, 1_000);
    };
    unlockPollTimer = setTimeout(poll, 750);
  }

  const scan = () => {
    if (disposed || document.visibilityState === "hidden") return;
    observeOpenRoots(document);
    const { descriptors } = discoverFields(document);
    if (!hasLoginFields(descriptors)) return;
    const pageContext = selectAutofillPageContext(descriptors);
    if (pageContext !== "login" && pageContext !== "otp") return;
    const signature = loginFormSignature(descriptors);
    if (signature) void sendMessage({ kind: "vaultmesh.autofill-page-ready", documentId, signature, pageContext });
  };

  const scheduleScan = () => {
    if (disposed || scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
    }, 150);
  };

  function observeOpenRoots(root: Document | ShadowRoot) {
    const roots: Array<Document | ShadowRoot> = [root];
    for (let index = 0; index < roots.length; index += 1) {
      const current = roots[index]!;
      if (!observedRoots.has(current)) {
        const Observer = document.defaultView?.MutationObserver ?? MutationObserver;
        const observer = new Observer(scheduleScan);
        observer.observe(current, { subtree: true, childList: true, attributes: true, attributeFilter: ["autocomplete", "type", "name", "id", "placeholder", "disabled", "readonly", "aria-hidden", "hidden", "class", "style"] });
        observers.push(observer);
        observedRoots.add(current);
      }
      for (const element of current.querySelectorAll<HTMLElement>("*")) {
        const shadowRoot = accessibleShadowRoot(element);
        if (shadowRoot) roots.push(shadowRoot);
      }
    }
  }

  async function openCandidates(target: HTMLElement) {
    if (availability === "locked") return openUnlock();
    if (target instanceof HTMLInputElement && isNewPasswordControl(target)) {
      const request = ++focusRequest;
      const options = await loadPasswordGeneratorOptions();
      if (disposed || request !== focusRequest || trigger.target !== target || !target.isConnected) return;
      menu.show(target, [], "password", { passwordGeneratorOptions: options });
      return;
    }
    const fieldKind = classifyControl(target);
    if (!fieldKind) return;
    const pageContext = analyzeControlSemantics(target).context;
    // Signup account fields create a new credential. Never offer existing
    // vault logins here; show the local random account/password generator.
    if (fieldKind === "login" && pageContext === "signup") {
      const request = ++focusRequest;
      const [passwordGeneratorOptions, usernameGeneratorOptions] = await Promise.all([
        loadPasswordGeneratorOptions(),
        loadUsernameGeneratorOptions(),
      ]);
      if (disposed || request !== focusRequest || trigger.target !== target || !target.isConnected) return;
      menu.show(target, [], "login", {
        generatedEmailRequired: isEmailAccountControl(target),
        passwordGeneratorOptions,
        usernameGeneratorOptions,
      });
      return;
    }
    const request = ++focusRequest;
    const response = AutofillCandidatesResponseSchema.safeParse(await sendMessage({ kind: "vaultmesh.autofill-candidates", fieldKind, pageContext }).catch(() => null));
    if (disposed || request !== focusRequest || trigger.target !== target || !target.isConnected) return;
    if (response.success && response.data.status === "locked") {
      availability = "locked";
      trigger.setLocked(true);
      return openUnlock();
    }
    if (!response.success || response.data.status !== "ready") return menu.hide();
    const candidates: InlineAutofillCandidate[] = response.success && response.data.status === "ready"
      ? response.data.candidates.filter((candidate) => candidate.kind === fieldKind)
      : [];
    if (pageContext === "otp") {
      candidates.unshift(...(response.data.emailOtpCandidates ?? []).map((candidate) => ({
        ...candidate,
        kind: "email-otp" as const,
        title: candidate.code,
        subtitle: `来自 ${candidate.sourceDomain}`,
      })));
    }
    // OTP controls reuse Login items as their data source, but an empty TOTP
    // candidate list is not a signup opportunity. Never fall back to the
    // random account/password generator for a verification-code field.
    const generatedMode = fieldKind === "login" && pageContext !== "otp" ? "login" : "none";
    menu.show(target, candidates, generatedMode, { anchor: pageContext === "otp" ? segmentedOtpAnchor(target) : target });
  }

  async function refreshOtpCandidates() {
    focusRequest += 1;
    menu.hide();
    await sendMessage({ kind: "vaultmesh.autofill-candidates", fieldKind: "login", pageContext: "otp" }).catch(() => null);
  }

  const onFocusIn = (event: FocusEvent) => {
    const target = event.composedPath()[0];
    if (menu.owns(event.target) || trigger.owns(event.target)) return;
    if (!(target instanceof Element)) {
      menu.hide();
      return trigger.hide();
    }
    const fieldKind = classifyControl(target);
    focusRequest += 1;
    menu.hide();
    if (!fieldKind) return trigger.hide();
    trigger.show(target as HTMLElement, isNewPasswordControl(target) ? "generate-password" : "autofill", availability === "locked");
    void refreshAvailability();
  };

  const onPageHide = () => dispose();
  const captureSubmission = (root: ParentNode) => {
    const pageUrl = document.defaultView?.location.href ?? "";
    const inferredContext = submittedDataContext(root);
    const pageContext = generatedCapture?.pageContext ?? inferredContext;
    const data: CapturedSaveData = captureSubmittedData(root, pageUrl, { context: pageContext });
    const filledState = filledFormStates.get(root);
    if (generatedCapture) {
      data.login = {
        username: generatedCapture.username ?? accountValue(root),
        password: generatedCapture.password,
        ...(generatedCapture.loginId ? { loginId: generatedCapture.loginId } : {}),
      };
    } else if (data.login) {
      if (filledState?.loginId && !filledState.loginEdited) delete data.login;
      else if (filledState?.loginId && pageContext !== "signup") data.login.loginId = filledState.loginId;
    }
    if (data.identity) {
      if (filledState?.identityId && !filledState.identityEdited) delete data.identity;
      else if (filledState?.identityId) data.identity.identityId = filledState.identityId;
    }
    if (data.card) {
      if (filledState?.cardId && !filledState.cardEdited) delete data.card;
      else if (filledState?.cardId) data.card.cardId = filledState.cardId;
    }

    const captureHasData = hasCapturedData(data);
    const submittedUsername = data.login?.username || accountValue(root);
    if (!captureHasData && submittedUsername && (pageContext === "login" || pageContext === "signup")) {
      void sendMessage({ kind: "vaultmesh.account-stage", pageUrl, username: submittedUsername });
    }
    if (!captureHasData) return;
    const signature = capturedDataSignature(data);
    if (lastCapture?.signature === signature && Date.now() - lastCapture.sentAt < 2_000) return;
    lastCapture = { signature, sentAt: Date.now() };
    generatedCapture = null;
    const captureId = createUuid();
    const supersededCaptureId = activeCaptureId;
    activeCaptureId = captureId;
    const captureRequest = sendMessage({ kind: "vaultmesh.save-capture", captureId, pageUrl, pageContext, data });
    if (supersededCaptureId) {
      pendingCaptureKinds.delete(supersededCaptureId);
      void sendMessage({
        kind: "vaultmesh.save-capture-decision",
        captureId: supersededCaptureId,
        decision: "ignore",
      }).catch(() => undefined);
    }
    pendingCaptureKinds.set(captureId, { login: Boolean(data.login), identity: Boolean(data.identity), card: Boolean(data.card), root, state: filledState });
    // Account/card/identity checks can resolve to `unchanged`. Keep that
    // preparatory state invisible so an unchanged submission does not flash a
    // misleading save prompt immediately before a full-page navigation.
    savePrompt.showPreparing(capturePromptDetails(captureId, pageUrl, data), false);
    void captureRequest
      .then((response) => {
        const queued = SaveCaptureQueuedResponseSchema.safeParse(response);
        if (disposed) return;
        if (activeCaptureId !== captureId) {
          if (queued.success) {
            void sendMessage({ kind: "vaultmesh.save-capture-decision", captureId, decision: "ignore" }).catch(() => undefined);
          }
          return;
        }
        if (queued.success && queued.data.captureId === captureId) showPendingCapture(queued.data);
        else if (isResponseStatus(response, "unchanged")) {
          const unchanged = pendingCaptureKinds.get(captureId);
          if (unchanged?.state) {
            if (unchanged.login) unchanged.state.loginEdited = false;
            if (unchanged.identity) unchanged.state.identityEdited = false;
            if (unchanged.card) unchanged.state.cardEdited = false;
          }
          pendingCaptureKinds.delete(captureId);
          activeCaptureId = null;
          savePrompt.hide();
        }
        else {
          pendingCaptureKinds.delete(captureId);
          lastCapture = null;
          activeCaptureId = null;
          if (isResponseStatus(response, "queued")) savePrompt.showQueueFailure(captureId, "background-outdated");
          else if (isResponseStatus(response, "account-check-failed")) savePrompt.showQueueFailure(captureId, "account-check-failed");
          else if (isResponseStatus(response, "save-check-failed")) savePrompt.showQueueFailure(captureId, "save-check-failed");
          else if (isResponseStatus(response, "unsupported-page")) savePrompt.showQueueFailure(captureId, "unsupported-page");
          else savePrompt.showQueueFailure(captureId, response == null ? "background-unavailable" : "invalid-response");
        }
      })
      .catch(() => {
        if (activeCaptureId !== captureId) return;
        pendingCaptureKinds.delete(captureId);
        lastCapture = null;
        activeCaptureId = null;
        savePrompt.showQueueFailure(captureId, "background-unavailable");
      });
  };
  const onSubmit = (event: SubmitEvent) => captureSubmission(event.target instanceof HTMLFormElement ? event.target : document);
  const onClick = (event: MouseEvent) => {
    const target = event.composedPath()[0];
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLElement>('button,input[type="submit"],[role="button"]');
    if (!button) return;
    if (event.isTrusted && isOtpRequestAction(button)) void sendMessage({ kind: "vaultmesh.otp-watch-requested" }).catch(() => undefined);
    if (!isSaveAction(button)) return;
    const root = button.closest("form,[role='form']") ?? document;
    if (root instanceof HTMLFormElement && !root.checkValidity() || root.querySelector('[aria-invalid="true"]')) return;
    queueMicrotask(() => captureSubmission(root));
  };
  const onInput = (event: Event) => {
    const target = event.composedPath()[0];
    if (!event.isTrusted || !(target instanceof Element)) return;
    const kind = classifyControl(target);
    recordEditedItem(kind, target);
  };
  const recordEditedItem = (kind: string | null | undefined, target?: Element | ParentNode) => {
    const root = target instanceof Element ? formRoot(target) : target;
    if (!root) return;
    const state = filledFormStates.get(root);
    if (!state) return;
    if (kind === "login") state.loginEdited = true;
    if (kind === "identity") state.identityEdited = true;
    if (kind === "card") state.cardEdited = true;
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      menu.hide();
      trigger.hide();
    }
    else {
      scheduleScan();
      void refreshAvailability();
    }
  };
  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("submit", onSubmit, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("input", onInput, true);
  document.addEventListener("visibilitychange", onVisibilityChange);
  document.defaultView?.addEventListener("pagehide", onPageHide, { once: true });
  observeOpenRoots(document);
  scheduleScan();
  void refreshAvailability();
  if (document.defaultView?.top === document.defaultView) void resumePendingCapture();

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (scanTimer) clearTimeout(scanTimer);
    if (unlockPollTimer) clearTimeout(unlockPollTimer);
    if (pendingCaptureResumeTimer) clearTimeout(pendingCaptureResumeTimer);
    for (const observer of observers) observer.disconnect();
    document.removeEventListener("focusin", onFocusIn, true);
    document.removeEventListener("submit", onSubmit, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("input", onInput, true);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    document.defaultView?.removeEventListener("pagehide", onPageHide);
    menu.destroy();
    trigger.destroy();
    savePrompt.destroy();
  }

  function recordFilledItem(item: { kind: string; id: string }, controls: Iterable<Element> = []) {
    const roots = new Set(Array.from(controls, formRoot));
    for (const root of roots) {
      const state = filledFormStates.get(root) ?? { loginEdited: false, identityEdited: false, cardEdited: false };
      if (item.kind === "login") { state.loginId = item.id; state.loginEdited = false; }
      if (item.kind === "identity") { state.identityId = item.id; state.identityEdited = false; }
      if (item.kind === "card") { state.cardId = item.id; state.cardEdited = false; }
      filledFormStates.set(root, state);
    }
  }

  async function completePasswordChange(item: { kind: string; id: string }, controls: Iterable<Element> = []) {
    if (item.kind !== "login" || disposed) return { status: "not-applicable" as const };
    const currentPassword = Array.from(controls).find((control): control is HTMLInputElement => {
      if (!(control instanceof HTMLInputElement) || control.type !== "password") return false;
      const semantics = analyzeControlSemantics(control);
      return semantics.context === "password-change" && semantics.confidence !== "low" && credentialFieldRole(control) === "current-password";
    });
    if (!currentPassword) return { status: "not-applicable" as const };

    const emptyNewPasswordFields = () => passwordFieldGroup(currentPassword)
      .filter((control) => isNewPasswordControl(control));
    let newPasswordFields = emptyNewPasswordFields();
    if (newPasswordFields.length === 0) return { status: "not-applicable" as const };
    if (newPasswordFields.some((control) => control.value !== "")) return { status: "preserved-existing" as const };

    try {
      const options = await loadPasswordGeneratorOptions();
      if (disposed || !currentPassword.isConnected) return { status: "cancelled" as const };
      newPasswordFields = emptyNewPasswordFields();
      if (newPasswordFields.length === 0) return { status: "not-applicable" as const };
      if (newPasswordFields.some((control) => control.value !== "")) return { status: "preserved-existing" as const };

      const password = generatePassword(options);
      generatedCapture = { password, pageContext: "password-change", loginId: item.id };
      const result = await fillGeneratedPassword(document, documentId, newPasswordFields[0]!, password);
      if (result.results.length !== newPasswordFields.length || result.results.some((entry) => entry.status !== "filled")) {
        generatedCapture = null;
        return { status: "failed" as const };
      }
      return { status: "generated" as const };
    } catch {
      generatedCapture = null;
      return { status: "failed" as const };
    }
  }

  return { dispose, menu, trigger, savePrompt, scan: scheduleScan, refreshOtpCandidates, recordFilledItem, completePasswordChange, recordEditedItem, showPendingCapture };
}

function segmentedOtpAnchor(target: HTMLElement) {
  if (!(target instanceof HTMLInputElement)) return target;
  for (let container = target.parentElement; container; container = container.parentElement) {
    const otpInputs = Array.from(container.querySelectorAll<HTMLInputElement>("input"))
      .filter((input) => analyzeControlSemantics(input).context === "otp");
    if (otpInputs.length >= 2 && otpInputs.includes(target)) return container;
    if (container.matches('form,[role="form"],body,html')) break;
  }
  return target;
}

function formRoot(element: Element): ParentNode {
  return element.closest("form,[role='form']") ?? element.ownerDocument;
}

function capturePromptDetails(captureId: string, pageUrl: string, data: CapturedSaveData) {
  let hostname = "当前网站";
  try { hostname = new URL(pageUrl).hostname || hostname; } catch { /* Keep a non-sensitive fallback label. */ }
  const labels = [data.login ? "登录信息" : "", data.identity ? "个人资料/地址" : "", data.card ? "支付卡" : ""].filter(Boolean);
  return { captureId, hostname, labels, update: Boolean(data.login?.loginId) };
}

function isResponseStatus(response: unknown, status: string): boolean {
  return Boolean(response && typeof response === "object" && "status" in response && response.status === status);
}

function accountValue(root: ParentNode): string {
  const controls = Array.from(root.querySelectorAll<HTMLInputElement>('input:not([type="password"])'));
  const explicit = controls.find((control) => {
    const metadata = `${control.autocomplete} ${control.name} ${control.id} ${control.placeholder}`;
    return /username|email|account|login|phone|mobile|用户名|账号|邮箱|手机/i.test(metadata);
  });
  return explicit?.value ?? controls.find((control) => control.value)?.value ?? "";
}

function isSaveAction(button: HTMLElement) {
  if (button instanceof HTMLInputElement && button.type === "submit") return true;
  if (button instanceof HTMLButtonElement && button.type === "submit") return true;
  const text = `${button.textContent ?? ""} ${button.getAttribute("aria-label") ?? ""}`;
  return /sign\s*in|log\s*in|sign\s*up|register|create|continue|next|save|submit|update|change.{0,12}(?:password|passcode)|checkout|pay|登录|注册|创建|继续|下一步|保存|提交|更新|修改.{0,8}(?:密码|口令)|结账|支付/i.test(text);
}

export function isOtpRequestAction(button: HTMLElement) {
  const text = button instanceof HTMLInputElement
    ? `${button.value} ${button.getAttribute("aria-label") ?? ""}`
    : `${button.textContent ?? ""} ${button.getAttribute("aria-label") ?? ""}`;
  return /(?:获取|发送|重新发送|重发|取得).{0,8}(?:验证码|校验码|动态码)|(?:验证码|校验码|动态码).{0,8}(?:获取|发送|重发)|(?:get|send|request|resend).{0,12}(?:verification|security|one[-\s]*time|otp).{0,8}(?:code|password)?|(?:verification|security|otp).{0,8}(?:code)?.{0,12}(?:send|resend)/i.test(text);
}

export type { InlineAutofillCandidate };
