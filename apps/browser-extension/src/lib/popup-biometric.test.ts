import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const desktopRpc = vi.hoisted(() => vi.fn());
vi.mock("./desktop-rpc", () => ({ desktopRpc }));
import { authenticatePopup } from "./popup-biometric";

describe("CT-BROWSER-001 bounded popup Touch ID", () => {
  beforeEach(() => { vi.useFakeTimers(); desktopRpc.mockReset(); });
  afterEach(() => vi.useRealTimers());
  it("starts once, polls without restarting the system dialog and cleans up after success", async () => {
    let polls = 0;
    desktopRpc.mockImplementation(async (operation: string) => ({ phase: operation.endsWith("poll") && ++polls === 2 ? "unlocked" : "waiting" }));
    const result = authenticatePopup(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(250);
    await result;
    expect(desktopRpc.mock.calls.filter(([op]) => op.endsWith("start"))).toHaveLength(1);
    const ids = desktopRpc.mock.calls.map(([, input]) => input.sessionId);
    expect(new Set(ids).size).toBe(1);
    expect(desktopRpc).toHaveBeenLastCalledWith("biometric.authentication.cancel", { sessionId: ids[0] });
  });
  it("cancels immediately while start is outstanding and rejects a late success", async () => {
    let respond!: (result: unknown) => void;
    desktopRpc.mockImplementation((op: string) => op.endsWith("start") ? new Promise((resolve) => { respond = resolve; }) : Promise.resolve({ cancelled: true }));
    const controller = new AbortController();
    const result = authenticatePopup(controller.signal);
    const rejected = expect(result).rejects.toThrow();
    controller.abort();
    await rejected;
    respond({ phase: "unlocked" });
    await vi.runAllTimersAsync();
    expect(desktopRpc.mock.calls.some(([op]) => op.endsWith("poll"))).toBe(false);
    expect(desktopRpc.mock.calls.some(([op]) => op.endsWith("cancel"))).toBe(true);
  });
  it("cancels a transport wait when the overall authentication deadline expires", async () => {
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    desktopRpc.mockImplementation((op: string) => op.endsWith("cancel") ? Promise.resolve({}) : new Promise(() => undefined));
    try {
      const result = authenticatePopup(new AbortController().signal);
      const rejected = expect(result).rejects.toThrow();
      deadline.abort(new Error("Touch ID timeout"));
      await rejected;
      expect(desktopRpc.mock.calls.some(([op]) => op.endsWith("cancel"))).toBe(true);
    } finally { timeout.mockRestore(); }
  });
  it("does not retry cancelled, failed, malformed or unsupported authentication", async () => {
    for (const outcome of [new Error("cancelled"), { phase: "unknown" }]) {
      desktopRpc.mockReset().mockImplementation(async (op: string) => {
        if (op.endsWith("cancel")) return {};
        if (outcome instanceof Error) throw outcome;
        return outcome;
      });
      await expect(authenticatePopup(new AbortController().signal)).rejects.toThrow();
      expect(desktopRpc.mock.calls.filter(([op]) => op.endsWith("start"))).toHaveLength(1);
    }
  });
});
