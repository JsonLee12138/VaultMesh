import { describe, expect, it } from "vitest";

import { routeLoginCaptureByDefault, routeLoginCaptureByUsername } from "./save-capture-routing";

const oldId = "153370ec-4dc7-4c77-a6e0-f2a4f6e37f03";
const otherId = "253370ec-4dc7-4c77-a6e0-f2a4f6e37f03";

describe("routeLoginCaptureByUsername", () => {
  it("updates the unique old item when its username is unchanged", () => {
    expect(routeLoginCaptureByUsername(
      { username: "ada@example.test", password: "new password" },
      [{ id: oldId, subtitle: "ada@example.test" }],
    )).toEqual({ username: "ada@example.test", password: "new password", loginId: oldId });
  });

  it("treats email-style usernames as equal regardless of surrounding spaces or case", () => {
    expect(routeLoginCaptureByUsername(
      { username: " Ada@Example.Test ", password: "new password" },
      [{ id: oldId, subtitle: "ada@example.test" }],
    )).toEqual({ username: " Ada@Example.Test ", password: "new password", loginId: oldId });
  });

  it("creates a new item when the username differs from the previously filled item", () => {
    expect(routeLoginCaptureByUsername(
      { username: "new@example.test", password: "new password", loginId: oldId },
      [{ id: oldId, subtitle: "ada@example.test" }],
    )).toEqual({ username: "new@example.test", password: "new password" });
  });

  it("creates a new item instead of rerouting a changed username to another old item", () => {
    expect(routeLoginCaptureByUsername(
      { username: "grace@example.test", password: "new password", loginId: oldId },
      [{ id: oldId, subtitle: "ada@example.test" }, { id: otherId, subtitle: "grace@example.test" }],
    )).toEqual({ username: "grace@example.test", password: "new password" });
  });

  it("keeps the explicitly filled old item when another same-site item has the same username", () => {
    expect(routeLoginCaptureByUsername(
      { username: "shared", password: "new password", loginId: oldId },
      [{ id: oldId, subtitle: "shared" }, { id: otherId, subtitle: "shared" }],
    )).toEqual({ username: "shared", password: "new password", loginId: oldId });
  });

  it("does not overwrite either item when the username match is ambiguous", () => {
    expect(routeLoginCaptureByUsername(
      { username: "shared", password: "new password" },
      [{ id: oldId, subtitle: "shared" }, { id: otherId, subtitle: "shared" }],
    )).toEqual({ username: "shared", password: "new password" });
  });
});

describe("routeLoginCaptureByDefault", () => {
  it("routes a username-less password change to the exact-origin default login", () => {
    expect(routeLoginCaptureByDefault(
      { username: "", password: "new password" },
      [{ id: oldId, subtitle: "ada@example.test" }],
      oldId,
    )).toEqual({
      username: "ada@example.test",
      password: "new password",
      loginId: oldId,
    });
  });

  it("does not trust a remembered login that is no longer a same-site candidate", () => {
    expect(routeLoginCaptureByDefault(
      { username: "", password: "new password" },
      [{ id: otherId, subtitle: "grace@example.test" }],
      oldId,
    )).toEqual({ username: "", password: "new password" });
  });

  it("does not override an account explicitly present in the submitted form", () => {
    expect(routeLoginCaptureByDefault(
      { username: "grace@example.test", password: "new password" },
      [{ id: oldId, subtitle: "ada@example.test" }],
      oldId,
    )).toEqual({ username: "grace@example.test", password: "new password" });
  });
});
