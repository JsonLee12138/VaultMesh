export class AutofillAttemptRegistry {
  readonly #attempts = new Map<number, Set<string>>();

  begin(tabId: number, topOrigin: string, signature: string, documentId = "legacy") {
    const key = `${topOrigin}:${documentId}:${signature}`;
    const attempts = this.#attempts.get(tabId) ?? new Set<string>();
    this.#attempts.set(tabId, attempts);
    if (attempts.has(key)) return false;
    attempts.add(key);
    if (attempts.size > 20) attempts.delete(attempts.values().next().value!);
    return true;
  }

  reset(tabId: number) { this.#attempts.delete(tabId); }
}
