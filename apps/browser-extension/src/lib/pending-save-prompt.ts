import type { SaveCaptureQueuedResponse } from "@/lib/protocol";

export type PendingSavePromptEntry = {
  tabId: number;
  fillOrigin: string;
  expiresAt: number;
  prompt: SaveCaptureQueuedResponse;
};

export type PendingSavePreparationEntry = {
  tabId: number;
  fillOrigin: string;
  expiresAt: number;
};

export function pendingSavePromptForPage(
  entries: Iterable<readonly [string, PendingSavePromptEntry]>,
  page: { tabId: number; fillOrigin: string },
  frameId: number | undefined,
  now = Date.now(),
): { prompt: SaveCaptureQueuedResponse | null; expiredCaptureIds: string[] } {
  if ((frameId ?? 0) !== 0) return { prompt: null, expiredCaptureIds: [] };
  const expiredCaptureIds: string[] = [];
  let latest: PendingSavePromptEntry | null = null;
  for (const [captureId, pending] of entries) {
    if (pending.expiresAt <= now) {
      expiredCaptureIds.push(captureId);
      continue;
    }
    if (pending.tabId !== page.tabId || pending.fillOrigin !== page.fillOrigin) continue;
    if (!latest || pending.expiresAt > latest.expiresAt) latest = pending;
  }
  return { prompt: latest?.prompt ?? null, expiredCaptureIds };
}

export function pendingSavePreparationForPage(
  entries: Iterable<readonly [string, PendingSavePreparationEntry]>,
  page: { tabId: number; fillOrigin: string },
  frameId: number | undefined,
  now = Date.now(),
): { captureId: string | null; expiredCaptureIds: string[] } {
  if ((frameId ?? 0) !== 0) return { captureId: null, expiredCaptureIds: [] };
  const expiredCaptureIds: string[] = [];
  let latest: { captureId: string; expiresAt: number } | null = null;
  for (const [captureId, preparing] of entries) {
    if (preparing.expiresAt <= now) {
      expiredCaptureIds.push(captureId);
      continue;
    }
    if (preparing.tabId !== page.tabId || preparing.fillOrigin !== page.fillOrigin) continue;
    if (!latest || preparing.expiresAt > latest.expiresAt) latest = { captureId, expiresAt: preparing.expiresAt };
  }
  return { captureId: latest?.captureId ?? null, expiredCaptureIds };
}
