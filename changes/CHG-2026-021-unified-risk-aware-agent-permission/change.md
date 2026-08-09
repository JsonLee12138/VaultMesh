# 统一风险感知 Agent 权限申请界面

## 问题或目标

当前高风险动作在权限申请后还可能打开独立 confirmation 窗口。用户需要在两个界面重复确认，且权限申请界面没有直接展示风险、工具和结构化命令。目标是让 R0 自动通过硬策略、R1–R4 在一个权限申请界面完成裁决，并保留 broker 对账号、目标和参数的权威绑定。

## 预期行为

- `REQ-AGENT-010`：R0–R4 都不再打开第二个 action confirmation 窗口；权限申请界面必须显著显示风险等级、账号、目标、工具类型和 broker 生成的动作摘要，并在允许时继续当前调用。
- `REQ-AGENT-011`：SSH 结构化命令按风险提供 exact/safe/all 范围与 once/connection/persistent 生命周期；R1 默认 safe + connection，R3 仅 exact，R4 Allow 仅 exact + once。R2/R3 的 connection/persistent permission 不替代逐次执行确认。
- SSH 命令必须以 broker 校验后的 Markdown code-block 风格等宽区域展示；不得展示 secret、私有参数或未经 broker 生成的原始文案。
- Allow 按钮按 R1–R4 使用明显不同的视觉等级；颜色只表达风险，不改变 broker 的授权范围或策略。

## 非目标

- 不改变 account/target/Host Key/canonical parameter 的 broker 所有权。
- 不降低 R3/R4 的 risk ceiling、destructive enablement、target binding、deny 和 adapter hard policy。
- 不修改 Vault 格式、MCP tool 参数或 Agent secret 生命周期。

## 影响范围

影响 Tauri Rust broker 的 permission snapshot、confirmation routing、桌面 typed contract、独立授权窗口和安全中心权限卡片。新增一个 renderer-safe `actionDisplay` 字段；不新增 secret 或持久化字段。目标平台 packaged AT 仍属于现有 Agent authorization Gate。

## 实现约束

- Rust broker 是风险、目标、工具和动作摘要的唯一 owner；renderer 不解析命令或推断风险。
- SSH `actionDisplay` 必须来自已验证的 structured `program + arguments[]` serializer；HTTP/其他动作只显示有限的 operation/type 摘要。
- 所有风险等级的 Allow 仍受 session、scope、duration、target drift、policy drift、lock、expiry、risk ceiling 和 deny rule 约束。
- 保留旧 confirmation typed API/兼容状态读取能力，但当前 broker 不再为账号动作创建 confirmation challenge。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| `AGENT-021-001` | `REQ-AGENT-010` | 合并 R1–R4 permission routing 与安全动作摘要；R0 保持硬策略自动通过 | `CT-AGENT-AUTHZ-002` | Completed |
| `AGENT-021-002` | `REQ-AGENT-010`、`REQ-AGENT-011` | 风险等级、工具、目标和 Markdown 命令 UI；R1–R4 Allow 颜色 | `CT-AGENT-AUTHZ-003` | Completed |
| `AGENT-021-003` | `REQ-AGENT-010`、`REQ-AGENT-011` | 更新 Requirement、Spec、ADR、Test Plan、Traceability | `pnpm docs:check` | Completed |
| `AGENT-021-004` | `REQ-AGENT-001`、`REQ-AGENT-010`、`REQ-AGENT-011` | connection lifetime 与内部 session 解耦；风险矩阵约束 scope/duration；R2/R3 同窗逐次确认 | `CT-AGENT-LIFECYCLE-001`、`CT-AGENT-AUTHZ-002`、`CT-AGENT-AUTHZ-003` | Completed |

## 验收与证据

- R1 SSH 请求仍在权限窗口正常执行，显示账号和目标且不显示 Host Key SHA256。
- R2 SSH 请求只出现一个权限申请窗口，显示显著 R2、工具类型和等宽命令块，Allow 后不再出现第二个 confirmation challenge。
- R2/R3 使用同一权限申请界面逐次确认；R3 仅 exact scope；R4 Allow 仅 exact + once，persistent Deny 可用；不产生独立 confirmation challenge。
- Connection permission 跨内部 15 分钟 session 轮换保留，但在真实断连、App restart、Vault lock、revoke 或 final lock 清除。
- `actionDisplay` 缺失、过长、包含控制字符或 broker 无法构造时拒绝，不回退到原始参数或 secret。

## 安全与数据生命周期

`actionDisplay` 是 broker 生成的非秘密摘要，只进入当前授权窗口/安全中心内存和有界测试 fixture，不进入 Vault、extension storage、日志或 MCP response。Connection permission 按 transport 生命周期清理；pending、兼容 confirmation 状态、continuation 和 sensitive buffer 按 session/expiry/final-lock cleanup 清理。

## 兼容与迁移

桌面 permission status IPC 增加必填 renderer-safe 字段；旧客户端不会获得新的完整 UI 行为，旧 MCP tool 参数不变。既有持久授权规则不迁移。账号动作不再创建新的 action confirmation；历史 pending confirmation 不跨进程恢复。

## 实现证据（2026-07-27）

- Rust broker snapshot 增加 broker-owned `actionDisplay`；SSH 使用已验证的 canonical serializer，HTTP 使用 ConnectorDefinition method/path。
- 机器 registry 中所有 account-bound tool 统一声明 `confirmation: permission`；legacy confirmation ticket 被拒绝，当前 broker 不创建 action confirmation challenge。
- 独立授权窗口显示风险 Badge、账号、无 Host Key SHA256 的目标、工具类型与 SSH code block；顶部进度贴边，Allow 使用 R1–R4 语义颜色。
- `pnpm tauri:test`：Tauri Rust 192 passed / 1 ignored（本机 OpenSSH）、Agent MCP 10 passed、desktop renderer 109 passed。
- `pnpm typecheck`、`pnpm --filter @vaultmesh/tauri-desktop build:web`、`cargo fmt --check`、`git diff --check` 通过。
- `AT-AGENT-AUTHZ-002` 尚未在签名 packaged macOS/Windows 应用执行，因此 Work 保持 Implementing。

## 增量实现证据（0.1.24-active）

- Permission snapshot 由 broker 提供 allow/deny 可选时长、推荐 scope/duration 与 fresh-confirmation 标记，renderer 不自行推断风险矩阵。
- Connection grant 改为 transport-owned，内部防重放 session 轮换保留，disconnect/lock/restart/revoke 清除。
- R2/R3 remembered permission 与 exact single-use execution grant 分离；R4 非 once Allow 在 broker 层稳定拒绝。
- `cargo clippy -p vaultmesh-tauri-desktop -p vaultmesh-agent-mcp --all-targets -- -D warnings`、`pnpm docs:check`、desktop typecheck/build、`cargo fmt --check` 与 `git diff --check` 通过。
