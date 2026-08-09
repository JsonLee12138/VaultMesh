export const SAVE_CAPTURE_DECISION_TIMEOUT_MS = 10_000;

export type SaveCaptureCountdown = {
  remainingMs: number;
  seconds: number;
  progress: number;
};

export function saveCaptureCountdown(
  expiresAt: number,
  now = Date.now(),
  lifetimeMs = SAVE_CAPTURE_DECISION_TIMEOUT_MS,
): SaveCaptureCountdown {
  const remainingMs = Math.max(0, expiresAt - now);
  return {
    remainingMs,
    seconds: Math.ceil(remainingMs / 1_000),
    progress: lifetimeMs > 0 ? Math.min(1, remainingMs / lifetimeMs) : 0,
  };
}
