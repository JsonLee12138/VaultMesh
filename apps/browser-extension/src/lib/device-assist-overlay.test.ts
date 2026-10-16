import { afterEach, expect, it, vi } from "vitest";
import { openDeviceAssist } from "./device-assist-overlay";

afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

it("CT-DEVICE-ASSIST-002 closes when the original field's shadow host becomes hidden", async () => {
  const shadowHost = document.createElement("section");
  const shadow = shadowHost.attachShadow({ mode: "open" });
  shadow.innerHTML = '<input autocomplete="tel">';
  document.body.append(shadowHost);
  const target = shadow.querySelector<HTMLInputElement>("input")!;
  Object.defineProperty(target, "getClientRects", {
    value: () => shadowHost.style.display === "none" ? [] : [{ width: 240, height: 32 }],
  });
  const send = vi.fn(async () => ({ status: "no-supported-fields" }));
  const close = openDeviceAssist(document, target, () => undefined, "phone", send);
  try {
    await vi.waitFor(() => expect(document.querySelector("[data-vaultmesh-autofill]")).not.toBeNull());
    shadowHost.style.display = "none";
    await vi.waitFor(() => expect(document.querySelector("[data-vaultmesh-autofill]")).toBeNull());
  } finally {
    close();
  }
});

it("CT-DEVICE-ASSIST-002 ignores unrelated DOM churn without reading target layout", async () => {
  document.body.innerHTML = '<input autocomplete="tel"><section id="feed"></section>';
  const target = document.querySelector<HTMLInputElement>("input")!;
  const rects = vi.fn(() => [{ width: 240, height: 32 }]);
  Object.defineProperty(target, "getClientRects", { value: rects });
  const close = openDeviceAssist(document, target, () => undefined, "phone", vi.fn(async () => ({ status: "no-supported-fields" })));
  try {
    await Promise.resolve();
    rects.mockClear();
    const feed = document.querySelector<HTMLElement>("#feed")!;
    feed.append(document.createElement("div"));
    feed.style.display = "none";
    await Promise.resolve();
    await Promise.resolve();
    expect(rects).not.toHaveBeenCalled();
    expect(document.querySelector("[data-vaultmesh-autofill]")).not.toBeNull();
  } finally {
    close();
  }
});

it("CT-DEVICE-ASSIST-002 re-binds the original field for every start instead of reusing an expired binding", async () => {
  document.body.innerHTML = '<input id="code" autocomplete="one-time-code">';
  const target = document.querySelector<HTMLInputElement>("#code")!;
  Object.defineProperty(target, "getClientRects", { value: () => [{ width: 240, height: 32 }] });
  const bindings = [{ documentId: crypto.randomUUID(), targetId: crypto.randomUUID() }, undefined];
  const bind = vi.fn(() => bindings.shift());
  const send = vi.fn(async () => ({ status: "no-supported-fields" }));
  const close = openDeviceAssist(document, target, bind, "sms", send);
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  expect(send).toHaveBeenCalledWith({ kind: "vaultmesh.device-assist-start", assistKind: "sms", target: expect.objectContaining({ targetId: expect.any(String) }) });
  close();
  // A second panel whose binding can no longer be captured must not send a stale target.
  const again = openDeviceAssist(document, target, bind, "sms", send);
  await vi.waitFor(() => expect(bind).toHaveBeenCalledTimes(2));
  expect(send).toHaveBeenCalledTimes(1);
  again();
});
