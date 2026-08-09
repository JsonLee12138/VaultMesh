# Agent 通过软件注入的环境与密钥调用 API

## 问题或目标

API Environment 由用户在 VaultMesh 软件内手动配置，主要供 Agent 使用；Agent 本身不能创建、编辑或读取环境详情和
credential。Agent 如果提交完整 URL、Header、认证方式、环境变量或 Token，就能替换凭据目标、把秘密送入 MCP
transcript，或利用通用 HTTP surface 形成 confused deputy。

本阶段把 `CHG-2026-026-structured-api-profiles` 的 live ApiEnvironment 接入现有 Agent Capability Broker。Agent
从安全账号目录获得 opaque `environmentRef`，提交精确 method、相对 path 和有界业务参数；VaultMesh 软件从实时
Environment 自动注入 canonical target、base path、fixed Header、auth method 和密钥，并在 Rust adapter 内执行。

目标不是让 Agent“拿到环境后自行调用”，而是让 Agent“引用环境，由软件代表它完成调用”。

## 预期行为

拟新增 `REQ-API-002` 并修订 `REQ-AGENT-003/005/010/011`：

- Agent 通过现有安全账号搜索获得 live `api-environment` 账号；返回只包含 opaque account/environment ref、
  用户允许的 service/environment label、kind、semantic capability 和可选 `openapiUrl`。除该用户手动保存的 OpenAPI
  地址外，不返回 API origin、base path、Header、auth、credential reference、secret 或 environment detail。
- Agent HTTP 调用只接受 `environmentRef/accountRef`、uppercase method、相对 base path 的精确 absolute path、有界 query、
  JSON body 和 `status/json` response mode。Agent 不得提交完整 URL、origin、Header、auth strategy、credential、环境变量、
  wildcard、redirect/TLS policy、risk、permission pattern 或显示文案。
- Broker 从 Agent-only unlocked Vault 读取 live ApiEnvironment，自动组合 canonical origin/base path、fixed literal Header、
  protected Header/query value、认证方法和 credential；Bearer、Basic、API key 等秘密只在最终 Rust network adapter 内物化。
- ApiEnvironment 是 Agent HTTP target/config owner；Login/Secret 是 credential owner。Broker 必须同时验证 environment
  revision、target/auth/header digest、credential item kind/lifecycle 和 request canonicalization，任一漂移都在 secret use 前
  fail closed。
- Canonical ActionPlan 绑定 client、transport、connection session、environment ref、credential refs、target digest、
  auth/header policy digest、method、canonical path/query/body digest、response mode、risk、matcher revision 和 expiry。
- 原生授权 UI 向用户显示 service/environment、exact target、method/path、risk 和软件将注入的认证类型/fixed Header 名称摘要，
  但不显示 secret value。Agent 自报 label/target/risk 不参与展示或授权。
- HTTP permission 绑定 exact Environment 和 config revision。Path predicate 只能由原生 UI 从本次 exact path 生成；Environment
  delete/restore、target/auth/header/credential 变化、Vault switch、revoke 或 matcher revision 变化全部撤销或回到 Ask。
- Method 风险下限、R2/R3 fresh confirmation、R4 exact-once、30 秒调用 continuation 和 existing typed lease 规则继续适用；
  Environment 出现在安全目录中不等于允许任何请求。
- Adapter 拒绝 redirect、cross-origin credential、Agent Header、absolute URL、base-path escape 和 unsafe normalization；response
  先执行类型/大小/深度限制、敏感字段 policy 和 credential canary，再新建 bounded `status/json` DTO 返回 Agent。
- 请求送达后结果未知不得自动重试；返回 stable `execution-unknown`。Cancel、disconnect、revoke、timeout、final lock、
  system lock、Vault switch、App exit 和 crash cleanup 必须清除 plan、auth buffer、network resource 和 response state。

## 调用示例

Agent 可见：

```json
{
  "accountRef": "opaque-api-environment-ref",
  "label": "GitHub Production",
  "kind": "api-environment",
  "capabilities": ["authenticated-http"],
  "openapiUrl": "https://docs.example.com/openapi.json"
}
```

Agent 请求：

```json
{
  "accountRef": "opaque-api-environment-ref",
  "method": "GET",
  "path": "/user/repos",
  "query": { "visibility": "private" },
  "responseMode": "json"
}
```

软件内部自动注入但不返回 Agent：

```text
https://api.github.com + base path
Accept / API-Version / tenant headers
Authorization strategy
access token / API key / password
DNS, redirect, output and permission policy
```

## 非目标

