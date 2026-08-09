import {
  findTotpQrTargets,
  scanTotpQrTarget,
  type ScannedTotpQrCode,
  type TotpQrTarget,
} from "@/lib/page-information-capture";
import {
  TotpCaptureBeginResponseSchema,
  TotpCaptureSaveResponseSchema,
  type TotpCaptureLogin,
} from "@/lib/protocol";
import { createUuid } from "@/lib/uuid";

type SendMessage = (message: unknown) => Promise<unknown>;
type Trigger = { host: HTMLDivElement; target: TotpQrTarget; targetHandle: string; button: HTMLButtonElement };
type ActiveCapture = {
  operationId: string;
  target: TotpQrTarget;
  targetHandle: string;
  expiresAt: number;
  candidates: TotpCaptureLogin[];
  overwriteCandidate: TotpCaptureLogin | null;
};

export class InlineTotpCaptureController {
  readonly #document: Document;
  readonly #documentId: string;
  readonly #sendMessage: SendMessage;
  readonly #onSaved: () => void;
  readonly #triggers = new Map<TotpQrTarget, Trigger>();
  readonly #menuHost: HTMLDivElement;
  readonly #menuShadow: ShadowRoot;
  readonly #menu: HTMLDivElement;
  readonly #observer: MutationObserver;
  #active: ActiveCapture | null = null;
  #scanTimer: ReturnType<typeof setTimeout> | null = null;
  #successTimer: ReturnType<typeof setTimeout> | null = null;
  #disposed = false;
  #busy = false;

