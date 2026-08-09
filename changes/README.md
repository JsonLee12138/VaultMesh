# AI Work Packages

是否建立 Work 由 `../AGENTS.md` 第 1.2 节的持久决策、边界、可逆性和当前任务验证判据决定，不按 UI/Bug/重构等类别机械判断。需要长期记录的产品代码、安全、依赖、迁移、技术债和治理变化使用独立目录，默认只包含 `change.yaml` 和 `change.md`；低风险 Work 仍使用统一模板，但正文每节可以只有一个短段落或明确 N/A。

常用 ID：

- 新功能/行为变化：`CHG-2026-002-windows-hello-unlock`
- 实现偏离 Requirement：`BUG-2026-001-final-lock-keeps-email-session`
- 其他变化仍使用稳定 ID，并设置 `type: security|dependency|migration|technical_debt|governance`

从 `_template/` 复制后填写，模板本身不是实际 Work。Accepted 后把最终行为合并进 `docs/`、`specs/`、`adr/` 和 Traceability；Change 不替代主规格。

Work 到 `Verified` 或 `Rejected` 后，运行 `pnpm work:archive -- <WORK-ID>` 记录完整文件集合和 SHA-256，封存后目录永久只读。`Released` 作为既有完成态同样必须封存。需要纠错或补证据时创建新 Work，不得重算旧摘要。发布只在 Release record 中引用已封存 Work，不回写 Work。

完整规则见 `../docs/09-document-governance.md`。
