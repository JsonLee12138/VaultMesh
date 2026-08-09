import { describe, expect, it } from "vitest";

import { fillGeneratedLogin, fillGeneratedPassword } from "./generated-login-fill";

function makeVisible(element: HTMLElement) {
  Object.defineProperty(element, "getClientRects", { value: () => [{ width: 240, height: 32 }] });
}

describe("fillGeneratedLogin", () => {
  it("fills the username and all new-password confirmation fields", async () => {
    document.body.innerHTML = `
      <form><h1>Sign Up</h1>
        <input id="account" autocomplete="username">
        <input id="password" name="password" type="password" autocomplete="off">
        <input id="confirmation" name="confirm_password" aria-label="Confirm Password" type="password" autocomplete="off">
      </form>
    `;
    document.querySelectorAll<HTMLElement>("input").forEach(makeVisible);

    const result = await fillGeneratedLogin(document, "953370ec-4dc7-4c77-a6e0-f2a4f6e37f03", { username: "ab", password: "C1!" });

    expect(result.results.map((entry) => entry.status)).toEqual(["filled", "filled", "filled"]);
    expect(document.querySelector<HTMLInputElement>("#account")!.value).toBe("ab");
    expect(document.querySelector<HTMLInputElement>("#password")!.value).toBe("C1!");
    expect(document.querySelector<HTMLInputElement>("#confirmation")!.value).toBe("C1!");
  });

  it("fills the account field that opened the generator when signup has both username and email inputs", async () => {
    document.body.innerHTML = `
      <form><h1>Create account</h1>
        <input id="email" type="email" autocomplete="email">
        <input id="username" autocomplete="username">
        <input id="password" type="password" autocomplete="new-password">
        <input id="confirmation" name="password_confirmation" type="password">
      </form>
    `;
    document.querySelectorAll<HTMLElement>("input").forEach(makeVisible);
    const username = document.querySelector<HTMLInputElement>("#username")!;

    await fillGeneratedLogin(
      document,
      "a03370ec-4dc7-4c77-a6e0-f2a4f6e37f03",
      { username: "local-user", password: "C1!" },
      username,
    );

    expect(document.querySelector<HTMLInputElement>("#email")!.value).toBe("");
    expect(username.value).toBe("local-user");
    expect(document.querySelector<HTMLInputElement>("#password")!.value).toBe("C1!");
    expect(document.querySelector<HTMLInputElement>("#confirmation")!.value).toBe("C1!");
  });

  it("fills Chinese new-password and confirmation fields without requiring a username", async () => {
    document.body.innerHTML = `
      <section>
        <label for="next">设置新密码</label>
        <input id="next" type="password">
        <label for="confirmation">确认密码</label>
        <input id="confirmation" type="password">
      </section>
    `;
    document.querySelectorAll<HTMLElement>("input").forEach(makeVisible);
    const next = document.querySelector<HTMLInputElement>("#next")!;

    const result = await fillGeneratedPassword(document, "a53370ec-4dc7-4c77-a6e0-f2a4f6e37f03", next, "C1!");

    expect(result.results.map((entry) => entry.status)).toEqual(["filled", "filled"]);
    expect(next.value).toBe("C1!");
    expect(document.querySelector<HTMLInputElement>("#confirmation")!.value).toBe("C1!");
  });

  it("does not replace the current password on a change-password form", async () => {
    document.body.innerHTML = `
      <form>
        <label for="current">密码</label>
        <input id="current" name="password" type="password">
        <label for="next">设置新密码</label>
        <input id="next" type="password">
        <label for="confirmation">确认密码</label>
        <input id="confirmation" type="password">
      </form>
    `;
    document.querySelectorAll<HTMLElement>("input").forEach(makeVisible);
    const next = document.querySelector<HTMLInputElement>("#next")!;

    await fillGeneratedPassword(document, "b53370ec-4dc7-4c77-a6e0-f2a4f6e37f03", next, "C1!");

    expect(document.querySelector<HTMLInputElement>("#current")!.value).toBe("");
    expect(next.value).toBe("C1!");
    expect(document.querySelector<HTMLInputElement>("#confirmation")!.value).toBe("C1!");
  });

  it("does not replace a preceding Chinese login password when the form also contains new-password fields", async () => {
    document.body.innerHTML = `
      <form>
        <div class="field wide">
          <label for="cn-password">登录密码</label>
          <input class="control" id="cn-password" name="login_secret" type="password">
        </div>
        <label for="next">设置新密码</label>
        <input id="next" name="new_password" type="password">
        <label for="confirmation">确认新密码</label>
        <input id="confirmation" name="confirm_password" type="password">
      </form>
    `;
    document.querySelectorAll<HTMLElement>("input").forEach(makeVisible);
    const next = document.querySelector<HTMLInputElement>("#next")!;

    await fillGeneratedPassword(document, "c53370ec-4dc7-4c77-a6e0-f2a4f6e37f03", next, "Generated-C1!");

    expect(document.querySelector<HTMLInputElement>("#cn-password")!.value).toBe("");
    expect(next.value).toBe("Generated-C1!");
    expect(document.querySelector<HTMLInputElement>("#confirmation")!.value).toBe("Generated-C1!");
  });
});
