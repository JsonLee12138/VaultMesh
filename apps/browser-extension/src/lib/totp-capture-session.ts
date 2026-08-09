import { AutofillCandidateSchema, TotpCaptureLoginSchema, type PopupMessage } from "@/lib/protocol";

export type TotpCapturePage = {
  tabId: number;
  frameId: number;
  fillOrigin: string;
  framePageUrl: string;
};

type Rpc = (operation: string, input?: Record<string, unknown>) => Promise<unknown>;
type PendingTotpCapture = {
  operationId: string;
  page: TotpCapturePage;
  documentId: string;
  targetHandle: string;
  candidateIds: Set<string>;
  uri: string;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
};

export class TotpCaptureRegistry {
  readonly #rpc: Rpc;
  readonly #lifetimeMs: number;
  readonly #now: () => number;
  readonly #uuid: () => string;
  readonly #pending = new Map<string, PendingTotpCapture>();

  constructor(rpc: Rpc, options: { lifetimeMs?: number; now?: () => number; uuid?: () => string } = {}) {
    this.#rpc = rpc;
    this.#lifetimeMs = options.lifetimeMs ?? 60_000;
    this.#now = options.now ?? (() => Date.now());
    this.#uuid = options.uuid ?? (() => crypto.randomUUID());
  }

  get size() { return this.#pending.size; }

  async begin(message: Extract<PopupMessage, { kind: "vaultmesh.totp-capture.begin" }>, page: TotpCapturePage) {
    this.#discardMatching(page, message.documentId, message.targetHandle);
    try {
      const summaries = await this.#rpc("items.list") as unknown;
      const matchResult = await this.#rpc("browser.autofill.candidates", {
        topOrigin: page.fillOrigin,
        pageUrl: page.framePageUrl,
        fieldKind: "login",
        pageContext: "unknown",
      }) as { candidates?: unknown };
      const matching = AutofillCandidateSchema.array().max(200).safeParse(matchResult?.candidates);
      if (!matching.success) return { status: "unavailable" as const };
      const scopes = new Map(matching.data.filter((candidate) => candidate.kind === "login")
        .map((candidate) => [candidate.id, candidate.matchScope] as const));
      const order = new Map(matching.data.map((candidate, index) => [candidate.id, index] as const));
      const source = Array.isArray(summaries) ? summaries : [];
      const candidates = source.flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const item = value as Record<string, unknown>;
        const parsed = TotpCaptureLoginSchema.safeParse({
          id: item.id,
          title: item.title,
          username: item.username,
          url: item.url,
          hasTotpSecret: item.hasTotpSecret,
          ...(typeof item.id === "string" && scopes.get(item.id) ? { matchScope: scopes.get(item.id) } : {}),
        });
        return parsed.success ? [parsed.data] : [];
      }).sort((left, right) => (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER));
      const operationId = this.#uuid();
      const expiresAt = this.#now() + this.#lifetimeMs;
      const pending: PendingTotpCapture = {
        operationId,
        page,
        documentId: message.documentId,
        targetHandle: message.targetHandle,
        candidateIds: new Set(candidates.map((candidate) => candidate.id)),
        uri: message.value.uri,
        expiresAt,
        timer: setTimeout(() => this.discard(operationId), this.#lifetimeMs),
      };
      this.#pending.set(operationId, pending);
      return { status: "ready" as const, operationId, expiresAt: new Date(expiresAt).toISOString(), candidates };
    } catch (error) {
      return { status: rpcFailureStatus(error) };
    }
  }

  async save(message: Extract<PopupMessage, { kind: "vaultmesh.totp-capture.save" }>, page: TotpCapturePage) {
    const pending = this.#current(message.operationId);
    if (!pending) return { status: "expired" as const };
    if (!matches(pending, page, message.documentId, message.targetHandle)) return { status: "unsupported-page" as const };
    if (!pending.candidateIds.has(message.loginId)) return { status: "unsupported-page" as const };
    try {
      const detail = await this.#rpc("items.detail", { id: message.loginId }) as Record<string, unknown>;
      const title = String(detail.title ?? "Login").slice(0, 256);
      if (detail.hasTotpSecret === true && !message.overwrite) {
        return { status: "overwrite-required" as const, loginId: message.loginId, title };
      }
      await this.#rpc("items.update", {
        id: message.loginId,
        title: detail.title,
        username: detail.username ?? "",
        password: null,
        url: detail.url ?? null,
        notes: detail.notes ?? null,
        folder: detail.folder ?? null,
        favorite: detail.favorite ?? false,
        totpSecret: pending.uri,
        clearTotpSecret: false,
        additionalUrls: detail.additionalUrls ?? [],
        autofillOnPageLoad: detail.autofillOnPageLoad ?? true,
        masterPasswordReprompt: detail.masterPasswordReprompt ?? false,
        customFields: detail.customFields ?? [],
      });
      this.discard(pending.operationId);
      return { status: "saved" as const, loginId: message.loginId, title };
    } catch (error) {
      this.discard(pending.operationId);
      return { status: rpcFailureStatus(error) };
    }
  }

  cancel(message: Extract<PopupMessage, { kind: "vaultmesh.totp-capture.cancel" }>, page: TotpCapturePage) {
    const pending = this.#current(message.operationId);
    if (!pending) return { status: "expired" as const };
    if (!matches(pending, page, message.documentId, message.targetHandle)) return { status: "unsupported-page" as const };
    this.discard(pending.operationId);
    return { status: "cancelled" as const };
  }

  discard(operationId: string) {
    const pending = this.#pending.get(operationId);
    if (pending) clearTimeout(pending.timer);
    this.#pending.delete(operationId);
  }

  discardForTab(tabId: number) {
    for (const pending of this.#pending.values()) if (pending.page.tabId === tabId) this.discard(pending.operationId);
  }

  discardForFrame(tabId: number, frameId: number) {
    for (const pending of this.#pending.values()) {
      if (pending.page.tabId === tabId && pending.page.frameId === frameId) this.discard(pending.operationId);
    }
  }

  discardAll() {
    for (const operationId of this.#pending.keys()) this.discard(operationId);
  }

  #current(operationId: string) {
    const pending = this.#pending.get(operationId);
    if (!pending || pending.expiresAt <= this.#now()) {
      this.discard(operationId);
      return null;
    }
    return pending;
  }

  #discardMatching(page: TotpCapturePage, documentId: string, targetHandle: string) {
    for (const pending of this.#pending.values()) {
      if (matches(pending, page, documentId, targetHandle)) this.discard(pending.operationId);
    }
  }
}

function matches(pending: PendingTotpCapture, page: TotpCapturePage, documentId: string, targetHandle: string) {
  return pending.page.tabId === page.tabId
    && pending.page.frameId === page.frameId
    && pending.page.fillOrigin === page.fillOrigin
    && pending.page.framePageUrl === page.framePageUrl
    && pending.documentId === documentId
    && pending.targetHandle === targetHandle;
}

function rpcFailureStatus(error: unknown): "locked" | "unavailable" {
  return error && typeof error === "object" && "code" in error && error.code === "unlock-required" ? "locked" : "unavailable";
}
