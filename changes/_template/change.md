# 变更标题

> 文档比例：正文详略取决于需要长期保存的决策、风险和证据，不取决于 UI/Bug/重构等修改类型或 diff 大小；低风险 Work 每节可以只有一个短段落或明确 N/A。

## 问题或目标

描述 AI 必须理解的问题、触发条件和用户结果。Bug 同时写最小复现环境、expected 和 actual。

## 预期行为

列出用户可观察行为及 Requirement ID。Bug 必须符合既有 Requirement，不能借修复改变语义。

## 非目标

明确相邻但本次不实现的内容。

## 影响范围

列出 desktop、extension、native host、core、bridge、Vault format、RPC/IPC/ABI、email/SSH/Passkey、安全、性能、依赖和发布 Gate。高风险领域无影响时明确写“无”。

## 实现约束

记录唯一所有者、依赖方向、失败、取消、重复、锁定、过期、兼容和恢复要求。复杂设计使用 `design.md` 或 ADR，不复制完整主规格。

在 `change.yaml` 的 `context_refs` 中列出直接相关主规格路径及可选的 `#<标题或稳定 ID>`；其他 Work 只能列入 `related_changes`，不能因为共享关键词或 ID 自动关联。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| `<TASK-ID>` | `<REQ/NFR-ID 或 N/A>` | `<输出>` | `<AT/CT-ID>` | Pending |

## 验收与证据

- 覆盖 happy path、边界、拒绝、失败、取消、重复、锁定、过期和回归。
- 列出适用 OS/browser/architecture 和 package/install 场景。
- 实现后记录命令输出、CI、PR/commit、build 或平台验收位置。
- 最终证据写完并进入 `Verified` 或 `Rejected` 后，运行 `pnpm work:archive -- <WORK-ID>`；此后本目录永久只读，补充或更正必须创建新 Work。

## 安全与数据生命周期

说明 secret owner、进入哪些 process/DTO、是否持久化、何时清理，以及日志/clipboard/crash/backup 影响。

## 兼容与迁移

说明 Vault format/payload、RPC/IPC/ABI、settings、pairing、upgrade、downgrade、rollback 和不可逆补偿。没有影响写“无”。

## Bug 根因（仅 type=bug）

记录根因、受影响版本、为何既有测试未发现、修复前失败/修复后通过的回归测试和修复版本。