- 不向 Agent 提供 environment get/detail/export、Secret get、Header list、resolved URL、credential reveal/copy 或通用变量读取。
- 不由 VaultMesh 下载、解析或缓存 OpenAPI，不提供 schema/operation 工具；openapiUrl 只作为字符串随安全 metadata 返回。
- 不允许 Agent 提交 Header、Cookie、proxy、TLS override、client certificate、auth script、JavaScript、shell 或 raw curl。
- 初始 response 不支持 raw Header/body、HTML、binary、stream、WebSocket、SSE、multipart、download 或 redirect。
- 不实现 OAuth acquisition/refresh、JWT signing、mTLS、AWS SigV4、Cookie jar 或任意 pre-request script。
- 不复用 Browser pairing/session，不修改 Browser RPC 或 extension storage。
- 不要求或依赖 `CHG-2026-027-privileged-api-request-workbench`；人类桌面请求工具是独立的可选 Draft。
- 不把 Environment 目录可见性或 credential 存在解释为 Agent permission；每个动作继续走 Agent unlock、permission 与 confirmation。

## 影响范围

- Agent registry/MCP：账号 kind/capability 与 HTTP accountRef 语义升级；shim 仍只做 framing/forwarding，不解释环境。
- Agent IPC/Broker：从 Environment 编译 ActionPlan、环境 revision/policy digest、permission invalidation、safe error 和 cleanup。
- Core/runtime：有界读取 live Environment safe/protected views 与 credential，保证 reference/lifecycle/atomic mutation。
- HTTP adapter：自动注入 target、fixed Header、auth 和 secret；Agent request 不再是 Header/auth/target owner。
- Native authorization UI：展示 broker-owned exact target、environment、method/path、risk 和注入摘要。
- Audit：只记录 coarse environment/account/tool/target class/risk/decision/result/count，不记录 target detail、Header 或 body。
- Compatibility：公共 registry/IPC/predicate/permission store 和 Vault environment revision 都需要版本/拒绝策略。
- 发布：真实 Codex/OpenCode + packaged macOS/Windows 的 Agent API 环境 AT。

## 实现约束

- `vault-core` 拥有 ApiEnvironment schema、credential relationship 和 protected lookup；Tauri Rust Agent broker 是 policy、
  ActionPlan、permission、secret injection、HTTP execution、safe output、audit 和 cleanup 的唯一所有者。
- MCP shim、Agent、renderer、extension 和 native host 都不能成为 environment detail 或 secret owner；用户手动保存并
  允许返回的 openapiUrl 是唯一地址 metadata 例外。用户只能通过 VaultMesh desktop typed UI 配置 Environment；renderer
  不能代表 Agent 预签 permission 或生成可复用 authorization token。
- Broker 必须单次解析请求并对 path/query/body canonicalize；不能让 Environment base path 和 Agent path 经多次 decode/merge
  产生 escape。Header 只从 live Environment 与内置 policy 构造，Agent schema 中不存在 Header 参数。
- Environment/auth/header/credential digest 必须进入 target identity 与 permission key。只轮换 exact credential value 是否保留
  permission，必须在新 ADR 明确；credential kind/reference、target、placement 或 fixed Header 改变必须回到 Ask。
- 现有 `ADR-0011` 明确拒绝 Profile/ConnectorDefinition HTTP account 和自定义 Header。本 Work 不得在该 ADR 未被新 ADR
  明确 supersede 前进入 Accepted 或修改产品代码。
- TLS/证书异常、HTTP、localhost、private/link-local/metadata address 与 DNS pin 的策略必须由新 ADR 冻结。Agent 不得提交
  相关选项；Environment UI 只允许已接受的固定策略，不得把网络风险隐藏在任意 Header/变量中。
- Response parser/schema/redaction/canary 失败必须丢弃结果并返回 safe error，不能回退 raw library dump。Credential 反射、
  常见编码、oversize/compressed bomb、敏感键、invalid JSON 和 redirect chain 必须进入 adversarial tests。
- Non-idempotent method 在完整送达后断连返回 execution-unknown；shim reconnect 不重放 R1–R4 动作。

## 阶段门与决策

1. **依赖门**：`CHG-2026-026-structured-api-profiles` 至少 Accepted，ApiEnvironment owner、revision、auth/header
   schema、credential reference、format compatibility 和 Agent discovery 已冻结。
2. **ADR 门**：新增 ADR supersede `ADR-0011` 的 direct access-token target owner/no-profile/no-custom-header 部分，冻结
   Environment target/config owner、Secret credential owner、value rotation、TLS/network risk 和权限迁移。
3. **Contract 门**：决定 Agent registry/IPC 版本、account kind、request schema、permission predicate revision、old client
   refusal 和 persistent rule invalidation；不得用兼容 fallback 接受旧/new 混合语义。
4. **Draft → Accepted**：冻结 Requirement、工具参数、软件注入字段、输出类型、风险/confirmation、非目标和攻击矩阵。
5. **Accepted → Implementing**：先更新 Scope、Requirement、Agent Spec、ADR、Architecture/Data/Security、测试计划和
   Traceability，再同步 registry、policy、dispatcher、shim、broker、UI 与 parity tests。