  constructor(document: Document, documentId: string, sendMessage: SendMessage, onSaved: () => void) {
    this.#document = document;
    this.#documentId = documentId;
    this.#sendMessage = sendMessage;
    this.#onSaved = onSaved;
    this.#menuHost = document.createElement("div");
    this.#menuHost.dataset.vaultmeshTotpQrMenu = "";
    this.#menuHost.style.cssText = "all:initial;position:fixed;z-index:2147483647;display:none;width:320px";
    this.#menuShadow = this.#menuHost.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host { color-scheme:light dark; }
      * { box-sizing:border-box; }
      .panel { width:100%;max-height:min(360px,calc(100vh - 16px));overflow:auto;border:1px solid rgba(127,127,127,.35);border-radius:12px;background:Canvas;color:CanvasText;box-shadow:0 16px 40px rgba(0,0,0,.26);font:13px/1.4 system-ui,sans-serif;padding:10px; }
      .heading { display:flex;align-items:center;gap:9px;margin:0 0 4px;font-weight:700;font-size:14px; }
      .mark { display:grid;place-items:center;width:24px;height:24px;border-radius:7px;background:#6d5dfc;color:#fff;font-weight:850; }
      .hint { margin:0 0 8px;color:GrayText;font-size:12px; }
      .candidate { width:100%;display:flex;align-items:center;gap:9px;border:0;border-radius:8px;padding:8px;background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer; }
      .candidate:hover,.candidate:focus-visible { background:color-mix(in srgb,Highlight 14%,transparent);outline:2px solid transparent; }
      .candidate-mark { display:grid;place-items:center;flex:0 0 auto;width:25px;height:25px;border-radius:7px;background:color-mix(in srgb,Highlight 18%,Canvas);font-weight:750; }
      .candidate-text { min-width:0;display:flex;flex-direction:column; }
      .name,.subtitle { overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
      .name { font-weight:650; }.subtitle { color:GrayText;font-size:12px; }
      .actions { display:flex;justify-content:flex-end;gap:7px;margin-top:9px; }
      button.action { border:1px solid rgba(127,127,127,.35);border-radius:7px;padding:6px 9px;background:Canvas;color:CanvasText;font:inherit;cursor:pointer; }
      button.primary { border-color:#6d5dfc;background:#6d5dfc;color:#fff;font-weight:650; }
      button:disabled { opacity:.55;cursor:default; }
      .status { margin:3px 0;color:GrayText; }.error { color:#b42318; }.success { color:#16803c;font-weight:650; }
    `;
    this.#menu = document.createElement("div");
    this.#menu.className = "panel";
    this.#menuShadow.append(style, this.#menu);
    document.documentElement.append(this.#menuHost);

    const Observer = document.defaultView?.MutationObserver ?? MutationObserver;
    this.#observer = new Observer((records) => {
      if (records.some((record) => !isVaultMeshHostMutation(record.target))) this.#scheduleScan();
    });
    this.#observer.observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["hidden", "aria-hidden", "class", "style", "src", "href", "alt", "data-qr-value", "data-target"],
    });
    document.addEventListener("keydown", this.#onKeyDown, true);
    document.addEventListener("pointerdown", this.#onPointerDown, true);
    document.defaultView?.addEventListener("resize", this.#positionAll);
    document.defaultView?.addEventListener("scroll", this.#positionAll, true);
    document.defaultView?.addEventListener("pagehide", this.dispose, { once: true });
    this.scan();
  }

  get triggerCount() { return this.#triggers.size; }
  get menuVisible() { return this.#menuHost.style.display !== "none"; }
  get activeOperationId() { return this.#active?.operationId ?? null; }

  scan = () => {
    if (this.#disposed || this.#document.visibilityState === "hidden") return;
    const targets = new Set(findTotpQrTargets(this.#document));
    for (const [target, trigger] of this.#triggers) {
      if (!targets.has(target) || !target.isConnected) this.#removeTrigger(trigger);
    }
    for (const target of targets) {
      if (!this.#triggers.has(target)) this.#addTrigger(target);
    }
    this.#positionAll();
  };

  recognize = async (target: TotpQrTarget) => {
    if (this.#disposed || this.#busy || !target.isConnected) return;
    const trigger = this.#triggers.get(target);
    if (!trigger) return;
    await this.#cancelActive(false);
    this.#busy = true;
    trigger.button.disabled = true;
    this.#showStatus(target, "正在识别验证器二维码…");
    try {
      const values = await scanTotpQrTarget(this.#document, target);
      if (values.length !== 1) {
        this.#showError(target, values.length ? "该目标包含多个验证码二维码，请分别识别。" : "没有识别到受支持的 TOTP 二维码。");
        return;
      }
      await this.#begin(target, trigger.targetHandle, values[0]!);
    } finally {
      this.#busy = false;
      if (target.isConnected) trigger.button.disabled = false;
    }
  };

  select = async (loginId: string, overwrite = false) => {
    const active = this.#active;
    if (!active || this.#busy || active.expiresAt <= Date.now()) {
      if (active) this.#showError(active.target, "识别操作已过期，请重新点击二维码旁的按钮。");
      return;
    }
    const candidate = active.candidates.find((item) => item.id === loginId);
    if (!candidate) return;
    if (candidate.hasTotpSecret && !overwrite && active.overwriteCandidate?.id !== candidate.id) {
      active.overwriteCandidate = candidate;
      this.#renderOverwrite(active, candidate);
      return;
    }
    this.#busy = true;
    this.#renderSaving(active, candidate);
    try {
      const response = TotpCaptureSaveResponseSchema.safeParse(await this.#sendMessage({
        kind: "vaultmesh.totp-capture.save",
        operationId: active.operationId,
        documentId: this.#documentId,
        targetHandle: active.targetHandle,
        loginId: candidate.id,
        overwrite,
      }).catch(() => null));
      if (!response.success) return this.#showError(active.target, "保存失败，请重试。");
      if (response.data.status === "overwrite-required") {
        active.overwriteCandidate = candidate;
        return this.#renderOverwrite(active, candidate);
      }
      if (response.data.status === "saved") {
        this.#active = null;
        this.#renderSuccess(active.target, `${response.data.title} 已添加验证器`);
        this.#onSaved();
        return;
      }
      this.#active = null;
      this.#showError(active.target, captureStatusMessage(response.data.status));
    } finally {
      this.#busy = false;
    }
  };

  confirmOverwrite = async () => {
    const candidate = this.#active?.overwriteCandidate;
    if (candidate) await this.select(candidate.id, true);
  };

  cancel = async () => {
    await this.#cancelActive(true);
  };

  dispose = () => {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#scanTimer) clearTimeout(this.#scanTimer);
    if (this.#successTimer) clearTimeout(this.#successTimer);
    void this.#cancelActive(false);
    this.#observer.disconnect();
    this.#document.removeEventListener("keydown", this.#onKeyDown, true);
    this.#document.removeEventListener("pointerdown", this.#onPointerDown, true);
    this.#document.defaultView?.removeEventListener("resize", this.#positionAll);
    this.#document.defaultView?.removeEventListener("scroll", this.#positionAll, true);
    for (const trigger of this.#triggers.values()) trigger.host.remove();
    this.#triggers.clear();
    this.#menuHost.remove();
  };

  async #begin(target: TotpQrTarget, targetHandle: string, value: ScannedTotpQrCode) {
    const parsed = TotpCaptureBeginResponseSchema.safeParse(await this.#sendMessage({
      kind: "vaultmesh.totp-capture.begin",
      documentId: this.#documentId,
      targetHandle,
      value,
    }).catch(() => null));
    if (!parsed.success) return this.#showError(target, "无法连接 VaultMesh，请重试。");
    if (parsed.data.status !== "ready") return this.#showError(target, captureStatusMessage(parsed.data.status));
    this.#active = {
      operationId: parsed.data.operationId,
      target,
      targetHandle,
      expiresAt: Date.parse(parsed.data.expiresAt),
      candidates: parsed.data.candidates,
      overwriteCandidate: null,
    };
    this.#renderCandidates(this.#active);
  }

  #addTrigger(target: TotpQrTarget) {
    const host = this.#document.createElement("div");
    host.dataset.vaultmeshTotpQrTrigger = "";
    host.style.cssText = "all:initial;position:fixed;z-index:2147483646;width:138px;height:30px";
    const shadow = host.attachShadow({ mode: "closed" });
    const style = this.#document.createElement("style");
    style.textContent = `
      button { all:unset;box-sizing:border-box;width:100%;height:100%;display:flex;align-items:center;justify-content:center;gap:7px;border-radius:8px;background:#6d5dfc;color:#fff;box-shadow:0 3px 12px rgba(0,0,0,.24);font:650 12px/1 system-ui,sans-serif;cursor:pointer; }
      button:hover { filter:brightness(1.08); } button:focus-visible { outline:2px solid Highlight;outline-offset:2px; } button:disabled { opacity:.6;cursor:default; }
      .mark { font-weight:850;font-size:13px; }
    `;
    const button = this.#document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", "使用 VaultMesh 识别验证码二维码");
    button.title = "使用 VaultMesh 识别验证码二维码";
    const mark = this.#document.createElement("span");
    mark.className = "mark";
    mark.textContent = "V";
    button.append(mark, this.#document.createTextNode("保存到 VaultMesh"));
    const trigger: Trigger = { host, target, targetHandle: createUuid(), button };
    button.addEventListener("click", (event) => { if (event.isTrusted) void this.recognize(target); });
    shadow.append(style, button);
    this.#document.documentElement.append(host);
    this.#triggers.set(target, trigger);
  }

  #removeTrigger(trigger: Trigger) {
    this.#triggers.delete(trigger.target);
    trigger.host.remove();
    if (this.#active?.target === trigger.target) void this.#cancelActive(true);
  }

  #renderCandidates(active: ActiveCapture) {
    this.#clearMenu();
    this.#appendHeading("添加验证码");
    const hint = this.#document.createElement("p");
    hint.className = "hint";
    hint.textContent = active.candidates.length ? "选择要附加验证器的登录信息" : "保险库中没有可选择的登录信息。请先创建 Login。";
    this.#menu.append(hint);
    for (const candidate of active.candidates) {
      const button = this.#document.createElement("button");
      button.className = "candidate";
      button.type = "button";
      const mark = this.#document.createElement("span");
      mark.className = "candidate-mark";
      mark.textContent = candidate.title.slice(0, 1).toLocaleUpperCase() || "L";
      const text = this.#document.createElement("span");
      text.className = "candidate-text";
      const name = this.#document.createElement("span");
      name.className = "name";
      name.textContent = candidate.title;
      const subtitle = this.#document.createElement("span");
      subtitle.className = "subtitle";
      subtitle.textContent = [candidate.username, candidate.matchScope ? scopeLabel(candidate.matchScope) : ""].filter(Boolean).join(" · ");
      text.append(name, subtitle);
      button.append(mark, text);
      button.addEventListener("click", (event) => { if (event.isTrusted) void this.select(candidate.id); });
      this.#menu.append(button);
    }
    this.#appendCancel();
    this.#showMenu(active.target);
  }

  #renderOverwrite(active: ActiveCapture, candidate: TotpCaptureLogin) {
    this.#clearMenu();
    this.#appendHeading("替换现有验证器？");
    const status = this.#document.createElement("p");
    status.className = "status";
    status.textContent = `${candidate.title} 已保存验证器密钥。继续将覆盖原密钥。`;
    this.#menu.append(status);
    const actions = this.#document.createElement("div");
    actions.className = "actions";
    actions.append(this.#actionButton("取消", () => void this.cancel()), this.#actionButton("确认替换", () => void this.confirmOverwrite(), true));
    this.#menu.append(actions);
    this.#showMenu(active.target);
  }

  #renderSaving(active: ActiveCapture, candidate: TotpCaptureLogin) {
    this.#clearMenu();
    this.#appendHeading("正在保存");
    const status = this.#document.createElement("p");
    status.className = "status";
    status.textContent = `正在把验证器添加到 ${candidate.title}…`;
    this.#menu.append(status);
    this.#showMenu(active.target);
  }

  #renderSuccess(target: TotpQrTarget, message: string) {
    this.#clearMenu();
    this.#appendHeading("添加成功");
    const status = this.#document.createElement("p");
    status.className = "success";
    status.textContent = message;
    this.#menu.append(status);
    this.#showMenu(target);
    if (this.#successTimer) clearTimeout(this.#successTimer);
    this.#successTimer = setTimeout(() => this.#hideMenu(), 1_800);
  }

  #showStatus(target: TotpQrTarget, message: string) {
    this.#clearMenu();
    this.#appendHeading("识别验证码");
    const status = this.#document.createElement("p");
    status.className = "status";
    status.textContent = message;
    this.#menu.append(status);
    this.#showMenu(target);
  }

  #showError(target: TotpQrTarget, message: string) {
    this.#clearMenu();
    this.#appendHeading("无法添加验证码");
    const status = this.#document.createElement("p");
    status.className = "status error";
    status.textContent = message;
    this.#menu.append(status);
    this.#appendCancel("关闭");
    this.#showMenu(target);
  }

  #appendHeading(label: string) {
    const heading = this.#document.createElement("h2");
    heading.className = "heading";
    const mark = this.#document.createElement("span");
    mark.className = "mark";
    mark.textContent = "V";
    heading.append(mark, this.#document.createTextNode(label));
    this.#menu.append(heading);
  }

  #appendCancel(label = "取消") {
    const actions = this.#document.createElement("div");
    actions.className = "actions";
    actions.append(this.#actionButton(label, () => void this.cancel()));
    this.#menu.append(actions);
  }

  #actionButton(label: string, action: () => void, primary = false) {
    const button = this.#document.createElement("button");
    button.className = `action${primary ? " primary" : ""}`;
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", (event) => { if (event.isTrusted) action(); });
    return button;
  }

  #clearMenu() { this.#menu.replaceChildren(); }

  #showMenu(target: TotpQrTarget) {
    this.#menuHost.style.display = "block";
    this.#positionMenu(target);
  }

  #hideMenu() { this.#menuHost.style.display = "none"; }

  async #cancelActive(hide: boolean) {
    const active = this.#active;
    this.#active = null;
    if (hide) this.#hideMenu();
    if (!active) return;
    await this.#sendMessage({
      kind: "vaultmesh.totp-capture.cancel",
      operationId: active.operationId,
      documentId: this.#documentId,
      targetHandle: active.targetHandle,
    }).catch(() => undefined);
  }

  #scheduleScan() {
    if (this.#disposed || this.#scanTimer) return;
    this.#scanTimer = setTimeout(() => {
      this.#scanTimer = null;
      this.scan();
    }, 150);
  }

  readonly #positionAll = () => {
    if (this.#disposed) return;
    const viewportWidth = this.#document.defaultView?.innerWidth ?? 1024;
    const viewportHeight = this.#document.defaultView?.innerHeight ?? 768;
    for (const trigger of this.#triggers.values()) {
      const rect = trigger.target.getBoundingClientRect();
      if (!trigger.target.isConnected || rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 || rect.top > viewportHeight) {
        trigger.host.style.display = "none";
        continue;
      }
      trigger.host.style.display = "block";
      const left = rect.right + 8 + 138 <= viewportWidth ? rect.right + 8 : Math.max(8, rect.left - 146);
      const top = Math.max(8, Math.min(viewportHeight - 38, rect.top + Math.max(0, (rect.height - 30) / 2)));
      trigger.host.style.left = `${Math.round(left)}px`;
      trigger.host.style.top = `${Math.round(top)}px`;
    }
    if (this.menuVisible && this.#active?.target) this.#positionMenu(this.#active.target);
  };

  #positionMenu(target: TotpQrTarget) {
    const rect = target.getBoundingClientRect();
    const viewportWidth = this.#document.defaultView?.innerWidth ?? 1024;
    const viewportHeight = this.#document.defaultView?.innerHeight ?? 768;
    const width = Math.min(320, viewportWidth - 16);
    this.#menuHost.style.width = `${width}px`;
    this.#menuHost.style.left = `${Math.max(8, Math.min(viewportWidth - width - 8, rect.left))}px`;
    const preferredTop = rect.bottom + 8;
    this.#menuHost.style.top = `${preferredTop + 220 <= viewportHeight ? preferredTop : Math.max(8, rect.top - 228)}px`;
  }

  readonly #onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && this.menuVisible) {
      event.preventDefault();
      void this.cancel();
    }
  };

  readonly #onPointerDown = (event: PointerEvent) => {
    if (!this.menuVisible) return;
    const target = event.target;
    if (target === this.#menuHost || Array.from(this.#triggers.values()).some((trigger) => target === trigger.host)) return;
    void this.cancel();
  };
}

export function startInlineTotpCapture(document: Document, documentId: string, sendMessage: SendMessage, onSaved: () => void) {
  return new InlineTotpCaptureController(document, documentId, sendMessage, onSaved);
}

function scopeLabel(scope: "path" | "origin" | "domain") {
  return scope === "path" ? "当前页面" : scope === "origin" ? "当前站点" : "同域名";
}

function captureStatusMessage(status: "locked" | "unavailable" | "unsupported-page" | "cancelled" | "expired") {
  if (status === "locked") return "VaultMesh 插件已锁定，请先在插件中解锁。";
  if (status === "expired") return "识别操作已过期，请重新点击二维码旁的按钮。";
  if (status === "unsupported-page") return "页面已变化，已取消本次识别。";
  if (status === "cancelled") return "已取消。";
  return "无法连接 VaultMesh，请重试。";
}

function isVaultMeshHostMutation(target: Node): boolean {
  return target instanceof Element && Boolean(target.closest("[data-vaultmesh-totp-qr-trigger],[data-vaultmesh-totp-qr-menu]"));
}
