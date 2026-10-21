import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const desktopRpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/desktop-rpc", () => ({ desktopRpc }));
import { PopupUnlockPage } from "./popup-unlock-page";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
let container: HTMLDivElement;
let root: Root;
const onUnlocked = vi.fn();
const pin = { enabled: true, locked: false, remainingAttempts: 5 };
function button(text: string) { return Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes(text))!; }
async function render(strict = false) {
  await act(async () => {
    const page = createElement(PopupUnlockPage, { hasVault: true, onUnlocked });
    root.render(strict ? createElement(StrictMode, null, page) : page);
  });
}
describe("CT-SEC-002/CT-BROWSER-001 popup Touch ID unlock", () => {
  beforeEach(() => {
    vi.useFakeTimers(); onUnlocked.mockReset().mockResolvedValue(true);
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    desktopRpc.mockReset().mockImplementation(async (op: string) => {
      if (op === "pin.status") return pin;
      if (op === "biometric.status") return { available: true, enabled: true, followsDesktop: true };
      return { phase: "waiting" };
    });
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
  it("automatically starts once even with StrictMode and preserves fallback inputs", async () => {
    await render(true);
    expect(desktopRpc.mock.calls.filter(([op]) => op === "biometric.authentication.start")).toHaveLength(1);
    expect(container.textContent).toContain("正在等待 Touch ID");
    expect(button("改用主密码").disabled).toBe(false);
    await act(async () => button("改用主密码").click());
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
    expect(desktopRpc.mock.calls.some(([op]) => op === "biometric.authentication.cancel")).toBe(true);
    expect(onUnlocked).not.toHaveBeenCalled();
  });
  it("loads the workspace only after authentication, with visible loading progress", async () => {
    let finish!: (value: boolean) => void;
    onUnlocked.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    desktopRpc.mockImplementation(async (op: string) => {
      if (op === "pin.status") return pin;
      if (op === "biometric.status") return { available: true, enabled: true };
      return { phase: op.endsWith("poll") ? "unlocked" : "waiting" };
    });
    await render();
    expect(onUnlocked).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("验证成功，正在读取保险库");
    await act(async () => finish(true));
  });
  it("offers explicit retry after cancellation without automatically showing another dialog", async () => {
    desktopRpc.mockImplementation(async (op: string) => {
      if (op === "pin.status") return pin;
      if (op === "biometric.status") return { available: true, enabled: true };
      if (op.endsWith("poll")) throw new Error("Touch ID 验证未完成");
      return { phase: "waiting" };
    });
    await render(); await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(desktopRpc.mock.calls.filter(([op]) => op.endsWith("start"))).toHaveLength(1);
    await act(async () => button("使用 Touch ID").click());
    expect(desktopRpc.mock.calls.filter(([op]) => op.endsWith("start"))).toHaveLength(2);
    expect(onUnlocked).not.toHaveBeenCalled();
  });
  it.each([{ available: true, enabled: false }, { available: false, enabled: true }])("retains PIN and password without starting when status is %j", async (status) => {
    desktopRpc.mockImplementation(async (op: string) => op === "pin.status" ? pin : status);
    await render();
    expect(desktopRpc.mock.calls.some(([op]) => op.endsWith("start"))).toBe(false);
    expect(container.querySelector('[aria-label="6 位插件 PIN"]')).not.toBeNull();
    expect(button("改用主密码")).toBeDefined();
  });
  it("keeps password fallback when both quick-unlock queries fail", async () => {
    desktopRpc.mockRejectedValue(new Error("desktop-unavailable"));
    await render();
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
    expect(desktopRpc.mock.calls.some(([op]) => op.endsWith("start"))).toBe(false);
  });
  it("does not interrupt a password choice with a late capability response", async () => {
    let respond!: (value: unknown) => void;
    desktopRpc.mockImplementation((op: string) => op === "pin.status" ? Promise.resolve(pin)
      : new Promise((resolve) => { respond = resolve; }));
    await render();
    await act(async () => button("改用主密码").click());
    await act(async () => respond({ available: true, enabled: true }));
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
    expect(desktopRpc.mock.calls.some(([op]) => op.endsWith("start"))).toBe(false);
  });
  it("drops a late authentication result after pagehide", async () => {
    let respond!: (value: unknown) => void;
    desktopRpc.mockImplementation((op: string) => {
      if (op === "pin.status") return Promise.resolve(pin);
      if (op === "biometric.status") return Promise.resolve({ available: true, enabled: true });
      if (op.endsWith("poll")) return new Promise((resolve) => { respond = resolve; });
      return Promise.resolve({ phase: "waiting" });
    });
    await render();
    await act(async () => window.dispatchEvent(new Event("pagehide")));
    await act(async () => respond({ phase: "unlocked" }));
    expect(onUnlocked).not.toHaveBeenCalled();
    expect(desktopRpc.mock.calls.some(([op]) => op.endsWith("cancel"))).toBe(true);
  });
});
