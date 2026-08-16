import { describe, expect, it } from "vitest";

import { requiresFillPassword } from "./popup-app";

describe("popup fill confirmation", () => {
  it("collects a current master password for cards and protected non-card items", () => {
    expect(requiresFillPassword({ type: "支付卡", masterPasswordReprompt: false })).toBe(true);
    expect(requiresFillPassword({ type: "登录", masterPasswordReprompt: true })).toBe(true);
    expect(requiresFillPassword({ type: "机密", masterPasswordReprompt: true })).toBe(true);
    expect(requiresFillPassword({ type: "SSH", masterPasswordReprompt: true })).toBe(true);
    expect(requiresFillPassword({ type: "登录", masterPasswordReprompt: false })).toBe(false);
    expect(requiresFillPassword({ type: "身份" })).toBe(false);
  });
});
