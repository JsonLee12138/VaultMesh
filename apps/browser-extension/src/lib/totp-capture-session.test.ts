import { afterEach, describe, expect, it, vi } from "vitest";

import { TotpCaptureRegistry, type TotpCapturePage } from "./totp-capture-session";

const page: TotpCapturePage = { tabId: 7, frameId: 0, fillOrigin: "https://github.com", framePageUrl: "https://github.com/settings/security" };
const documentId = "953370ec-4dc7-4c77-a6e0-f2a4f6e37f03";
const targetHandle = "a53370ec-4dc7-4c77-a6e0-f2a4f6e37f03";
const operationId = "b53370ec-4dc7-4c77-a6e0-f2a4f6e37f03";
const loginId = "c53370ec-4dc7-4c77-a6e0-f2a4f6e37f03";
const otherLoginId = "d53370ec-4dc7-4c77-a6e0-f2a4f6e37f03";
const uri = "otpauth://totp/GitHub:ada?secret=JBSWY3DPEHPK3PXP&issuer=GitHub";

function beginMessage() {
  return { kind: "vaultmesh.totp-capture.begin" as const, documentId, targetHandle, value: { uri, issuer: "GitHub", account: "ada" } };
}

function saveMessage(overwrite = false) {
  return { kind: "vaultmesh.totp-capture.save" as const, operationId, documentId, targetHandle, loginId, overwrite };
}

function rpcFixture(options: { hasTotp?: boolean; failUpdate?: boolean } = {}) {
  const rpc = vi.fn(async (operation: string) => {
    if (operation === "items.list") return [
      { id: otherLoginId, title: "Other", username: "grace", url: "https://other.example/login", notes: null, hasTotpSecret: false, autofillOnPageLoad: true, masterPasswordReprompt: false },
      { id: loginId, title: "GitHub", username: "ada", url: "https://github.com/login", notes: null, hasTotpSecret: Boolean(options.hasTotp), autofillOnPageLoad: true, masterPasswordReprompt: false },
    ];
    if (operation === "browser.autofill.candidates") return { candidates: [
      { id: loginId, kind: "login", title: "GitHub", subtitle: "ada", matchScope: "origin" },
    ] };
    if (operation === "items.detail") return {
      id: loginId, title: "GitHub", username: "ada", url: "https://github.com/login", notes: "keep", folder: "Work", favorite: true,
      hasTotpSecret: Boolean(options.hasTotp), additionalUrls: ["https://github.com/session"], autofillOnPageLoad: false,
      masterPasswordReprompt: true, customFields: [{ label: "Tenant", value: "engine-7" }],
    };
    if (operation === "items.update" && options.failUpdate) throw new Error("disk write failed");
    return {};
  });
  return rpc;
}

afterEach(() => vi.useRealTimers());

describe("bounded inline TOTP capture registry", () => {
  it("prioritizes same-site Login metadata and atomically updates only the selected Login's TOTP", async () => {
    const rpc = rpcFixture();
    const registry = new TotpCaptureRegistry(rpc, { uuid: () => operationId });
    const begun = await registry.begin(beginMessage(), page);
    expect(begun).toMatchObject({ status: "ready", operationId, candidates: [
      { id: loginId, title: "GitHub", matchScope: "origin" },
      { id: otherLoginId, title: "Other" },
    ] });
    expect(registry.size).toBe(1);

    await expect(registry.save(saveMessage(), page)).resolves.toEqual({ status: "saved", loginId, title: "GitHub" });
    expect(rpc).toHaveBeenCalledWith("items.update", {
      id: loginId,
      title: "GitHub",
      username: "ada",
      password: null,
      url: "https://github.com/login",
      notes: "keep",
      folder: "Work",
      favorite: true,
      totpSecret: uri,
      clearTotpSecret: false,
      additionalUrls: ["https://github.com/session"],
      autofillOnPageLoad: false,
      masterPasswordReprompt: true,
      customFields: [{ label: "Tenant", value: "engine-7" }],
    });
    expect(registry.size).toBe(0);
  });

  it("revalidates an existing TOTP and keeps the bounded operation only while overwrite confirmation is pending", async () => {
    const rpc = rpcFixture({ hasTotp: true });
    const registry = new TotpCaptureRegistry(rpc, { uuid: () => operationId });
    await registry.begin(beginMessage(), page);

    await expect(registry.save(saveMessage(false), page)).resolves.toEqual({ status: "overwrite-required", loginId, title: "GitHub" });
    expect(rpc).not.toHaveBeenCalledWith("items.update", expect.anything());
    expect(registry.size).toBe(1);
    await expect(registry.save(saveMessage(true), page)).resolves.toMatchObject({ status: "saved" });
    expect(registry.size).toBe(0);
  });

  it("rejects mismatched frame/document/target context without consuming the valid operation", async () => {
    const registry = new TotpCaptureRegistry(rpcFixture(), { uuid: () => operationId });
    await registry.begin(beginMessage(), page);
    await expect(registry.save({ ...saveMessage(), documentId: crypto.randomUUID() }, page)).resolves.toEqual({ status: "unsupported-page" });
    await expect(registry.save(saveMessage(), { ...page, frameId: 2 })).resolves.toEqual({ status: "unsupported-page" });
    await expect(registry.save({ ...saveMessage(), loginId: crypto.randomUUID() }, page)).resolves.toEqual({ status: "unsupported-page" });
    expect(registry.size).toBe(1);
    expect(registry.cancel({ kind: "vaultmesh.totp-capture.cancel", operationId, documentId, targetHandle }, page)).toEqual({ status: "cancelled" });
    expect(registry.size).toBe(0);
  });

  it("expires, replaces duplicate target operations, and clears navigation state", async () => {
    vi.useFakeTimers();
    let now = 1_000;
    const replacementId = crypto.randomUUID();
    const ids = [operationId, replacementId];
    const registry = new TotpCaptureRegistry(rpcFixture(), { lifetimeMs: 100, now: () => now, uuid: () => ids.shift()! });
    await registry.begin(beginMessage(), page);
    await registry.begin(beginMessage(), page);
    expect(registry.size).toBe(1);
    now += 101;
    await expect(registry.save({ ...saveMessage(), operationId: replacementId }, page)).resolves.toEqual({ status: "expired" });
    registry.discardForFrame(page.tabId, page.frameId);
    expect(registry.size).toBe(0);
  });

  it("clears the secret-bearing operation after a persistence failure or lock rejection", async () => {
    const failed = new TotpCaptureRegistry(rpcFixture({ failUpdate: true }), { uuid: () => operationId });
    await failed.begin(beginMessage(), page);
    await expect(failed.save(saveMessage(), page)).resolves.toEqual({ status: "unavailable" });
    expect(failed.size).toBe(0);

    const lockedRpc = vi.fn(async () => { throw Object.assign(new Error("locked"), { code: "unlock-required" }); });
    const locked = new TotpCaptureRegistry(lockedRpc, { uuid: () => operationId });
    await expect(locked.begin(beginMessage(), page)).resolves.toEqual({ status: "locked" });
    expect(locked.size).toBe(0);
  });
});
