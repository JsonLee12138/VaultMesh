# AI 文档、Change 与版本治理

本文件只保留 AI 在没有聊天上下文时正确实现、验证和演进 VaultMesh 所需的流程。人员汇报、会议、工时和绩效不进入仓库。

## 1. 文档职责

- `AGENTS.md`：最高执行规则和禁止行为。
- `docs/`：当前目标版本的产品、范围、Requirement、架构、数据、安全、测试和追踪。
- `specs/`：跨多个模块、不能仅靠 API 名称表达的专项行为。
- `adr/`：不能从当前代码推断的重大技术原因与被拒方案。
- `changes/<WORK-ID>/`：一次变化的增量、任务、测试和证据。
- `changes/archive.json`：完成态 Work 的不可变文件集合、摘要和封存时间。
- `releases/vX.Y.Z.md` + Git Tag：实际交付、兼容和历史快照。

同一规则只有一个主规格所有者。Change、Traceability 和 Release 只能引用，不复制完整行为。

## 2. Work 比例与建立条件

Work 的判断依据是是否存在需要长期保存的产品决策、契约、风险、迁移或跨任务协调，而不是修改类别或 diff 大小。

修改可以不建 Work，当且仅当 AI 能确认它处于已接受行为与范围内、影响局部且容易回滚、不引入新的产品/架构选择、不跨越高风险或公共契约边界，并且能在当前任务完成实现与充分验证。直接修改可以新增或更新局部回归测试、测试数据和快照，只要它们证明已经明确的预期而不是改变契约；测试变化本身不构成 Work 理由。

UI/文案调整、恢复既有响应式或可访问性预期、明确局部根因的普通 Bug、内部重构、类型/空值修正、测试补强、开发工具与非发布构建调整、无语义局部性能改进都可能直接处理。该列表只是示例，不是白名单；未列出的修改仍按同一通用判据判断。

以下情况必须建立或复用 Work：

- 修改主规格、Requirement、Scope 或 ADR，或需要产品/安全选择。
- 跨越安全/信任、secret、数据所有权、持久化/Vault format、公共 API/Schema/RPC/IPC/ABI、兼容/迁移、平台/范围或发布/回滚边界。
- 涉及生产依赖或许可、跨模块/平台/版本协调，或不可逆操作。
- Bug 严重、反复、根因不明、涉及安全或数据丢失，或需要长期根因/补偿记录。
- 无法在当前任务完整验证，或需要为后续 Agent 保存计划、取舍、风险和未完成状态。

需要 Work 但影响有限时继续使用统一 YAML、路由、状态机与门禁，正文各节可以只有一个短段落或 N/A。进入 Work 的 Bug 必须关联 Requirement、最小复现和回归证据；Traceability 只更新受影响行。高风险、跨边界或长期演进事项使用完整正文。

多个小修改只有在同一 surface、同一目标和同一验收边界内才可以合并，禁止长期 catch-all Change。

## 3. 最小结构

```text
changes/<WORK-ID>/
  change.yaml
  change.md
```

`change.yaml` 只保存 AI routing/state 所需元数据。`change.md` 保存问题、行为增量、非目标、影响、约束、任务、验收、证据和兼容。复杂安全、Schema、ABI 或架构才增加 `design.md` 或 ADR。

精简 Work 仍使用同一模板，但每节可以只有一个短段落或明确 N/A；详略取决于需要长期保存的决策和风险，不取决于修改类型。不得删除进入 Work 的 Bug 根因/回归证据或用精简正文掩盖高风险影响。

## 4. 上下文路由与受控检索

- `requirements`、`adrs`、`context_refs` 和 `related_changes` 共同构成当前 Work 的声明式初始读取集。
- `context_refs` 使用仓库根目录相对路径，可以用 `#<标题或稳定 ID>` 将读取范围限制为一个标题小节或表格行；不带选择器表示必须读取整个文件。
- `related_changes` 是默认读取其他 Work 正文的唯一显式入口；`supersedes` 仍表示替代关系并允许读取被替代 Work。
- 搜索命中、共享 Requirement/Test ID、模块名、代码路径或关键词不构成 Change 依赖。其他 Work 不得写入 `context_refs` 绕过 `related_changes`。
- 已知 Work ID 时必须先读取其 YAML 和正文，再沿声明的路由一层展开；未知 Work ID 时只搜索规格索引和 `change.yaml` 元数据，不能先全文搜索所有 Change 正文。
- 读取未声明的 Change 前必须存在具体的未决问题。确认关联后，把该 Work ID 写回 `related_changes`；不相关的候选不得继续留在上下文。
- 既有 Work 缺少新路由字段时，以其 `requirements`、`adrs` 和 Traceability 对应行为为 legacy 路由，不要求批量迁移；新建或实质更新的 Work 必须同时提供两个字段，允许空列表。
- 加密、格式、鉴权、秘密所有权、不可逆迁移、平台安全边界、已发现的规格冲突或未声明跨层影响必须扩大到全部直接相关主规格和 ADR；上下文最小化不得覆盖安全与兼容要求。
- Change 状态只由各自 `change.yaml` 手写拥有。索引、Traceability 和 Release 可以引用 Work ID，但不得复制活动 Change 状态表或完整证据。

