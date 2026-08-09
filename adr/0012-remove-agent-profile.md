# ADR-0012：移除 Agent Profile，内部连接定义与账号授权解耦

- 状态：Accepted
- 日期：2026-07-28
- 关联 Work：`CHG-2026-020-agent-capability-broker`
- Supersedes：ADR-0007 中 encrypted Agent Profile、Profile permission rule 与 format 2 决策；ADR-0008 中以既有 Agent Profile 作为 ConnectorDefinition 兼容来源的部分
- 关闭 OPEN：无

## 背景

SSH 与 authenticated HTTP 已经改为直接引用 Vault item，由 Broker 编译不可变 ActionPlan；持久授权也已经迁移到
独立的 OS-key-protected AEAD 规则库。原有 `AgentProfile` 因此不再拥有账号、权限或公共动作，但代码仍保留
format-2 collection、CRUD、renderer contract、Broker 同步与旧 permission rule，形成第二套账户模型和不可达兼容面。

managed-web recipe 与 SSH tunnel endpoint 仍需要保存无法从 Vault item 推导的 selector 或固定 endpoint，但这些
约束不需要 Profile ID、公共 CRUD、client permission 或账号语义。当前产品仍处于开发测试阶段，format 2 未发布，
维护者明确要求不保留旧 Agent Profile 迁移或读取兼容。

## 决策

VaultMesh 必须完整删除 Agent Profile 产品与代码模型：不得保留 `AgentProfile`/`NewAgentProfile` 类型、
`agent_profiles` payload field、Profile summary/health、Profile permission rule、Profile CRUD、renderer schema/API、
Broker Profile fallback、Profile ID discovery 或旧 Profile 兼容读取。

SSH 与 HTTP 必须继续直接使用 exact Vault item；credential lifecycle Agent 工具已由 `CHG-2026-020` 移除。只有 managed-web recipe 与 SSH tunnel 固定
endpoint 可以使用 Rust-owned typed `AgentConnectorDefinition`。该记录只拥有无法从 Vault item 推导的 adapter
约束；不得成为账号、credential、client permission 或 Agent 可见对象，不得通过 MCP 或 renderer 创建、读取、
更新或删除。Broker 只把它投影到对应 Vault item 的安全 action catalog，并在 secret use 前重验 exact item、target、
recipe/endpoint 与 policy revision。

持久 Agent authorization 继续只由独立本地 AEAD 规则库拥有。Vault payload 不再保存任何 client permission；
旧 Profile permission rule 不展示、不迁移、不删除后复用，统一消失。

当前开发版本的 Vault 统一写入和读取 envelope format 3，无论内部 ConnectorDefinition collection 是否为空。
Core、FFI、Tauri、renderer、Agent、Browser、quick unlock 与 restore 不得保留其他格式的 reader、迁移、降级或
专用备份入口；所有其他版本必须在 KDF 前拒绝，不得认证、解密、投影、升级或降级。

## 原因

- 账号、credential、动作授权已经有明确且互不重叠的 owner，继续保留 Profile 只会产生双份状态与漂移。
- 内部 ConnectorDefinition 可以保留 managed-web/SSH tunnel 的必要约束，而不把内部配置重新包装成账号产品模型。
- 产品尚未发布，统一 format 3 writer/reader 比维护旧格式 reader、迁移和降级状态机更小、更清晰。
- 维护者已完成需要保留的开发数据迁移并明确删除剩余 Preview 数据，因此继续保留一次性兼容只增加攻击面。
- format 3 阻止旧开发 writer 忽略新的 connector definition 字段后静默丢失配置；拒绝所有其他版本明确要求旧测试数据重建。

## 后果

- 既有非 format-3 Vault 不可解锁或 restore；需要保留的数据必须在使用本决策之前的开发构建中完成迁移。
- Core、FFI、Tauri、renderer contract 与 Broker 中全部 Profile API 和 permission rule 路径必须删除。
- managed-web 与 SSH tunnel fixture 改用内部 ConnectorDefinition；SSH/HTTP direct action 与授权库格式保持不变。
- format-3 create/write/read、所有其他版本 pre-KDF refusal、format-3 backup/restore 与原子 mutation/rollback
  必须有回归证据；测试不得保留旧格式生成 helper。

## 被拒方案

- 保留只读 Agent Profile：仍需要维护反序列化、summary、Broker sync 和攻击面，且会继续混淆当前 owner。
- 把 Profile 原样改名为 ConnectorDefinition 并继续暴露 CRUD：只改变名称，没有移除第二账户模型。
- 保留任一旧格式的只读或一次性迁移入口：重新引入双 reader、条件迁移与额外 I/O 状态机，但开发阶段没有兼容收益。
- 在 format 2 中直接替换字段：旧开发 writer 会忽略新字段并在保存时静默丢失内部连接定义。
- 删除 managed-web 与 SSH tunnel：超出本决策目标，并会破坏当前 Required 能力。

## 验证

由 `CT-COMPAT-001`、`CT-AGENT-ACCOUNT-001`、`CT-AGENT-DISCOVERY-002`、`CT-AGENT-AUTHZ-002`、
`CT-AGENT-SSH-001`、`CT-AGENT-WEB-001`、`CT-AGENT-AUDIT-001` 与 `pnpm docs:check` 验证。