6. **Implementing → Verified**：完成无生产凭据 fixture、adversarial tests、Codex/OpenCode 和 macOS/Windows packaged AT，
   写回证据后封存。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| `AGENT-API-ENV-001` | `REQ-API-002`、`REQ-AGENT-003/005` | 新 ADR、environment/account/target/secret ownership 与软件注入 contract | `pnpm docs:check` | Pending |
| `AGENT-API-ENV-002` | `REQ-AGENT-010`、`NFR-AGENT-001` | opaque discovery 与 HTTP request schema，无 environment/header/secret getter | `CT-AGENT-ACCOUNT-001`、`CT-AGENT-DISCOVERY-002`、`CT-AGENT-SECRET-001` | Pending |
| `AGENT-API-ENV-003` | `REQ-AGENT-003/005` | Environment ActionPlan、canonicalization、header/auth/secret injection 与 safe output | `CT-AGENT-API-ENV-001`、`CT-AGENT-HTTP-001`、`CT-AGENT-HTTP-PATH-001` | Pending |
| `AGENT-API-ENV-004` | `REQ-AGENT-011` | environment/revision/digest-bound predicate、risk/fresh confirm 与 permission invalidation | `CT-AGENT-AUTHZ-002`、`CT-AGENT-API-ENV-SEC-001` | Pending |
| `AGENT-API-ENV-005` | `NFR-AGENT-001/002`、`NFR-PRIV-001` | canary、safe audit/error、cancel/lock/disconnect/restart/unknown cleanup | `CT-AGENT-SECRET-001`、`CT-AGENT-LIFECYCLE-001`、`CT-AGENT-AUDIT-001`、`CT-PRIV-001` | Pending |
| `AGENT-API-ENV-006` | `NFR-COMPAT-001` | registry/IPC/predicate/permission/format version 与旧语义 fail-closed | `CT-AGENT-API-ENV-SEC-001`、`CT-COMPAT-001` | Pending |
| `AGENT-API-ENV-007` | `REQ-API-002` | 真实 Codex/OpenCode + packaged macOS/Windows 的发现→授权→执行→撤销 | `AT-AGENT-API-ENV-001`、`AT-AGENT-HTTP-001` | Pending |

## 验收与证据

- Happy path：Agent 发现 Production Environment，以 environmentRef 调用 GET/POST，软件注入 base URL、Header 和 Bearer/API Key，
  返回有界 status/JSON。
- 不披露：除允许返回的 openapiUrl 外，MCP list/call/response、IPC、error、log、audit、crash、argv、env、temp、renderer
  state 中无 environment detail、API target、Header value、auth config、credential ref/value 或 canary。
- 替换攻击：Agent 提交完整 URL/Header/auth/credential/unknown field 被 schema 拒绝；path/base path escape、duplicate decode、
  cross-origin redirect、DNS rebinding 和 config drift fail closed。
- 权限：environment A/B、Production/Staging、method/path、config revision、credential/reference 不串权；Deny 优先，R2–R4 confirmation
  和超时后 once 语义保持。
- 生命周期：delete/restore Environment、delete/revoke/needs-review credential、lock、disconnect、revoke、timeout、App restart、
  Vault switch 与 broker crash 清理；persistent rule 不恢复旧 target。
- 副作用：已送达 mutation 响应丢失返回 execution-unknown，不自动重放；R0 metadata 才允许 delivery-safe replay。
- 输出：secret reflection、encoded canary、敏感键、oversize、compressed bomb、invalid JSON、parser/redaction failure 不回退原文。
- 平台：无生产凭据的本地测试 server覆盖多环境和 auth types；真实 Codex/OpenCode 验证 Agent 从不需要用户复制 Token。

## 安全与数据生命周期

ApiEnvironment、auth binding、fixed Header 和 credential reference 位于 encrypted Vault；credential value 由原 Login/Secret
protected field 拥有。Agent-only runtime 解锁后，Broker 在单次已授权执行中读取 live Environment 与 credential，在最终
Rust adapter 内短暂物化 Header/auth。ActionPlan、DNS result、auth buffer、request/response parser state 和 continuation 只在
绑定 client/session/environment/request/expiry 的内存中存在。所有终止路径幂等清理；audit 只保留安全粗粒度 metadata。

## 兼容与迁移

不把既有 direct access-token `accountRef` 或 persistent HTTP permission 自动解释为 ApiEnvironment。用户显式创建
Environment、绑定原 Secret，首次 Agent 调用重新 Ask。若决定保留 direct Secret compatibility，它必须使用独立 account kind、
target digest、predicate revision 和明确 sunset，不能与 Environment ref 混用。Registry/IPC/predicate/format 未知版本 fail closed；
backup/restore 必须保持 Environment revision/reference，permission store 在 target/config drift 后回到 Ask。
