import { describe, expect, it } from "vitest";

import { SAVE_CAPTURE_DECISION_TIMEOUT_MS, saveCaptureCountdown } from "./save-capture-countdown";

describe("save capture countdown", () => {
  it("derives the seconds and progress from the same ten-second deadline", () => {
    expect(saveCaptureCountdown(20_000, 10_000)).toEqual({
      remainingMs: SAVE_CAPTURE_DECISION_TIMEOUT_MS,
      seconds: 10,
      progress: 1,
    });
    expect(saveCaptureCountdown(20_000, 14_600)).toEqual({
      remainingMs: 5_400,
      seconds: 6,
      progress: 0.54,
    });
  });

  it("starts a late-opened prompt at its actual remaining proportion", () => {
    expect(saveCaptureCountdown(20_000, 17_500)).toEqual({
      remainingMs: 2_500,
      seconds: 3,
      progress: 0.25,
    });
  });

  it("clamps expired and unexpectedly long deadlines", () => {
    expect(saveCaptureCountdown(10_000, 10_001)).toEqual({ remainingMs: 0, seconds: 0, progress: 0 });
    expect(saveCaptureCountdown(30_001, 10_000).progress).toBe(1);
  });
});
