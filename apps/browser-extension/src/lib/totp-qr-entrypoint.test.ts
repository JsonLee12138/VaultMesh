import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("CT-AUTHENTICATOR-001 popup-only TOTP QR capture", () => {
  it("does not initialize or expose an inline QR capture path from the content script", () => {
    const content = readFileSync(resolve(process.cwd(), "src/entrypoints/vaultmesh.content.ts"), "utf8");
    const background = readFileSync(resolve(process.cwd(), "src/entrypoints/background.ts"), "utf8");
    const protocol = readFileSync(resolve(process.cwd(), "src/lib/protocol.ts"), "utf8");

    expect(content).not.toContain("startInlineTotpCapture");
    expect(content).not.toContain("data-vaultmesh-totp-qr-trigger");
    expect(background).not.toContain("vaultmesh.totp-capture.");
    expect(protocol).not.toContain("vaultmesh.totp-capture.");
  });

  it("keeps QR recognition behind the explicit scan action in the popup Login editor", () => {
    const popup = readFileSync(resolve(process.cwd(), "src/entrypoints/popup/popup-app.tsx"), "utf8");
    const editor = readFileSync(resolve(process.cwd(), "src/entrypoints/popup/edit-login-panel.tsx"), "utf8");

    expect(popup).toContain("async function scanCurrentPageTotp()");
    expect(popup).toContain('{ kind: "vaultmesh.scan-totp-qr" }');
    expect(editor).toContain('title="从当前网页扫描验证器二维码"');
    expect(editor).toContain("onClick={() => void scanTotp()}");
    expect(editor).toContain("保存登录信息后生效");
  });
});
