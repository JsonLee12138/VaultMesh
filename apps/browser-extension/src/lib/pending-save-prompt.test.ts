import { describe, expect, it } from "vitest";

import type { SaveCaptureQueuedResponse } from "./protocol";
import { pendingSavePreparationForPage, pendingSavePromptForPage, type PendingSavePreparationEntry, type PendingSavePromptEntry } from "./pending-save-prompt";

function entry(captureId: string, overrides: Partial<PendingSavePromptEntry> = {}): PendingSavePromptEntry {
  const prompt: SaveCaptureQueuedResponse = {
    status: "queued",
    captureId,
    hostname: "example.test",
    labels: ["登录信息"],
    update: false,
    expiresAt: 2_000,
    actions: { login: "new" },
  };
  return { tabId: 7, fillOrigin: "https://example.test", expiresAt: 2_000, prompt, ...overrides };
}

describe("pending save prompt navigation binding", () => {
  it("returns only the latest unexpired prompt for the same top-level tab and origin", () => {
    const expiredId = crypto.randomUUID();
    const olderId = crypto.randomUUID();
    const latestId = crypto.randomUUID();
    const entries = new Map<string, PendingSavePromptEntry>([
      [expiredId, entry(expiredId, { expiresAt: 999 })],
      [olderId, entry(olderId, { expiresAt: 1_500 })],
      [crypto.randomUUID(), entry(crypto.randomUUID(), { tabId: 8, expiresAt: 4_000 })],
      [crypto.randomUUID(), entry(crypto.randomUUID(), { fillOrigin: "https://other.test", expiresAt: 4_000 })],
      [latestId, entry(latestId, { expiresAt: 3_000 })],
    ]);

    const result = pendingSavePromptForPage(entries, { tabId: 7, fillOrigin: "https://example.test" }, 0, 1_000);

    expect(result.prompt?.captureId).toBe(latestId);
    expect(result.expiredCaptureIds).toEqual([expiredId]);
  });

  it("does not expose a pending prompt to a child frame", () => {
    const captureId = crypto.randomUUID();
    const result = pendingSavePromptForPage(
      new Map([[captureId, entry(captureId)]]),
      { tabId: 7, fillOrigin: "https://example.test" },
      2,
      1_000,
    );

    expect(result).toEqual({ prompt: null, expiredCaptureIds: [] });
  });

  it("binds in-progress preparation to the same top-level tab and origin and expires it", () => {
    const captureId = crypto.randomUUID();
    const expiredId = crypto.randomUUID();
    const entries = new Map<string, PendingSavePreparationEntry>([
      [captureId, { tabId: 7, fillOrigin: "https://example.test", expiresAt: 2_000 }],
      [expiredId, { tabId: 7, fillOrigin: "https://example.test", expiresAt: 999 }],
      [crypto.randomUUID(), { tabId: 8, fillOrigin: "https://example.test", expiresAt: 3_000 }],
      [crypto.randomUUID(), { tabId: 7, fillOrigin: "https://other.test", expiresAt: 3_000 }],
    ]);

    expect(pendingSavePreparationForPage(entries, { tabId: 7, fillOrigin: "https://example.test" }, 0, 1_000))
      .toEqual({ captureId, expiredCaptureIds: [expiredId] });
    expect(pendingSavePreparationForPage(entries, { tabId: 7, fillOrigin: "https://example.test" }, 2, 1_000))
      .toEqual({ captureId: null, expiredCaptureIds: [] });
  });
});
