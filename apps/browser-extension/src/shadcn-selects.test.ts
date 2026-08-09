import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

function productionTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionTsxFiles(path);
    return entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx") ? [path] : [];
  });
}

describe("browser extension selection controls", () => {
  it("uses shadcn Select instead of native select elements", () => {
    const files = productionTsxFiles(resolve(process.cwd(), "src"));
    const offenders = files.filter((file) => /<(?:select|option)(?:\s|>)/.test(readFileSync(file, "utf8")));

    expect(offenders).toEqual([]);
  });
});
