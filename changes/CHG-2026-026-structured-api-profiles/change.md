# 在 VaultMesh 中手动配置供 Agent 使用的 API 环境

## 问题或目标

Agent 调用同一服务的 Production、Staging、Local API 时，需要稳定的目标、认证方式、固定 Header 和凭据。
如果把这些环境信息作为 MCP 参数交给 Agent，Agent 就可以替换 origin、Header 或认证目标；如果要求 Agent 自己
读取 Token、password 或 API key，再拼成 curl/HTTP 请求，则直接破坏 VaultMesh 的 secret 不披露边界。

本阶段为 `CHG-2026-025-website-service-hub` 增加结构化 `ApiEnvironment`。环境只能由用户在 VaultMesh 桌面端
手动创建、编辑和删除；MCP/Agent 不提供任何环境配置入口。全部 live Environment 都通过安全目录向 Agent 提供环境名称、能力和
opaque `environmentRef`。完整 target、base path、固定 Header、认证方法、环境变量和 credential value 都由软件在
Rust broker 内解析和注入，不通过 MCP/IPC 返回给 Agent。

该方向有意改变 `ADR-0011` 的“`access-token` Secret 同时是 Agent HTTP account/target owner”决策：新模型中
`ApiEnvironment` 是 Agent HTTP target/config owner，Login/Secret 仍是 credential owner。`ADR-0015` 已明确替代范围、
兼容和权限失效策略，因此该变化不作为普通字段增量处理。

## 预期行为

`REQ-API-001` 已冻结以下行为：

- 用户可以在网站/服务下创建多个 API Environment，例如 Production、Staging 和 Local；每个环境具有用户可见名称、
  environment 分类、canonical HTTP(S) origin、可选 base path、可选 `openapiUrl` 和固定非秘密配置。
- 环境 CRUD、credential picker 和 Header 编辑只能由用户通过 VaultMesh desktop typed API 操作；Agent/MCP 不存在
  create/update/delete/get-detail 或等价配置工具。
- 初始认证类型为 `none`、`bearer`、`basic` 和 `api-key`。环境只保存 auth binding 与 opaque credential reference，
  不复制 Token、password 或 key value；OAuth refresh、JWT signing、mTLS 和 Cookie session 不在本阶段。
- `api-key` 可以由软件注入受控 Header 或 Query 参数；`bearer` 由软件构造 `Authorization: Bearer`；`basic` 引用
  适用的 Login/Secret 字段。Agent 不能提交、查看、覆盖或选择 auth type、credential reference 和注入位置。
- 固定 Header 使用结构化 name/source：普通 literal 或 protected item reference。Agent 不获得 Header 名称/值列表，
  也不能在请求参数中增加或覆盖 Header；`Authorization`、`Cookie`、`Host`、`Proxy-*`、hop-by-hop 和传输控制 Header
  只能由内置 policy 处理，不能通过普通编辑器伪装。
- Agent 账号目录只投影 `environmentRef`、用户批准暴露的 service/environment label、environment kind、semantic
  capability 和用户手动保存的可选 `openapiUrl`；不返回 API origin、base path、Header、auth method、credential
  reference、username、scope、notes 或 secret。
- `openapiUrl` 只是保存并返回的非秘密 HTTP(S) 地址。VaultMesh 不下载、解析、验证或认证访问该文档，不解析 `$ref`，
  也不根据文档内容生成 capability、operation、permission 或请求。Agent 如需使用该地址，由 Agent 自己读取。
- 所有 Service/reference/lifecycle 均 live 的 Environment 都进入 Agent 安全目录；目录可见性不授予执行权限，实际调用
  仍必须走独立 Agent unlock、风险感知 Action Lease 和适用的逐次确认。Environment 级 enable 不得成为第二套授权状态。
- Environment 的 target、auth binding、Header policy、credential reference 或 service link 变化必须
  原子写入并提升不可变 revision/digest。变化后既有 Agent account cursor、ActionPlan、connection/persistent permission
  全部 fail closed 或回到 Ask，不能继续沿用旧 target 权限。
- Secret 被删除、revoked、needs-review、kind 改变或 reference 漂移时，环境从 Agent discovery 消失并拒绝执行；
  不得按 label 自动改绑其他 item。

## Agent 与软件的职责

Agent 后续调用只允许提交：

```text
environmentRef
method
relative path
bounded query / JSON body
response mode
```

VaultMesh 软件自动注入：

```text
canonical origin + base path
fixed literal headers
protected header/query values
authentication method
password / token / API key / client secret
environment policy revision
target and output policy
```

