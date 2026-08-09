import { describe, expect, it, vi } from "vitest";

import { presentBrowserSaveConfirmation } from "./browser-save-confirmation";

describe("browser-level save confirmation", () => {
  it("opens only the independent extension window", async () => {
    const openIndependentWindow = vi.fn(async () => undefined);

    await presentBrowserSaveConfirmation(openIndependentWindow);

    expect(openIndependentWindow).toHaveBeenCalledOnce();
  });

  it("does not hide a window creation failure behind a second page surface", async () => {
    const openIndependentWindow = vi.fn(async () => { throw new Error("window unavailable"); });

    await expect(presentBrowserSaveConfirmation(openIndependentWindow)).rejects.toThrow("window unavailable");
  });
});
