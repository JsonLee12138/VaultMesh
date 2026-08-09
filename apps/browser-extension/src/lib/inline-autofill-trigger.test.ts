import { afterEach, describe, expect, it, vi } from "vitest";

import { InlineAutofillTrigger } from "./inline-autofill-trigger";

function setRect(element: Element, rect: { left: number; right: number; top: number; bottom: number }) {
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  Object.defineProperty(element, "getBoundingClientRect", {
    value: () => ({ ...rect, width, height, x: rect.left, y: rect.top, toJSON() {} }),
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  for (const host of document.querySelectorAll("[data-vaultmesh-autofill-trigger]")) host.remove();
});

describe("InlineAutofillTrigger positioning", () => {
  it("keeps a plain account input at the trailing edge", () => {
    document.body.innerHTML = '<input id="account" class="control" autocomplete="username" style="padding-right: 42px">';
    const account = document.querySelector<HTMLInputElement>("input")!;
    setRect(account, { left: 20, right: 260, top: 20, bottom: 52 });
    const trigger = new InlineAutofillTrigger(document, vi.fn());

    trigger.show(account);

    const host = document.querySelector<HTMLElement>("[data-vaultmesh-autofill-trigger]")!;
    expect(host.style.left).toBe("230px");
    expect(host.style.width).toBe("24px");
    trigger.destroy();
  });

  it("honors trailing padding reserved for a CSS-rendered control", () => {
    document.body.innerHTML = `
      <style>.signin-form.fed-auth.hide-password .account-name input.form-textbox-input { padding-right: 43px; }</style>
      <div class="signin-form fed-auth hide-password">
        <div class="account-name"><input id="account" class="form-textbox-input" autocomplete="off"></div>
      </div>
    `;
    const account = document.querySelector<HTMLInputElement>("input")!;
    setRect(account, { left: 20, right: 260, top: 20, bottom: 52 });
    const trigger = new InlineAutofillTrigger(document, vi.fn());

    trigger.show(account);

    const host = document.querySelector<HTMLElement>("[data-vaultmesh-autofill-trigger]")!;
    expect(host.style.left).toBe("193px");
    expect(Number.parseFloat(host.style.left) + Number.parseFloat(host.style.width)).toBe(217);
    trigger.destroy();
  });

  it("honors Apple password padding reserved for its trailing control", () => {
    document.body.innerHTML = `
      <style>
        .widget-container .fed-auth .password .form-textbox-input,
        .widget-container .fed-auth .password input.form-textbox-text { padding-right: 43px; }
      </style>
      <div class="widget-container">
        <div class="fed-auth">
          <div class="password"><input id="password" type="password" class="form-textbox-input"></div>
        </div>
      </div>
    `;
    const password = document.querySelector<HTMLInputElement>("input")!;
    setRect(password, { left: 20, right: 260, top: 20, bottom: 52 });
    const trigger = new InlineAutofillTrigger(document, vi.fn());

    trigger.show(password);

    const host = document.querySelector<HTMLElement>("[data-vaultmesh-autofill-trigger]")!;
    expect(host.style.left).toBe("193px");
    expect(Number.parseFloat(host.style.left) + Number.parseFloat(host.style.width)).toBe(217);
    trigger.destroy();
  });
});