Agent 不能提交完整 API URL、origin、base path、Header、auth strategy、credential、环境变量、wildcard、redirect/TLS
policy、risk 或显示文案。`openapiUrl` 是唯一显式返回给 Agent 的环境地址字段，但不参与请求 target、认证或权限。
第三阶段 `CHG-2026-028-agent-api-environment-execution` 负责把该 contract 接入 Broker 执行。

## 非目标

- 不在本阶段执行网络请求、返回业务响应或增加通用 HTTP/curl surface。
- 不把 API Environment 变成 credential value owner；Secret/Login 继续唯一拥有受保护值和生命周期。
- 不允许 Agent 读取环境详情、枚举 Header、获取 base URL、导出配置或解析 credential reference。
- 不允许 Agent 创建、修改、删除或建议自动写入 Environment；Agent 只能引用用户已经配置且当前 live 的 Environment。
- 不提供 OpenAPI 下载、解析、schema cache、operation catalog、外部 `$ref`、认证读取或专用 MCP schema 工具。
- 不允许任意认证脚本、pre-request script、JavaScript、shell、动态代码、任意变量求值或 Agent 提交 Header。
- 不实现 OAuth 登录/刷新、mTLS、AWS SigV4、JWT signing、Cookie jar、redirect、proxy credential 或 TLS override。
- 不修改 Browser RPC、extension storage 或自动填充。
- `CHG-2026-027-privileged-api-request-workbench` 保留为可选的人类桌面请求工具 Draft，不属于 Agent 主路线，
  也不是本 Work 的依赖。

## 影响范围

- Core/payload：新增 encrypted ApiEnvironment、auth binding、injected Header、credential reference、revision、
  trash/history 和原子 mutation。
- Desktop typed API/UI：新增 environment-safe summary/detail、结构化编辑器和 credential picker，不设置 Agent enable/disable。
- Agent discovery：从全部 live Environment 派生 opaque account metadata；不执行请求、不返回 environment detail。
- Secret/Login：继续作为 credential owner，值读取、替换、re-prompt 和 lifecycle 走原 protected path。
- Agent ownership：将 HTTP target/config owner 从 direct access-token Secret 调整为 ApiEnvironment；必须修订 Requirement、
  Agent 专项 Spec、ADR、permission predicate、data model 和 Traceability。
- Vault format：新增可影响 Agent authority 的持久记录和 revision，旧 writer 丢字段可能扩大或错误恢复权限，必须明确
  format/feature compatibility 与拒绝策略。
- 依赖：本阶段不增加 HTTP/OAuth/脚本生产依赖。

## 实现约束

- `vault-core` 是 ApiEnvironment schema、canonicalization、credential relationship、revision、trash/history 和
  原子 mutation 的唯一所有者；Agent broker 只读取 live validated safe/protected views。
- Environment 只保存 credential reference 和必要 selector；不得保存 credential snapshot、展开 Header、临时 Token 或
  password 派生表示。受保护字段在 desktop renderer 中只能作为不可展开引用显示。
- Origin/base path 必须单次 canonicalize，拒绝 userinfo、fragment、控制字符、反斜线、scheme-relative URL、encoded
  separator/dot 和 base-path escape。Agent 从不接收 canonical target。
- `openapiUrl` 必须是用户手动输入的绝对 HTTP(S) URL，拒绝 userinfo 和控制字符；它作为非秘密 safe metadata 原样返回，
  不得包含或引用 Vault credential，也不得被 Broker 当作请求 target、redirect、auth destination 或 permission identity。
- Header name/value 必须有数量、长度、字符和冲突限制；Secret literal 必须拒绝或转换为 protected reference，不能让
  用户误把 Token 作为普通 Header 文本持久化并随后暴露给 renderer/audit。
- Discovery metadata 必须是独立 allowlist DTO；未知、disabled、invalid、deleted、revoked/needs-review 或 reference drift
  环境不进入目录。Cursor 必须绑定 environment catalog revision，变化后旧 cursor 拒绝。
- Persistent permission 不能只绑定 service label 或 credential item。后续 predicate 必须绑定 exact environment ID、
  canonical target digest、auth/header policy digest、capability、method/path predicate 和 revision。
- `ADR-0015` 明确 ApiEnvironment target/config ownership supersedes `ADR-0011` 的范围、direct Secret compatibility、
  旧权限撤销，以及 Agent 为什么仍不能成为环境或 Header 作者。

## 阶段门与决策

1. **依赖门**：`CHG-2026-025-website-service-hub` 的 Service ID、删除语义和关系 contract 至少达到 Accepted；否则
   只能进行 schema/威胁模型 spike。
2. **所有权门**：新增 ADR，冻结 ApiEnvironment target/config owner、Secret credential owner、Agent 安全 discovery、
   direct access-token compatibility 和 permission invalidation；不得直接修改已接受的 `ADR-0011` 语义而无记录。
