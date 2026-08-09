# 低风险修改的文档比例原则

## 问题或目标

当前治理容易让纯机械修正、小型 UI 表现调整和局部 Bug 都承担完整 Change 文档成本。目标是按影响而不是代码行数分为直接修改、轻量 Work 和完整 Work，同时保持行为、安全、兼容与回归证据不被削弱。

## 预期行为

- 同时满足无行为契约、状态/流程、数据、安全、公共接口、兼容、迁移和新测试影响的机械修改可以不建 Work。
- 小型 UI 表现变化或既有 Requirement 下的局部 Bug 优先复用范围匹配的 Accepted/Implementing Work；否则创建精简 CHG/BUG。
- 精简 Work 继续使用相同 YAML、状态机、路由与回归门禁，但正文每节可以只写一个短段落或明确 N/A。
- 改变用户流程/状态/操作结果、响应式/可访问性契约、安全、数据、格式、API/RPC/ABI、迁移、平台或范围时必须使用完整 Work。
- 不相关的小修改不得堆入长期 catch-all Change。

## 非目标

- 不新增 `PATCH-*` ID、第二套模板或第二套状态机。
- 不允许以“小改动”为由跳过 Bug 回归测试、安全审查或兼容门禁。
- 不修改任何产品 Requirement 或运行时行为。

## 影响范围

只修改 AI Work 建立条件、文档详略和 Traceability 更新边界。产品代码、Vault format、RPC/ABI、安全边界与发布 Gate 无变化。

## 实现约束

- 是否免 Work 由影响条件决定，不由 diff 行数决定；无法确认时建立轻量 Work。
- 纯视觉免 Work 只适用于既有设计 token 内的局部间距、对齐、颜色或拼写修正，且不得改变响应式、焦点、键盘、可访问性、关键操作可见性或测试基线。
- Bug 仍必须关联既有 Requirement 并有修复前失败、修复后通过的回归证据。
- 同一 Accepted/Implementing Work 只能吸收其既有行为边界内的调整。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| GOV-PROP-001 | N/A | 三档 Work 判定与高风险排除规则 | DOC-PROPORTIONALITY-001 | Done |
| GOV-PROP-002 | N/A | 统一模板支持精简正文 | DOC-PROPORTIONALITY-001 | Done |
| GOV-PROP-003 | N/A | 治理与文档门禁一致性验证 | DOC-PROPORTIONALITY-001 | Done |

## 验收与证据

- 用户于 `2026-07-23` 明确接受把文档比例原则加入两个仓库，作为本治理增量的 Accepted 依据。
- `DOC-PROPORTIONALITY-001`：`scripts/docs-check.mjs` 已验证 AGENTS、治理主规格与统一模板保留文档比例标记；人工一致性检查确认直接修改条件为同时满足、轻量 Work 不豁免 Bug 回归、完整 Work 高风险触发器明确，且没有新增模板或状态机分叉。
- `node --check scripts/docs-check.mjs`：通过。
- `pnpm docs:check`：通过；48 Markdown、18 YAML、27 Requirements、65 Test IDs、6 ADRs、3 routed Changes。
- 本变更只涉及治理文档和门禁，产品、平台、格式、RPC/ABI、安全与发布验收均为 N/A，因此状态推进为 Verified，不进入产品 Release。

## 安全与数据生命周期

治理豁免明确排除 secret、授权、持久化、日志、剪贴板、备份、格式、鉴权和安全边界变化。没有新的产品数据流或秘密生命周期。

## 兼容与迁移

现有 Work Package 不迁移。未来低风险修改按直接、精简、完整三档处理；格式、RPC、IPC、ABI、settings 与 pairing 无变化。
