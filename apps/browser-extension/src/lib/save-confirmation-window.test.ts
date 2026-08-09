import { describe, expect, it } from "vitest";

import {
  SAVE_CONFIRMATION_WINDOW_HEIGHT,
  SAVE_CONFIRMATION_WINDOW_WIDTH,
  saveConfirmationWindowPosition,
} from "./save-confirmation-window";

describe("save confirmation window", () => {
  it("places the popup at the top-right of the submitting browser window", () => {
    expect(saveConfirmationWindowPosition({ left: 100, top: 40, width: 1_200 })).toEqual({
      left: 952,
      top: 48,
    });
    expect(SAVE_CONFIRMATION_WINDOW_WIDTH).toBe(340);
    expect(SAVE_CONFIRMATION_WINDOW_HEIGHT).toBe(150);
  });

  it("keeps the popup within a browser window narrower than the popup", () => {
    expect(saveConfirmationWindowPosition({ left: -500, top: 20, width: 320 })).toEqual({ left: -500, top: 28 });
  });

  it("lets Chromium choose a safe fallback when bounds are unavailable", () => {
    expect(saveConfirmationWindowPosition({ left: 0, top: 0 })).toEqual({});
  });
});
