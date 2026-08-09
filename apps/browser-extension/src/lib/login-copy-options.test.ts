import { describe, expect, it } from "vitest";

import { loginCopyOptions } from "./login-copy-options";

describe("login copy action availability", () => {
  it.each([
    [{ username: "ada@example.test", hasPassword: true, hasTotpSecret: true }, ["用户名", "密码", "验证码"]],
    [{ username: "", hasPassword: true, hasTotpSecret: true }, ["密码", "验证码"]],
    [{ username: "   ", hasPassword: true, hasTotpSecret: false }, ["密码"]],
    [{ username: "ada@example.test", hasPassword: false, hasTotpSecret: true }, ["用户名", "验证码"]],
    [{ username: "ada@example.test", hasPassword: true, hasTotpSecret: false }, ["用户名", "密码"]],
    [{ username: "", hasPassword: false, hasTotpSecret: false }, []],
  ] as const)("returns only copyable fields for %j", (item, expected) => {
    expect(loginCopyOptions(item)).toEqual(expected);
  });
});
