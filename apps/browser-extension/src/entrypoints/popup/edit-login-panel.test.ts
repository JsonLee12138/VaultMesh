import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("CT-RECOVERY-CODES-001 extension Login editor", () => {
  it("keeps recovery-code file import in the popup edit flow", () => {
    const source = readFileSync(resolve(process.cwd(), "src/entrypoints/popup/edit-login-panel.tsx"), "utf8");
    expect(source).toContain("importRecoveryCodesFile()");
    expect(source).toContain("选择恢复码文件");
    expect(source).toContain("clearRecoveryCodes");
    expect(source).toContain("const recoveryCodes = recoveryCodeLines(form.recoveryCodes)");
    expect(source).toContain("recoveryCodes: recoveryCodes.length > 0 ? recoveryCodes : null");
  });

  it("requires a fresh master-password check for viewing and every copy", () => {
    const source = readFileSync(resolve(process.cwd(), "src/entrypoints/popup/edit-login-panel.tsx"), "utf8");
    expect(source).toContain("getRecoveryCodes(id, recoveryMasterPassword)");
    expect(source).toContain("copyRecoveryCode(id, recoveryAction.index, recoveryMasterPassword)");
    expect(source).toContain("每次查看都必须重新输入主密码");
    expect(source).toContain("每次复制仍需重新验证");
    expect(source).toContain("<Dialog");
    expect(source).toContain("<DialogContent");
    expect(source).toContain("<DialogTitle>");
    expect(source).not.toContain('role="group" aria-label={recoveryAction');
    expect(source).toContain("setRevealedRecoveryCodes([])");
    expect(source).toContain('autoComplete="off"');
  });
});