## 5. 状态机

- `Draft`：确认范围，只允许调查和 Spike。
- `Accepted`：行为、非目标和验收明确；新功能可以准备实施。
- `Implementing`：主规格和 Traceability 已更新，正在实现。
- `Verified`：适用自动化和平台验收有证据，工作已完成并等待封存。
- `Released`：兼容既有记录的完成态；新发布不得为表达交付而回写已封存 Work。
- `Rejected`：不实施并保留原因。

正常路径：`Draft → Accepted → Implementing → Verified → 封存`；拒绝路径以 `Rejected → 封存` 结束。禁止跳过行为冻结直接实现，或把 merge 当作 Verified。实际交付由 Release record 和 Git Tag 表达，Release 只引用已封存 Work。

## 6. 完成态封存

- `Verified`、`Rejected` 和兼容既有记录的 `Released` 都是完成态。完成态 Work 必须运行 `pnpm work:archive -- <WORK-ID>`，写入 `changes/archive.json` 后任务才算最终结束。
- 封存记录包含 Work ID、完成状态、封存时间、目录内完整文件集合和逐文件 SHA-256。Work 保持原目录，不移动、不复制，既有路由继续有效。
- 封存后不得修改、删除或增补 `changes/<WORK-ID>/` 内文件，也不得删除、替换或重算其既有封存条目。需要纠错、补证据或改变决策时必须创建新的 Work；新 Work 可以在主规格、Traceability 或 Release 中引用原 Work，但不能回写原文。
- `changes/archive.json` 是封存状态的唯一机器可读所有者。目录权限、只读文件位和重复 archive 目录都不作为完整性保证。
- `pnpm docs:check` 在本地相对 `HEAD` 拒绝未提交的封存篡改；CI 必须设置 `VAULTMESH_ARCHIVE_BASE_REF` 为可信目标分支或 push 前提交，从而拒绝同一提交同时修改旧正文和摘要。清单只允许新增其他 Work 的封存条目。
- 治理引入前已完成的 Work 通过一次性 `pnpm work:archive -- --all` 迁移，不回写其正文或 YAML。

## 7. AI 实施流程

1. 读取 `change.yaml`，确认 type、status、目标版本、影响 surface/version 和声明式路由。
2. 读取 `change.md`，再按路由读取关联 Requirement/Spec/ADR/Test；除明确相关外不读取其他 Change。
3. 新功能只有 Accepted 后才能改产品代码；Bug 必须先复现并关联 Requirement。
4. 将 Accepted 行为增量合并到主规格，再更新 Traceability 并进入 Implementing；纯 Bug 不改变 Requirement 语义。
5. 实现失败、取消、重复、锁定、过期、迁移、回滚和安全路径，把命令/CI/平台证据写回 Change。
6. 所有适用测试通过后标记 Verified，补齐最终证据，然后立即封存；封存是该 Work 的最后一次写入。
7. 发布时只选择已封存 Work，创建 Release 和 Git Tag，不修改 Work 状态或正文。

## 8. ID 与历史

- Work、Requirement、Test、ADR 和 OPEN ID 永不复用。
- 替代需求保留并标记 `Superseded by <ID>`；移除需求标记 `Removed in vX.Y.Z`。
- Rejected、Verified、Released 和历史 Bug 不删除；完成态封存后永久只读。
- 治理变化也使用 `type: governance` Change，并提升规格修订。
- Git Tag 冻结完整快照；禁止维护 `docs/v1-copy/` 等重复版本树。

## 9. Bug Work 必填信息

进入 Work 的 Bug 必须包含：关联 Requirement、影响版本/surface、最小复现、expected/actual、根因、修复约束、回归测试、验证平台和修复版本。

找不到 Requirement 时先判断：规格遗漏则补规格；预期行为变化则转 CHG；符合设计则 Rejected/By Design，不能伪装成 Bug。

## 10. Release 最小信息

版本、日期、Git Tag、Tauri/extension/Rust/format/RPC/ABI build、已交付且已封存的 Work/REQ/ADR、兼容/迁移、测试证据、已知问题、不可逆限制和补偿步骤。Release 可以在 Work 封存后创建，不得回写 Work。

## 11. 完成门禁

- Change YAML 可解析，正文无未解释的范围空白。
- 新建或实质更新的 Change 路由路径、选择器和关联 Work 可定位；其他 Change 依赖只通过 `related_changes` 或 `supersedes` 表达。
- 主规格拥有最终行为，Change 没有建立第二所有者。
- Requirement→Spec/ADR→Test→状态可追踪。
- Bug 有修复前失败和修复后通过证据。
- 失败、取消、重复、锁定、过期、迁移、回滚和安全影响已验证或明确 N/A。
- Verified 有证据；所有完成态 Work 均已封存，文件集合、摘要和既有封存条目未变。
- Release 只引用已封存 Work，并有 Release record 和 Git Tag；发布不修改已封存 Work。
