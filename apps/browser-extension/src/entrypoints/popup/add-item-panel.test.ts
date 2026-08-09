import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

const sonner = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("sonner", () => sonner);

import { AddItemPanel, buildAddItemInput, buildEditItemInput } from "./add-item-panel";
import { PAYMENT_CARD_NETWORK_OPTIONS } from "@/lib/payment-card-networks";

describe("popup add-item input", () => {
  it("keeps every add-item card ring inside the clipped scroll viewport", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => root.render(createElement(AddItemPanel, {
      kind: "login",
      onCancel: vi.fn(),
      onSaved: vi.fn(),
    })));

    const scrollContent = container.querySelector<HTMLElement>('[data-slot="scroll-area-content"] > div');
    expect(scrollContent?.className).toContain("p-px");
    expect(scrollContent?.querySelectorAll('[data-slot="card"]')).toHaveLength(2);

    await act(async () => root.unmount());
  });

  it("imports an SSH command from the clipboard into the add form", async () => {
    sonner.toast.success.mockClear();
    const container = document.createElement("div");
    const root = createRoot(container);
    const readText = vi.fn().mockResolvedValue("ssh -p 2222 -i ~/.ssh/id_ed25519 deploy@server.example");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText } });

    await act(async () => root.render(createElement(AddItemPanel, {
      kind: "ssh",
      onCancel: vi.fn(),
      onSaved: vi.fn(),
    })));
    const importButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("从剪贴板导入"));
    expect(importButton).toBeTruthy();
    await act(async () => importButton!.click());

    const inputs = Array.from(container.querySelectorAll("input"));
    expect(inputs.find((input) => input.parentElement?.textContent?.startsWith("标题"))?.value).toBe("deploy@server.example");
    expect(inputs.find((input) => input.parentElement?.textContent?.startsWith("主机"))?.value).toBe("server.example");
    expect(inputs.find((input) => input.parentElement?.textContent?.startsWith("端口"))?.value).toBe("2222");
    expect(inputs.find((input) => input.parentElement?.textContent?.startsWith("用户名"))?.value).toBe("deploy");
    expect(sonner.toast.success).toHaveBeenCalledWith(
      "已导入 SSH 命令，请补充密码、公钥或私钥后保存。",
      { id: "add-item-notice" },
    );
    expect(readText).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
  });

  it("normalizes a complete login without returning browser-only fields", () => {
    expect(buildAddItemInput("login", {
      title: " Example ", username: "ada", password: "secret", url: "https://example.test",
      additionalUrls: "https://one.test\nhttps://two.test", customFields: "Team=Core\nToken=a=b",
      favorite: true, autofillOnPageLoad: true, masterPasswordReprompt: true,
    })).toMatchObject({
      title: "Example", username: "ada", password: "secret",
      additionalUrls: ["https://one.test", "https://two.test"],
      customFields: [{ label: "Team", value: "Core" }, { label: "Token", value: "a=b" }],
      favorite: true, masterPasswordReprompt: true,
    });
  });

  it("builds repeatable identity contacts with fresh opaque ids", () => {
    const input = buildAddItemInput("identity", { title: "Ada", emails: "工作|ada@example.test\n备用|a@example.test", phones: "手机|123" });
    expect(input.emails).toMatchObject([{ label: "工作", value: "ada@example.test", preferred: true }, { label: "备用", value: "a@example.test", preferred: false }]);
    expect((input.emails as Array<{ id: string }>)[0]!.id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("keeps secret values in the mutation payload and splits scopes", () => {
    expect(buildAddItemInput("secret", { title: "Deploy", secretKind: "access-token", secret: "token-value", scopes: "repo, read:org\nmodels:read", provider: "GitHub", website: "https://github.com" })).toMatchObject({
      title: "Deploy", kind: "access-token", secret: "token-value", provider: "GitHub",
      scopes: ["repo", "read:org", "models:read"], website: "https://github.com",
    });
  });

  it("labels a secret website consistently with login information", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => root.render(createElement(AddItemPanel, {
      kind: "secret",
      onCancel: vi.fn(),
      onSaved: vi.fn(),
    })));

    const websiteInput = Array.from(container.querySelectorAll("input"))
      .find((input) => input.parentElement?.textContent?.startsWith("网址"));
    expect(websiteInput?.type).toBe("url");
    expect(websiteInput?.placeholder).toBe("https://github.com");

    await act(async () => root.unmount());
  });

  it("offers the same card networks and keeps the selected network in the payload", () => {
    expect(PAYMENT_CARD_NETWORK_OPTIONS.map((option) => option.value)).toEqual([
      "UnionPay", "Visa", "Mastercard", "American Express", "JCB", "Discover", "Diners Club",
    ]);
    expect(buildAddItemInput("card", {
      title: "Daily card", cardholderName: "Ada", cardNumber: "4111111111111111",
      expirationMonth: "3", expirationYear: "2030", network: "UnionPay",
    })).toMatchObject({ network: "UnionPay" });
  });

  it("preserves undisclosed card and SSH secrets when editing metadata", () => {
    const id = crypto.randomUUID();
    expect(buildEditItemInput("card", id, {
      title: "Daily card", cardholderName: "Ada", cardNumber: "", expirationMonth: "3", expirationYear: "2030",
      securityCode: "", pin: "", favorite: false, masterPasswordReprompt: false,
    })).toMatchObject({ id, cardNumber: null, securityCode: null, clearSecurityCode: false, pin: null, clearPin: false });
    expect(buildEditItemInput("ssh", id, {
      title: "Production", host: "server.test", port: "22", username: "deploy", password: "", publicKey: "", privateKey: "", keyPassphrase: "",
      favorite: false, masterPasswordReprompt: false,
    })).toMatchObject({ id, password: null, clearPassword: false, publicKey: null, clearPublicKey: false, privateKey: null, clearPrivateKey: false });
  });

  it("preserves an undisclosed secret value while allowing metadata edits", () => {
    const id = crypto.randomUUID();
    expect(buildEditItemInput("secret", id, {
      title: "Deploy", secretKind: "access-token", secret: "", provider: "GitHub", scopes: "repo, read:org", favorite: true, masterPasswordReprompt: false,
    })).toMatchObject({ id, secret: null, provider: "GitHub", scopes: ["repo", "read:org"], favorite: true });
  });
});
