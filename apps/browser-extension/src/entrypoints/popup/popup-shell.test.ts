import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("popup shell", () => {
  it("reserves the final popup dimensions before React mounts", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/assets/tailwind.css"), "utf8");

    expect(styles).toContain("--vaultmesh-popup-width: 22rem;");
    expect(styles).toContain("--vaultmesh-popup-height: 37.5rem;");
    expect(styles).toMatch(/html,\s*body,\s*#root\s*{[^}]*width: var\(--vaultmesh-popup-width\);[^}]*height: var\(--vaultmesh-popup-height\);/s);
  });
});
