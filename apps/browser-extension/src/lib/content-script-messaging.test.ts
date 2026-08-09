import { describe, expect, it, vi } from "vitest";

import { createContentScriptMessageSender, registerContentScriptMessageListener } from "./content-script-messaging";

describe("content script messaging", () => {
  it("returns successful runtime responses", async () => {
    const runtimeSend = vi.fn(async () => ({ status: "ready" }));
    const onContextInvalidated = vi.fn();
    const sendMessage = createContentScriptMessageSender(runtimeSend, onContextInvalidated);

    await expect(sendMessage({ kind: "test" })).resolves.toEqual({ status: "ready" });
    expect(onContextInvalidated).not.toHaveBeenCalled();
  });

  it("absorbs transient messaging failures without invalidating the content script", async () => {
    const runtimeSend = vi.fn()
      .mockRejectedValueOnce(new Error("Could not establish connection. Receiving end does not exist."))
      .mockResolvedValueOnce({ status: "ready" });
    const onContextInvalidated = vi.fn();
    const sendMessage = createContentScriptMessageSender(runtimeSend, onContextInvalidated);

    await expect(sendMessage({ kind: "first" })).resolves.toBeUndefined();
    await expect(sendMessage({ kind: "second" })).resolves.toEqual({ status: "ready" });
    expect(runtimeSend).toHaveBeenCalledTimes(2);
    expect(onContextInvalidated).not.toHaveBeenCalled();
  });

  it("invalidates once and skips future runtime calls after the extension context is lost", async () => {
    const runtimeSend = vi.fn(async () => {
      throw new Error("Extension context invalidated.");
    });
    const onContextInvalidated = vi.fn();
    const sendMessage = createContentScriptMessageSender(runtimeSend, onContextInvalidated);

    await expect(sendMessage({ kind: "first" })).resolves.toBeUndefined();
    await expect(sendMessage({ kind: "second" })).resolves.toBeUndefined();
    expect(runtimeSend).toHaveBeenCalledTimes(1);
    expect(onContextInvalidated).toHaveBeenCalledTimes(1);
  });

  it("absorbs an extension invalidation race while registering the runtime listener", () => {
    const listener = vi.fn();
    const addListener = vi.fn(() => {
      throw new Error("Extension context invalidated.");
    });
    const onContextInvalidated = vi.fn();

    expect(registerContentScriptMessageListener(addListener, listener, onContextInvalidated)).toBe(false);
    expect(addListener).toHaveBeenCalledWith(listener);
    expect(onContextInvalidated).toHaveBeenCalledTimes(1);
  });

  it("does not hide unrelated listener registration errors", () => {
    const failure = new Error("Listener quota exceeded");
    const addListener = vi.fn(() => { throw failure; });

    expect(() => registerContentScriptMessageListener(addListener, vi.fn(), vi.fn())).toThrow(failure);
  });
});
