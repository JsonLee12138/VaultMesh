import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InlineTotpCaptureController } from "./inline-totp-capture";

const controllers: InlineTotpCaptureController[] = [];
let previousBarcodeDetector: unknown;

function makeVisible(element: HTMLElement, left = 40, top = 40) {
  Object.defineProperty(element, "getBoundingClientRect", { configurable: true, value: () => ({ left, right: left + 192, top, bottom: top + 192, width: 192, height: 192, x: left, y: top, toJSON() {} }) });
}

function controller(sendMessage: (message: unknown) => Promise<unknown>, onSaved = vi.fn()) {
  const result = new InlineTotpCaptureController(document, crypto.randomUUID(), sendMessage, onSaved);
  controllers.push(result);
  return { result, onSaved };
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = "";
  previousBarcodeDetector = (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
  (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = class {
    async detect(source: Element) {
      return [{ rawValue: source.id === "second"
        ? "otpauth://totp/Other:grace?secret=KRUGS4ZANFZSAYJA&issuer=Other"
        : "otpauth://totp/GitHub:ada?secret=JBSWY3DPEHPK3PXP&issuer=GitHub" }];
    }
  };
});

afterEach(() => {
  for (const value of controllers.splice(0)) value.dispose();
  (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = previousBarcodeDetector;
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("inline TOTP QR capture", () => {
  it("ignores a hidden GitHub loading placeholder and adds an adjacent trigger after its QR image appears", async () => {
    document.body.innerHTML = `
      <div data-target="two-factor-setup-verification.qrCodePlaceholder" hidden>
        <div class="qr-code-img"><svg aria-label="Loading QR code"></svg></div>
      </div>
    `;
    const { result } = controller(vi.fn(async () => null));
    expect(result.triggerCount).toBe(0);

    const placeholder = document.querySelector<HTMLElement>("[data-target]")!;
    placeholder.hidden = false;
    placeholder.innerHTML = '<img id="github-qr" src="data:image/png;base64,AA==">';
    makeVisible(placeholder.querySelector("img")!);
    await vi.advanceTimersByTimeAsync(160);

    expect(result.triggerCount).toBe(1);
    const host = document.querySelector<HTMLElement>("[data-vaultmesh-totp-qr-trigger]")!;
    expect(host.style.left).toBe("240px");
    expect(host.style.top).toBe("121px");
  });

  it("binds decoding to the clicked QR, saves the selected Login, and never exposes the URI in page DOM", async () => {
    const loginId = crypto.randomUUID();
    const operationId = crypto.randomUUID();
    document.body.innerHTML = `
      <div class="authenticator-qr"><img id="first" src="data:image/png;base64,AA=="></div>
      <div class="authenticator-qr"><img id="second" src="data:image/png;base64,AA=="></div>
    `;
    const images = Array.from(document.querySelectorAll<HTMLElement>("img"));
    images.forEach((image, index) => makeVisible(image, 40 + index * 240, 40));
    const sendMessage = vi.fn(async (message: unknown) => {
      const value = message as { kind?: string };
      if (value.kind === "vaultmesh.totp-capture.begin") {
        return {
          status: "ready", operationId, expiresAt: new Date(Date.now() + 60_000).toISOString(),
          candidates: [{ id: loginId, title: "GitHub", username: "ada", url: "https://github.com/login", hasTotpSecret: false, matchScope: "origin" }],
        };
      }
      if (value.kind === "vaultmesh.totp-capture.save") return { status: "saved", loginId, title: "GitHub" };
      return { status: "cancelled" };
    });
    const { result, onSaved } = controller(sendMessage);

    await result.recognize(images[1]!);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      kind: "vaultmesh.totp-capture.begin",
      value: expect.objectContaining({ issuer: "Other", account: "grace" }),
    }));
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ value: expect.objectContaining({ issuer: "GitHub" }) }));
    expect(result.menuVisible).toBe(true);

    await result.select(loginId);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: "vaultmesh.totp-capture.save", operationId, loginId, overwrite: false }));
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(result.activeOperationId).toBeNull();
    expect(document.documentElement.innerHTML).not.toContain("otpauth://");
  });

  it("requires explicit confirmation before overwriting an existing TOTP", async () => {
    const loginId = crypto.randomUUID();
    const operationId = crypto.randomUUID();
    document.body.innerHTML = '<div class="authenticator-qr"><img id="first" src="data:image/png;base64,AA=="></div>';
    const image = document.querySelector<HTMLElement>("img")!;
    makeVisible(image);
    const sendMessage = vi.fn(async (message: unknown) => {
      const value = message as { kind?: string };
      if (value.kind === "vaultmesh.totp-capture.begin") return {
        status: "ready", operationId, expiresAt: new Date(Date.now() + 60_000).toISOString(),
        candidates: [{ id: loginId, title: "GitHub", username: "ada", url: "https://github.com", hasTotpSecret: true }],
      };
      if (value.kind === "vaultmesh.totp-capture.save") return { status: "saved", loginId, title: "GitHub" };
      return { status: "cancelled" };
    });
    const { result } = controller(sendMessage);
    await result.recognize(image);

    await result.select(loginId);
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "vaultmesh.totp-capture.save" }));
    await result.confirmOverwrite();
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: "vaultmesh.totp-capture.save", overwrite: true }));
  });

  it("cancels the bounded operation when its QR target is removed", async () => {
    const loginId = crypto.randomUUID();
    const operationId = crypto.randomUUID();
    document.body.innerHTML = '<div class="authenticator-qr"><img id="first" src="data:image/png;base64,AA=="></div>';
    const image = document.querySelector<HTMLElement>("img")!;
    makeVisible(image);
    const sendMessage = vi.fn(async (message: unknown) => (message as { kind?: string }).kind === "vaultmesh.totp-capture.begin"
      ? { status: "ready", operationId, expiresAt: new Date(Date.now() + 60_000).toISOString(), candidates: [{ id: loginId, title: "GitHub", username: "ada", url: null, hasTotpSecret: false }] }
      : { status: "cancelled" });
    const { result } = controller(sendMessage);
    await result.recognize(image);
    image.remove();
    await vi.advanceTimersByTimeAsync(160);

    expect(result.triggerCount).toBe(0);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: "vaultmesh.totp-capture.cancel", operationId }));
  });
});
