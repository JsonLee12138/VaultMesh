# AI 文档声明式路由与受控检索

## 问题或目标

仓库文档不会自动全部注入 AI 上下文，但宽泛的强制阅读顺序、关键词全文搜索和不明确的“相关 Change”判断会让 Agent 主动读取大量无关历史。目标是让当前 Work 的元数据决定初始读取集，并且只在出现明确缺口、冲突或高风险影响时逐个扩大范围。

## 预期行为

- 已知 Work ID 时，AI 从该 Work 的 `change.yaml` 开始，不先枚举或全文搜索其他 Change。
- `requirements`、`adrs`、`context_refs` 和 `related_changes` 共同构成声明式初始读取集。
- 搜索命中、共享 Requirement、模块名、Test ID 或文件路径不自动建立 Change 依赖。
- 未知 Work ID 时，AI 只使用规格索引和 `change.yaml` 元数据定位候选，不批量读取 `change.md`。
- 安全、格式、鉴权、秘密所有权、不可逆迁移或已发现的规格冲突可以扩大读取范围，但必须一次处理一个候选，并把确认的依赖写回当前 Work。
- 历史 Change 保留；Change 状态只由各自 `change.yaml` 手写拥有，规格索引和 Traceability 不再复制活动 Change 状态表。

## 非目标

- 不修改产品行为、Requirement、Vault format、RPC、ABI 或测试状态。
- 不删除 Verified、Rejected、Released 或历史 Bug。
- 不以固定 token 上限覆盖必要的安全、兼容或架构阅读。
- 不要求一次性迁移全部既有 Change。

## 影响范围

- 修改 AI 强制阅读顺序和文档检索边界。
- 为新建或实质更新的 Change 增加声明式路由字段。
- 扩展文档门禁以验证路由路径、选择器和 Work ID。
- 移除索引与 Traceability 中重复维护的活动 Change 状态视图。
- 产品代码、运行时、持久化、安全边界和发布 Gate 无变化。

## 实现约束

- 主规格仍然拥有当前目标行为，Change 不得替代 Requirement、Spec 或 ADR。
- `context_refs` 使用仓库根目录相对路径；可用 `#<标题或稳定 ID>` 限定小节或表格行。
- 其他 Work 只能通过 `related_changes` 或 `supersedes` 路由，不能藏在 `context_refs` 中。
- 既有 Change 缺少新字段时继续使用 `requirements`、`adrs` 和 Traceability 定位，不因此扫描全部历史。
- 高风险影响和不完整元数据必须扩大读取，不得为减少上下文而跳过必要约束。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| GOV-ROUTE-001 | N/A | `AGENTS.md` 最小读取集与受控扩展规则 | DOC-CONTEXT-001 | Done |
| GOV-ROUTE-002 | N/A | Change 模板路由字段与治理语义 | DOC-CONTEXT-001 | Done |
| GOV-ROUTE-003 | N/A | 路由路径、选择器和关联 Work 机械校验 | DOC-CONTEXT-001 | Done |
| GOV-ROUTE-004 | N/A | 删除重复的活动 Change 状态视图 | DOC-CONTEXT-001 | Done |

## 验收与证据

- 用户于 `2026-07-23` 明确要求按已讨论方案开始修改，作为本治理增量的 Accepted 依据。
- `DOC-CONTEXT-001`：`scripts/docs-check.mjs` 已验证新路由字段成对声明、`0.1.1-active` 及以后规格必须使用路由、路径和选择器存在、关联 Work 存在、其他 Change 不通过 `context_refs` 隐式加载，以及索引/Traceability 不重新建立活动 Change 状态表。
- `node --check scripts/docs-check.mjs`：通过。
- `pnpm docs:check`：通过；46 Markdown、16 YAML、27 Requirements、65 Test IDs、6 ADRs、1 routed Change。
- 使用 `o200k_base` 测量：已知 Work ID 的固定完整读取为 `AGENTS.md` 约 2,118 tokens；未知 Work ID 的 `AGENTS.md` 加规格索引约 3,326 tokens；旧无条件基线约 7,823 tokens。
- 本变更只涉及治理文档和校验脚本，产品、平台、打包与安全 AT 均为 N/A，因此状态推进为 Verified，不进入产品 Release。

## 安全与数据生命周期

只改变 AI 对仓库文档的检索路径，不引入 secret、process、persistence、telemetry 或新的产品数据流。安全相关任务仍必须完整读取直接相关主规格和 ADR，并可无条件突破最小读取集。

## 兼容与迁移

既有 Work Package 不强制批量改写；缺少 `context_refs` 和 `related_changes` 时按 legacy 规则从现有 `requirements`、`adrs` 和 Traceability 路由。新建或发生实质更新的 Work 必须写入两个字段。产品格式、RPC、IPC、ABI 和 settings 无迁移。
