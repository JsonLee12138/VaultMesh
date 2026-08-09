import type { AutofillCandidate, FieldDescriptor } from "@/lib/protocol";

export type AutomaticLoginChoice = {
  candidate: AutofillCandidate;
  mode: "selection" | "automatic";
};

export function inlineSelectionMode(_kind: AutofillCandidate["kind"]): "selection" {
  return "selection";
}

export function shouldReplaceExistingFields(
  mode: "selection" | "automatic",
  kind: AutofillCandidate["kind"] | undefined,
  preserveExistingAccount = false,
): boolean {
  // Picking another login is an account-switching action, so its username and
  // password must replace the current pair. Other item types can span broad
  // forms; preserve anything the page or user has already entered there.
  return mode === "selection" && kind === "login" && !preserveExistingAccount;
}

export function fieldsForLoginSelection(
  fields: FieldDescriptor[],
  preserveExistingAccount = false,
  preserveNonEmptyAccount = false,
): FieldDescriptor[] {
  if (!preserveExistingAccount && !preserveNonEmptyAccount) return fields;
  return fields.filter((field) => {
    if (!isLoginAccountField(field)) return true;
    if (preserveExistingAccount) return false;
    return !preserveNonEmptyAccount || field.isEmpty;
  });
}

export function shouldWaitForLoginPair(
  mode: "selection" | "automatic",
  kind: AutofillCandidate["kind"] | undefined,
  skipLoginPairWait = false,
): boolean {
  return mode === "automatic" && kind === "login" && !skipLoginPairWait;
}

export function chooseAutomaticLogin(candidates: AutofillCandidate[], rememberedId: string | null, currentUsername: string | null = null): AutomaticLoginChoice | null {
  const logins = rankLoginCandidates(candidates.filter((candidate) => candidate.kind === "login"));
  const eligible = (candidate: AutofillCandidate | undefined) => Boolean(candidate?.autofillOnPageLoad && !candidate.masterPasswordReprompt && candidate.matchScope);
  if (currentUsername) {
    const normalized = normalizeUsername(currentUsername);
    const current = logins.find((candidate) => normalizeUsername(candidate.subtitle) === normalized);
    return eligible(current) ? { candidate: current!, mode: "automatic" } : null;
  }
  if (rememberedId) {
    const remembered = logins.find((candidate) => candidate.id === rememberedId);
    if (remembered && eligible(remembered)) {
      return { candidate: remembered, mode: "automatic" };
    }
  }

  const first = logins.find(eligible);
  return first ? { candidate: first, mode: "automatic" } : null;
}

function normalizeUsername(value: string): string { return value.trim().toLocaleLowerCase(); }

function isLoginAccountField(field: FieldDescriptor) {
  if (field.inputType === "password") return false;
  const metadata = [field.label, field.name, field.id, field.placeholder].join(" ");
  return field.autocomplete.some((token) => token === "username" || token === "email") ||
    field.inputType === "email" ||
    field.inputType === "tel" ||
    /user(name)?|login|account|e-?mail|phone|mobile|用户名|账号|邮箱|电话|手机/i.test(metadata);
}

export function rankLoginCandidates(candidates: AutofillCandidate[]): AutofillCandidate[] {
  const rank = { path: 0, origin: 1, domain: 2 } as const;
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => (left.candidate.matchScope ? rank[left.candidate.matchScope] : 3) - (right.candidate.matchScope ? rank[right.candidate.matchScope] : 3) || left.index - right.index)
    .map(({ candidate }) => candidate);
}
