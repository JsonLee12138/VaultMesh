# ADR-0008：Agent 直接提交动作，Broker 签发有界授权 Lease

- 状态：Accepted
- 日期：2026-07-26
- 关联 Work：`CHG-2026-020-agent-capability-broker`、`CHG-2026-021-unified-risk-aware-agent-permission`
- Superseded in part by：`ADR-0009`（独立 action confirmation 与高风险逐次确认路由）、`ADR-0012`（不再以既有 Agent Profile 作为 ConnectorDefinition 兼容来源）
- Supersedes：ADR-0007 中 Profile-first dynamic permission、system Profile 与 Profile 内权限规则部分

## 背景

ADR-0007 已冻结“Agent 只获得能力、不获得凭据”、本地 stdio shim、owner-only IPC、Rust broker
权威、独立 pairing/session、精确 target 与 canonical request 等安全边界。这些选择继续有效。

实施中的 Profile-first 权限流程要求 Agent 先分页发现 Vault candidate，再调用独立
`vaultmesh_permission_request`，由 broker 生成或选择 Profile，用户授权后再次分页取得 Profile ID，最后才调用
动作工具。SSH account 已经拥有 host、port、username 与 credential，额外 system Profile 只是重复包装；同时
Profile 混合了 connector 定义、target policy、output policy 和 client permission，造成 Runtime/Broker 双份状态、
额外 MCP/IPC 往返和复杂迁移。

## 决策

Agent 公共链路改为：稳定工具目录 → 可搜索/筛选的安全账号目录 → 直接调用动作工具。Agent 只提交 opaque
`accountRef` 与工具 schema 允许的业务参数。Broker 必须从 Vault item、内置规则或内部 ConnectorDefinition
编译不可变 Canonical ActionPlan，再统一返回 Permit、Challenge 或 Deny；Agent 不再调用独立 permission tool，
也不读取、创建或选择 Profile。

每条授权统一表示为：

```text
client key × vault namespace × account ref × target binding × capability
× typed action predicate × lifetime × effect × policy revision
```

SSH exec predicate 固定为 exact canonical command、版本化 safe-command catalog 或 all structured commands；
lifetime 为 once、connection 或 persistent；effect 为 allow 或 deny。更具体规则优先，同一精度 Deny 优先。
target、Host Key、binary、origin、connector 或 catalog 漂移使 Allow 回到 Ask。Once 原子消费，connection lease
在断连、过期、撤销和 final lock 清除。Persistent all-command permission 只授予 exec capability，不能绕过 PTY、
tunnel、risk ceiling、destructive enablement 或 adapter hard policy。

SSH account 直接作为 account owner，不创建 SSH Agent Profile。host/port/username 来自 exact SSH item；首次
目标信任由 broker 探测 Host Key 并在原生授权 UI 展示，Agent 不获得 target。command 使用结构化 program +
arguments，broker 禁止 shell operator、环境与 credential 参数；复杂脚本不属于普通 exec。

HTTP 与 managed web 仍可保留代码拥有的 typed ConnectorDefinition，因为 method/path/schema、
recipe/selector 无法仅从凭据 item 推导；ConnectorDefinition 不拥有 client permission，且不
进入 Agent discovery。SSH tunnel 的固定 destination、loopback listener、连接数和 TTL 同样只能来自内部
ConnectorDefinition；该兼容记录只提供不可由 SSH item 推导的辅助约束，SSH item 仍是唯一 account/credential
owner，独立授权库仍是唯一 permission owner，Agent 只能看到 SSH item 的 `accountRef` 和已命名 endpoint。
现有 encrypted Profile 仅作为这些 ConnectorDefinition 的兼容迁移来源，不能继续作为 Agent 可见 SSH account、
动作 owner 或权限 owner。

持久 Agent 授权属于当前设备与本地 integration，不进入 Vault 业务 payload。Tauri runtime 使用每个 Vault
canonical-path namespace 的随机 256-bit key，通过 macOS Keychain 或 Windows Credential Manager 保存；owner-only
本地文件只保存 AEAD 加密、版本化、原子写入的规则集合。AAD 绑定 protocol epoch、Vault namespace 与当前 OS
用户。key/file 缺失、损坏、迁移失败或平台 credential storage 不可用时一律解释为 Ask，不能自动允许。Vault
移动导致 namespace 变化并收敛为 Ask；撤销 pairing 同时删除该 client 的持久授权。

MCP shim 继续只负责 framing/schema 与 IPC forwarding。每条 stdio connection 只有一个 broker-owned session，
所以 action IPC 不再要求 shim 在每次 tools/call 前轮询完整 session snapshot；broker 按已验证 connection 绑定
session并在实际请求中权威校验。IPC frame 必须缓冲读取并只反序列化一次，authorization 返回 typed outcome，
不得用 fake executor 生成占位成功响应。App 重启后的 transport 重连不得恢复旧 connection authority；frame
未完整送达可用同一 request ID 重送，完整送达后丢失响应的 R1–R4 动作必须返回 `execution-unknown`，不能自动
重放。R0 幂等操作可以在新 transport 上安全重放。

动作授权使用独立于配对窗口和主窗口的全局置顶、content-protected 最小权限 WebView；
该 WebView 在桌面启动后隐藏预热，只能读取当前非秘密 challenge 并 resolve 当前 typed choice。Ask/challenge、
本次调用、MCP/broker 等待与窗口进度统一为 30 秒；broker 实际等待到期必须通知当前授权窗口立即将进度归零，
窗口超时后不消失，而是显示本次调用失败。
permission pending 保留到当前 connection session 结束，超时后选择 once、connection 或 persistent Allow 可供
Agent 下一次显式重试使用；其中 once Allow 仅允许下一次匹配调用执行一次。即时窗口
继续提供 exact/safe/all predicate 与 once/connection/persistent allow/deny。broker 允许后以内部 native continuation 复用同一 request ID、Canonical ActionPlan 与
replay record 继续执行。该 continuation 不成为公共 IPC/MCP 能力。普通 `open-local-ui` 继续单独路由到主窗口。

## 原因

- Agent 只需要“找账号并调用工具”，不需要理解 VaultMesh 内部配置对象。
- Canonical ActionPlan 保留 target/request integrity，同时消除 Profile 投影和独立 permission call。
- 统一 predicate/lease 可以复用到 upload、HTTP、Web 与 protected action，不为每个 adapter 复制状态机。
- 设备本地加密授权存储无需为了永久允许一个动作迁移 Vault envelope 或再次收集主密码。
- ConnectorDefinition 与 Permission 分离后，typed web/HTTP 安全配置仍可复用，权限生命周期可以独立演进。

## 被拒方案

- 保留独立 `vaultmesh_permission_request` 并只增加更多按钮：继续暴露内部 Profile 流程且保留重复往返。
- 把所有 adapter 配置全部删除：Web/HTTP 无法安全推导 selector 或 schema。
- 把 persistent permission 写入明文 settings：同用户进程或文件篡改可以扩大权限。
- 把 arbitrary shell 字符串归入 safe catalog：不能证明 quoting、target 与参数完整性。
- 让 persistent all-command permission 跳过 risk ceiling 或 destructive hard policy：会把宽泛选择提升为越界 authority。

## 验证

由 `REQ-AGENT-010`、`REQ-AGENT-011`、`CT-AGENT-DISCOVERY-002`、`CT-AGENT-AUTHZ-002`、
`CT-AGENT-SSH-SAFE-001` 与 `AT-AGENT-AUTHZ-002` 验证；原有 secret、lifecycle、SSH adapter 与 packaged
client tests 继续适用。
