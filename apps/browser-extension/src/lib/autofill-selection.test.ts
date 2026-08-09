import { describe, expect, it } from "vitest";

import type { AutofillCandidate, FieldDescriptor } from "./protocol";
import { chooseAutomaticLogin, fieldsForLoginSelection, inlineSelectionMode, rankLoginCandidates, shouldReplaceExistingFields, shouldWaitForLoginPair } from "./autofill-selection";

const candidate = (id: string, matchScope: "path" | "origin" | "domain", overrides: Partial<AutofillCandidate> = {}): AutofillCandidate => ({
  id,
  kind: "login",
  title: id,
  subtitle: id,
  matchScope,
  autofillOnPageLoad: true,
  masterPasswordReprompt: false,
  ...overrides,
});

const domainId = "153370ec-4dc7-4c77-a6e0-f2a4f6e37f03";
const originId = "253370ec-4dc7-4c77-a6e0-f2a4f6e37f03";
const secondOriginId = "353370ec-4dc7-4c77-a6e0-f2a4f6e37f03";
const pathId = "453370ec-4dc7-4c77-a6e0-f2a4f6e37f03";

describe("chooseAutomaticLogin", () => {
  it("keeps an eligible remembered login ahead of the first recommendation", () => {
    const choice = chooseAutomaticLogin([candidate(pathId, "path"), candidate(originId, "origin")], originId);
    expect(choice).toMatchObject({ candidate: { id: originId }, mode: "automatic" });
  });

  it("uses the account submitted in the current tab and never falls back to a different account", () => {
    const ada = candidate(pathId, "path", { subtitle: "ada@example.test" });
    const grace = candidate(originId, "origin", { subtitle: "grace@example.test" });
    expect(chooseAutomaticLogin([grace, ada], originId, " ADA@example.test ")).toMatchObject({ candidate: { id: pathId } });
    expect(chooseAutomaticLogin([grace], originId, "ada@example.test")).toBeNull();
    expect(chooseAutomaticLogin([grace, { ...ada, masterPasswordReprompt: true }], originId, "ada@example.test")).toBeNull();
  });

  it("chooses the first candidate at the strongest available match scope", () => {
    const pathChoice = chooseAutomaticLogin([candidate(originId, "origin"), candidate(pathId, "path")], null);
    expect(pathChoice).toMatchObject({ candidate: { id: pathId }, mode: "automatic" });

    const originChoice = chooseAutomaticLogin([candidate(domainId, "domain"), candidate(originId, "origin")], null);
    expect(originChoice).toMatchObject({ candidate: { id: originId }, mode: "automatic" });
    expect(chooseAutomaticLogin([candidate(pathId, "path"), candidate(originId, "path")], null)).toMatchObject({ candidate: { id: pathId } });
    expect(chooseAutomaticLogin([candidate(originId, "origin"), candidate(secondOriginId, "origin")], null)).toMatchObject({ candidate: { id: originId } });
  });

  it("falls back to the first same-protocol host match but still rejects disabled or protected entries", () => {
    expect(chooseAutomaticLogin([candidate(domainId, "domain")], null)).toMatchObject({ candidate: { id: domainId } });
    expect(chooseAutomaticLogin([candidate(pathId, "path", { autofillOnPageLoad: false })], null)).toBeNull();
    expect(chooseAutomaticLogin([candidate(pathId, "path", { masterPasswordReprompt: true })], pathId)).toBeNull();
    expect(chooseAutomaticLogin([candidate(pathId, "path", { autofillOnPageLoad: false })], pathId)).toBeNull();
    expect(chooseAutomaticLogin([candidate(domainId, "domain")], domainId)).toMatchObject({ candidate: { id: domainId } });
  });

  it("orders the visible recommendation list exactly like automatic selection", () => {
    expect(rankLoginCandidates([candidate(domainId, "domain"), candidate(originId, "origin"), candidate(pathId, "path"), candidate(secondOriginId, "origin")]).map((entry) => entry.id))
      .toEqual([pathId, originId, secondOriginId, domainId]);
  });
});

describe("inlineSelectionMode", () => {
  it("treats every inline item choice as an explicit plugin-confirmed disclosure gesture", () => {
    for (const kind of ["login", "card", "identity", "secret", "ssh"] as const) {
      expect(inlineSelectionMode(kind)).toBe("selection");
    }
  });
});

describe("shouldReplaceExistingFields", () => {
  it("replaces an existing login only when the user explicitly switches accounts", () => {
    expect(shouldReplaceExistingFields("selection", "login")).toBe(true);
    expect(shouldReplaceExistingFields("selection", "login", true)).toBe(false);
    expect(shouldReplaceExistingFields("automatic", "login")).toBe(false);
  });

  it("preserves existing form values for every non-login item", () => {
    for (const kind of ["card", "identity", "secret", "ssh"] as const) {
      expect(shouldReplaceExistingFields("selection", kind)).toBe(false);
    }
  });
});

describe("fieldsForLoginSelection", () => {
  const field = (overrides: Partial<FieldDescriptor>): FieldDescriptor => ({
    handle: crypto.randomUUID(),
    control: "input",
    inputType: "text",
    isEmpty: false,
    autocomplete: [],
    label: "",
    name: "",
    id: "",
    placeholder: "",
    context: "login",
    ...overrides,
  });

  it("removes account controls but keeps the password assignment on a multi-step password page", () => {
    const username = field({ autocomplete: ["username", "webauthn"], id: "account" });
    const email = field({ inputType: "email", id: "email" });
    const password = field({ inputType: "password", autocomplete: ["current-password"], id: "password", isEmpty: true });

    expect(fieldsForLoginSelection([username, email, password], true)).toEqual([password]);
    expect(fieldsForLoginSelection([username, email, password], false)).toEqual([username, email, password]);
  });

  it("removes only already-filled account controls from an automatic fill discovery", () => {
    const existingUsername = field({ autocomplete: ["username", "webauthn"], id: "account", isEmpty: false });
    const emptyUsername = field({ autocomplete: ["username"], id: "empty-account", isEmpty: true });
    const password = field({ inputType: "password", autocomplete: ["current-password"], id: "password", isEmpty: true });

    expect(fieldsForLoginSelection([existingUsername, emptyUsername, password], false, true))
      .toEqual([emptyUsername, password]);
  });
});

describe("shouldWaitForLoginPair", () => {
  it("never adds the three-second discovery wait to an explicit fill or an OTP page", () => {
    expect(shouldWaitForLoginPair("selection", "login")).toBe(false);
    expect(shouldWaitForLoginPair("automatic", "login", true)).toBe(false);
    expect(shouldWaitForLoginPair("automatic", "login")).toBe(true);
  });
});