3. **格式门**：冻结 format/feature compatibility、unsupported writer refusal、backup/restore 和 dangling reference 行为。
4. **Draft → Accepted**：冻结 auth v1、injected Header grammar、discovery allowlist、revision/digest 和非目标。
5. **Accepted → Implementing**：先合并 `REQ-API-001`、Scope、Architecture/Data/Security、Agent Spec、测试计划和
   Traceability，再实现 Core→typed API/UI→Agent discovery。
6. **Implementing → Verified**：完成恶意输入、原子回滚、permission invalidation、锁定清理和 macOS/Windows packaged AT；
   第三阶段执行未完成前，本 Work 只声明“可配置与可发现”，不声称 API 调用可用。

已于 2026-08-04 冻结 Draft → Accepted 决策：`ApiEnvironment` 是结构化 HTTP target/config owner，Login/Secret 是
credential value/lifecycle owner；auth v1 为 none/Bearer/Basic/API Key，Header 为 bounded literal/protected reference；
Agent discovery allowlist 只含 opaque ref、批准 label、kind、`http` capability 与可选 openapiUrl；revision/policy digest
参与不可见目录版本。记录作为 format-3 encrypted additive collection 保存，旧 development writer 不受支持，live
revalidation 使丢字段只撤销 authority。Direct access-token Secret HTTP 暂时兼容且不迁移授权；本 Work 不执行
ApiEnvironment HTTP，所有权、兼容和失效理由由 ADR-0015 拥有。主规格与 Traceability 已合并后进入 Implementing。

同日按产品决策修订：删除 Environment 级“允许 Agent 使用”状态与 UI。全部 live Environment 进入安全目录，但目录
可见性不授予动作权限；独立 Agent unlock、Action Lease 与逐次确认继续是执行 authority 的唯一入口。发布前
`agentEnabled` 字段由 reader 忽略并在后续写入中移除，原 `false` 记录不会继承 permission，首次动作仍回到 Ask。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| `API-ENV-001` | `REQ-API-001`、`REQ-AGENT-003/005` | 冻结 Environment/Auth/Header/Agent injection contract 与新 ADR | `pnpm docs:check` | Complete（2026-08-04） |
| `API-ENV-002` | `REQ-API-001`、`NFR-COMPAT-001` | format/authority compatibility、malformed input、unsupported writer 和权限撤销决策 | `CT-API-PROFILE-001`、`CT-COMPAT-001` | Complete（2026-08-04） |
| `API-ENV-003` | `REQ-API-001`、`NFR-REL-001` | Core CRUD、canonicalization、reference validation、revision、trash/history 和回滚 | `CT-API-PROFILE-001`、`CT-RECOVERY-001`、`CT-REL-001` | Complete（2026-08-04） |
| `API-ENV-004` | `REQ-ITEM-005`、`NFR-PRIV-001` | renderer-safe editor、protected picker、reserved Header 拒绝和锁定清理 | `CT-API-PROFILE-001`、`CT-ITEM-005`、`CT-PRIV-001` | Complete（2026-08-04） |
| `API-ENV-005` | `REQ-AGENT-010`、`NFR-AGENT-001` | 全部 live Environment 的 opaque discovery、可选 openapiUrl、allowlist metadata 和 catalog revision | `CT-AGENT-ACCOUNT-001`、`CT-AGENT-DISCOVERY-002`、`CT-AGENT-SECRET-001` | Complete（2026-08-04，移除环境级 enable 后重验） |
| `API-ENV-006` | `REQ-AGENT-011`、`NFR-AGENT-002` | config drift 撤销 ActionPlan/permission/resource，不迁移旧 authority | `CT-AGENT-AUTHZ-002`、`CT-AGENT-LIFECYCLE-001` | Complete（本阶段 Environment 无执行 authority/resource；policy drift 使 cursor 失效且 HTTP 调用拒绝，2026-08-04） |
| `API-ENV-007` | `REQ-API-001` | macOS/Windows packaged UI 配置多环境与凭据引用，并由真实 client 验证全部 live Environment 的安全 discovery 与动作独立授权 | `AT-API-PROFILE-001` | In Progress（移除环境级 enable 后需重新构建；macOS/Windows packaged AT 待执行，2026-08-04） |

## 验收与证据

- Happy path：同一服务建立 Production/Staging Environment，分别绑定 Bearer/API Key 并配置 fixed Header；两个 live Environment
  自动进入安全目录，动作继续独立申请权限。
- Discovery：Agent 只获得 environmentRef、允许 label、kind、capability 和可选 openapiUrl；API origin/base path/auth/Header/
  credential/notes 不出现。openapiUrl 原样返回但不触发软件网络请求或扩大权限。
