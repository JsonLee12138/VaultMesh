import { SAVE_CAPTURE_DECISION_TIMEOUT_MS } from "./save-capture-countdown";

export type SaveCapturePromptDetails = {
  captureId: string;
  hostname: string;
  labels: string[];
  update: boolean;
  expiresAt?: number;
  actions?: { login?: "new" | "update"; identity?: "new" | "update"; card?: "new" | "update"; secret?: "new" | "update"; ssh?: "new" | "update" };
};

type Decision = "save" | "ignore";
type DecisionResult = { status: "saved" | "discarded" | "expired" | "failed" | "unsupported-page" };
export type SaveCaptureQueueFailure = "account-check-failed" | "save-check-failed" | "background-outdated" | "background-unavailable" | "unsupported-page" | "invalid-response";

export class SaveCapturePrompt {
  readonly #host: HTMLDivElement;
  readonly #document: Document;
  readonly #panel: HTMLDivElement;
  readonly #title: HTMLSpanElement;
  readonly #status: HTMLParagraphElement;
  readonly #saveButton: HTMLButtonElement;
  readonly #ignoreButton: HTMLButtonElement;
  readonly #timeoutBar: HTMLDivElement;
  readonly #onDecision: (captureId: string, decision: Decision) => Promise<DecisionResult>;
  #details: SaveCapturePromptDetails | null = null;
  #busy = false;
  #failed = false;
  #hideTimer: ReturnType<typeof setTimeout> | null = null;
  #autoCloseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(document: Document, onDecision: (captureId: string, decision: Decision) => Promise<DecisionResult>) {
    this.#document = document;
    this.#onDecision = onDecision;
    this.#host = document.createElement("div");
    this.#host.dataset.vaultmeshSavePrompt = "";
    this.#host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;display:none;pointer-events:none";
    const shadow = this.#host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host { color-scheme:light; }
      * { box-sizing:border-box; }
      .panel { position:absolute;right:16px;top:16px;width:min(280px,calc(100vw - 24px));padding:10px 10px 8px;border:1px solid rgba(92,75,210,.24);border-radius:11px;background:#fff;color:#17202a;box-shadow:0 12px 32px rgba(20,24,40,.2),0 2px 6px rgba(20,24,40,.1);font:13px/1.4 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;pointer-events:auto;overflow:hidden;animation:enter .16s ease-out; }
      .brand { display:flex;align-items:center;gap:6px;color:#17202a;font-size:14px;font-weight:800; }
      .mark { display:grid;width:22px;height:22px;place-items:center;border-radius:6px;background:#6d5dfc;color:#fff;font-size:12px;font-weight:900; }
      .status { min-height:0;margin:6px 0 0;color:#596579;font-size:11px; }
      .status:empty { display:none; }
      .status[data-state="error"] { color:#b42318; }
      .status[data-state="success"] { color:#087a55; }
      .actions { display:flex;justify-content:flex-end;gap:5px;margin-top:7px; }
      button { appearance:none;border:1px solid #d7dce5;background:#fff;color:#344054;font-family:ui-sans-serif,system-ui,sans-serif;font-weight:700;line-height:1;cursor:pointer; }
      button[data-size="xs"] { min-width:46px;height:26px;padding:0 9px;border-radius:7px;font-size:12px; }
      button.primary { border-color:#6d5dfc;background:#6d5dfc;color:#fff; }
      button:hover:not(:disabled) { filter:brightness(.97); }
      button:focus-visible { outline:3px solid rgba(109,93,252,.28);outline-offset:2px; }
      button:disabled { cursor:wait;opacity:.62; }
      .timeout { height:2px;margin:8px -10px -8px;background:#ece9ff;overflow:hidden; }
      .timeout-bar { width:100%;height:100%;background:#6d5dfc;transform-origin:left center;animation:countdown ${SAVE_CAPTURE_DECISION_TIMEOUT_MS}ms linear forwards; }
      @keyframes enter { from { opacity:0;transform:translateY(8px) scale(.98); } }
      @keyframes countdown { to { transform:scaleX(0); } }
      @media (max-width:520px) { .panel { right:12px;top:12px; } }
      @media (prefers-reduced-motion:reduce) { .panel { animation:none; } }
    `;
    this.#panel = document.createElement("div");
    this.#panel.className = "panel";
    this.#panel.setAttribute("role", "dialog");
    this.#panel.setAttribute("aria-modal", "false");
    this.#panel.setAttribute("aria-labelledby", "vaultmesh-save-title");
    const brand = document.createElement("div");
    brand.className = "brand";
    const mark = document.createElement("span");
    mark.className = "mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = "V";
    this.#title = document.createElement("span");
    this.#title.id = "vaultmesh-save-title";
    brand.append(mark, this.#title);
    this.#status = document.createElement("p");
    this.#status.className = "status";
    this.#status.setAttribute("aria-live", "polite");
    const actions = document.createElement("div");
    actions.className = "actions";
    this.#ignoreButton = document.createElement("button");
    this.#ignoreButton.type = "button";
    this.#ignoreButton.dataset.size = "xs";
    this.#ignoreButton.textContent = "忽略";
    this.#saveButton = document.createElement("button");
    this.#saveButton.type = "button";
    this.#saveButton.dataset.size = "xs";
    this.#saveButton.className = "primary";
    actions.append(this.#ignoreButton, this.#saveButton);
    const timeout = document.createElement("div");
    timeout.className = "timeout";
    timeout.setAttribute("aria-hidden", "true");
    this.#timeoutBar = document.createElement("div");
    this.#timeoutBar.className = "timeout-bar";
    timeout.append(this.#timeoutBar);
    this.#panel.append(brand, this.#status, actions, timeout);
    shadow.append(style, this.#panel);
    document.documentElement.append(this.#host);
    this.#saveButton.addEventListener("click", () => void this.choose("save"));
    this.#ignoreButton.addEventListener("click", () => void this.choose("ignore"));
    this.#panel.addEventListener("keydown", this.#onKeyDown);
  }

  get visible() { return this.#host.style.display !== "none"; }
  get captureId() { return this.#details?.captureId ?? null; }
  get title() { return this.#title.textContent ?? ""; }

  showPreparing(details: SaveCapturePromptDetails, visible = true) {
    this.show(details);
    this.#stopAutoClose();
    this.#timeoutBar.style.animationPlayState = "paused";
    this.#busy = true;
    this.#title.textContent = details.labels.includes("登录信息") ? "正在检查账号…" : "正在准备保存…";
    this.#host.dataset.vaultmeshPromptTitle = this.#title.textContent;
    this.#status.textContent = "正在连接 VaultMesh…";
    this.#saveButton.disabled = true;
    this.#ignoreButton.disabled = true;
    if (!visible) this.#host.style.display = "none";
  }

  show(details: SaveCapturePromptDetails) {
    if (this.#hideTimer) clearTimeout(this.#hideTimer);
    this.#details = details;
    this.#busy = false;
    this.#failed = false;
    this.#host.dataset.vaultmeshCaptureId = details.captureId;
    delete this.#host.dataset.vaultmeshQueueFailure;
    this.#title.textContent = saveCapturePromptTitle(details);
    this.#host.dataset.vaultmeshPromptTitle = this.#title.textContent;
    this.#status.textContent = "";
    this.#status.removeAttribute("data-state");
    this.#saveButton.textContent = saveCapturePromptActionLabel(details);
    this.#ignoreButton.textContent = "忽略";
    this.#saveButton.disabled = false;
    this.#ignoreButton.disabled = false;
    this.#host.style.display = "block";
    this.#startAutoClose(details.expiresAt ? Math.max(0, details.expiresAt - Date.now()) : SAVE_CAPTURE_DECISION_TIMEOUT_MS);
    this.#document.defaultView?.requestAnimationFrame(() => this.#saveButton.focus({ preventScroll: true }));
  }

  showQueueFailure(captureId: string, reason: SaveCaptureQueueFailure) {
    if (this.#details?.captureId !== captureId) return;
    this.#busy = false;
    this.#failed = true;
    this.#stopAutoClose();
    this.#host.dataset.vaultmeshQueueFailure = reason;
    this.#status.textContent = reason === "account-check-failed"
      ? "无法核对当前站点的已有账号，本次不会保存或覆盖。请解锁 VaultMesh 后重新提交。"
      : reason === "save-check-failed"
        ? "无法核对 VaultMesh 中已有的个人资料或支付卡，本次不会保存或覆盖。请解锁后重新提交。"
      : reason === "background-outdated"
      ? "VaultMesh 扩展后台版本未同步。请在扩展管理页点击“重新加载”；只刷新网页不会更新后台。"
      : reason === "unsupported-page"
        ? "VaultMesh 拒绝了当前页面来源。请使用 HTTP(S) 测试页，并确认扩展拥有此网站权限。"
        : reason === "background-unavailable"
          ? "VaultMesh 扩展后台没有响应。请在扩展管理页重新加载 VaultMesh。"
          : "VaultMesh 扩展后台返回了无法识别的结果。请重新加载整个扩展。";
    this.#status.dataset.state = "error";
    this.#saveButton.disabled = true;
    this.#ignoreButton.disabled = false;
    this.#ignoreButton.textContent = "关闭";
    this.#host.style.display = "block";
  }

  hide() {
    if (this.#hideTimer) clearTimeout(this.#hideTimer);
    this.#stopAutoClose();
    this.#hideTimer = null;
    this.#details = null;
    this.#busy = false;
    this.#failed = false;
    delete this.#host.dataset.vaultmeshCaptureId;
    delete this.#host.dataset.vaultmeshQueueFailure;
    delete this.#host.dataset.vaultmeshPromptTitle;
    this.#host.style.display = "none";
  }

  async choose(decision: Decision) {
    if (!this.#details || this.#busy) return;
    if (decision === "ignore" && this.#failed) return this.hide();
    const { captureId } = this.#details;
    this.#stopAutoClose();
    this.#busy = true;
    this.#saveButton.disabled = true;
    this.#ignoreButton.disabled = true;
    this.#status.textContent = decision === "save" ? "正在保存…" : "正在忽略…";
    const result = await this.#onDecision(captureId, decision).catch(() => ({ status: "failed" as const }));
    if (this.#details?.captureId !== captureId) return;
    if (result.status === "saved") {
      this.#status.textContent = "已保存到 VaultMesh。";
      this.#status.dataset.state = "success";
      this.#hideTimer = setTimeout(() => this.hide(), 1_500);
      return;
    }
    if (result.status === "discarded") return this.hide();
    this.#busy = false;
    this.#failed = true;
    this.#status.textContent = result.status === "expired"
      ? "此保存请求已过期，请重新提交表单。"
      : "保存失败。请先解锁 VaultMesh，然后重新提交表单。";
    this.#status.dataset.state = "error";
    this.#saveButton.disabled = true;
    this.#ignoreButton.disabled = false;
    this.#ignoreButton.textContent = "关闭";
  }

  destroy() {
    this.hide();
    this.#panel.removeEventListener("keydown", this.#onKeyDown);
    this.#host.remove();
  }

  readonly #onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !this.#busy) {
      event.preventDefault();
      void this.choose("ignore");
    }
  };

  #startAutoClose(timeoutMs: number) {
    this.#stopAutoClose();
    this.#timeoutBar.style.animation = "none";
    this.#timeoutBar.style.transform = `scaleX(${Math.min(1, timeoutMs / SAVE_CAPTURE_DECISION_TIMEOUT_MS)})`;
    void this.#timeoutBar.offsetWidth;
    this.#timeoutBar.style.animation = `countdown ${timeoutMs}ms linear forwards`;
    this.#timeoutBar.style.animationPlayState = "running";
    this.#autoCloseTimer = setTimeout(() => void this.choose("ignore"), timeoutMs);
  }

  #stopAutoClose() {
    if (this.#autoCloseTimer) clearTimeout(this.#autoCloseTimer);
    this.#autoCloseTimer = null;
    this.#timeoutBar?.style.setProperty("animation-play-state", "paused");
  }

}

export function saveCapturePromptTitle(details: SaveCapturePromptDetails): string {
  if (details.labels.length === 1 && details.labels[0] === "登录信息") return promptAction(details, "登录信息") === "update" ? "更新密码？" : "保存新账号？";
  if (details.labels.length === 1 && details.labels[0] === "个人资料/地址") return promptAction(details, "个人资料/地址") === "update" ? "更新个人资料？" : "保存个人资料？";
  if (details.labels.length === 1 && details.labels[0] === "支付卡") return promptAction(details, "支付卡") === "update" ? "更新支付卡？" : "保存支付卡？";
  const actions = promptActions(details);
  if (actions.length > 0 && actions.every((action) => action === "update")) return "更新这些信息？";
  if (actions.some((action) => action === "update")) return "保存并更新这些信息？";
  return "保存这些信息？";
}

export function saveCapturePromptActionLabel(details: SaveCapturePromptDetails): "保存" | "更新" | "确认" {
  const actions = promptActions(details);
  return actions.length > 0 && actions.every((action) => action === "update")
    ? "更新"
    : actions.some((action) => action === "update") ? "确认" : "保存";
}

function promptActions(details: SaveCapturePromptDetails): Array<"new" | "update"> {
  return details.labels.map((label) => promptAction(details, label));
}

function promptAction(details: SaveCapturePromptDetails, label: string): "new" | "update" {
  const action = label === "登录信息" ? details.actions?.login
    : label === "个人资料/地址" ? details.actions?.identity
      : label === "支付卡" ? details.actions?.card
        : label === "密钥" ? details.actions?.secret
          : label === "SSH 凭据" ? details.actions?.ssh
        : undefined;
  return action ?? (details.update ? "update" : "new");
}