- 校验：无效 origin/base path、userinfo、控制字符、重复/保留 Header、错误 credential kind、超限字段全部拒绝。
- 生命周期：credential delete/trash/restore/revoke/needs-review、environment delete/restore 和 revision drift 都使目录和
  权限 fail closed；不得静默改绑或恢复旧 authority。
- 安全：renderer-safe DTO、MCP/IPC、log、audit、crash、snapshot、UI persistence 中无 credential value 或展开环境信息。
- 失败/取消/重复：picker 取消不写入；重复保存幂等；写盘失败保留旧 Environment、catalog revision 和旧权限状态。
- 兼容：backup/restore 保留 Environment/reference/revision；旧 writer、direct Secret 和 persistent permission 的行为有证据。
- 平台：macOS/Windows packaged editor 完成受保护引用展示、锁定清理和删除/恢复；真实 client 能发现全部 live
  Environment 的 opaque metadata，不能读取详情，且执行不能绕过独立 unlock/Action Lease。

截至 2026-08-04，本次移除 Environment 级 enable 后的证据：`cargo test` 全 workspace 通过，其中 core session
38/38、vault-ffi unit 28/28、Tauri Rust 215/215（1 个需本机 OpenSSH daemon 的既有测试按设计忽略）、Agent MCP
10/10；desktop Vitest 28 files / 121 tests 全通过。新增回归证明旧 payload `agent_enabled: false` 被忽略并由当前
writer 移除、该 live Environment 仍进入安全目录，旧 desktop typed input 的 `agentEnabled` 被 Zod 与 Rust runtime
边界拒绝，renderer 不再包含开关/确认状态。`pnpm typecheck`、`pnpm docs:check`、`cargo fmt --all` 与
`git diff --check` 通过；Browser/extension 产品 surface 未修改。

2026-08-10 补齐密钥创建/编辑入口：新建或编辑 `api-key`/`access-token` 均可选择“保存并配置 API 环境”，
保存成功后以 renderer 内存中的 opaque credential reference 进入 Service Hub；编辑时可保留原密钥值，不强制重新输入。
Service Hub 先使用 core-owned aggregation preview 定位唯一 exact-host 现有 Service，已自动/手动关联时再从由 URI host 缩小且最多 50 条的候选中反查 credential relationship；只有唯一结果时自动选中 Service 并打开 Environment 编辑器，冲突或超限继续由用户选择。用户明确选择或创建 Service 后
才打开结构化 Environment 编辑器。新建凭据可预选 Bearer/API Key auth binding，但 website 只可预填 Service site，
不得自动成为 API origin；Secret 自由文本 `environment` 已明确标记为“环境备注（非 API 配置）”。普通保存、
取消和稍后配置不创建 Environment；Vault lock 会清除 pending setup。新增 renderer 回归后 desktop
Vitest 29 files / 132 tests、`pnpm --filter @vaultmesh/tauri-desktop typecheck`、`pnpm docs:check` 与
`git diff --check` 通过。本次仍未执行 macOS/Windows packaged `AT-API-PROFILE-001`。

先前 macOS x86_64 app/DMG build 不包含本次 UI 修订，不能作为当前 packaged 证据。`AT-API-PROFILE-001` 的
macOS/Windows packaged 构建与人工证据仍未执行；本 Work 保持 Implementing，未取得双平台 packaged AT 前不得标记
Verified 或封存。

## 安全与数据生命周期

ApiEnvironment、普通 fixed Header、auth binding 和 credential reference 位于 encrypted Vault payload。Credential value 仍只
存在于原 Login/Secret protected field。本阶段 Agent discovery 只读取安全投影，不解析秘密；desktop 编辑草稿只存在当前
解锁 renderer 内存。取消、锁定、Vault 切换、窗口关闭和退出清除草稿。Environment detail、Header、credential selector、
API origin/base path 不进入 MCP/IPC、Agent-visible error、audit、log、crash 或 snapshot；用户显式填写的 openapiUrl 作为
safe metadata 例外可以进入 Agent discovery response。

## 兼容与迁移

不自动从 Login custom field、Secret notes 或既有 website 猜测环境。既有 direct `access-token` Agent account 的处理必须由
新 ADR 决定；推荐方案是用户显式创建 Environment 并绑定现有 Secret，旧 persistent permission 不迁移，新 Environment
首次调用重新 Ask。新增 authority-bearing schema 必须有 format/feature compatibility 与旧 writer refusal，不能依赖 default
字段。Backup/restore 必须保持 exact service/environment/credential relationship 和 revision。发布前 `agentEnabled` 字段
不再拥有语义：reader 忽略、writer 移除，原 `false` 环境只扩大安全目录可见性，不迁移或签发任何动作 permission。
