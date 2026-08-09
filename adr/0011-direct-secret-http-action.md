# ADR-0011：Access-token Secret 直接拥有 Agent HTTP 动作

- 状态：Accepted
- 日期：2026-07-28
- 关联 Work：`CHG-2026-020-agent-capability-broker`
- Supersedes：ADR-0007 中 HTTP Profile-first 与 format-2 Profile 权限所有权；ADR-0008 中 HTTP method/path 必须来自 ConnectorDefinition 的部分
- 后续决策：`ADR-0012` 完整移除 Agent Profile 与 format-2 兼容；本 ADR 的 direct Secret owner 不变
- 2026-08-05 修订：`CHG-2026-020` 移除未发布的 credential lifecycle Agent 工具；本 ADR 只继续拥有 authenticated HTTP 决策

## 背景

当前 authenticated HTTP 需要预先创建 encrypted `AgentProfile`/内部
`ConnectorDefinition`，在其中重复保存 credential references、method/path、operation、risk 与 output policy。
这与已经落地的 SSH 直接动作不一致：SSH Vault item 是账号和 credential owner，Agent 直接提交结构化动作，
Broker 编译 Canonical ActionPlan，并由独立本地授权库存储 typed predicate。

用户已经在普通 developer/service Secret 条目中保存 `access-token`、环境和目标网站。为了调用一个新的 HTTP
path 再要求用户创建 Profile 或维护 operation JSON，会形成第二个账户模型、额外 Vault format 迁移和不可发现的
配置入口。另一方面，允许 Agent 提交完整 URL、Authorization header、通配符或 credential value 会重新形成
confused deputy，不能作为简化体验的代价。

## 决策

`kind: access-token` 的 Secret item 直接作为 authenticated HTTP 的唯一 account/credential
owner。Secret 的 exact `website` 固定 canonical HTTP(S) origin 和可选 base path；Agent 只提交公共工具 schema
允许的 uppercase method、相对 base path 的精确 absolute path、有界 query/JSON body 和 response mode。Agent
不得提交 scheme、host、port、Authorization/header policy、redirect policy、通配符、risk、显示文案或 credential。

HTTP 网络信任不再建立第二套账户配置。Broker 不新增 `EndpointTrust`、private-host allowlist、
certificate pin 或地址类别硬拒绝；用户保存的 exact `website` 本身就是该账户对 HTTP、HTTPS、
loopback 或私网目标的选择。HTTPS 连接不得因自签名、过期、主机名不匹配或其他证书错误而拒绝；
VaultMesh 不对此链路承诺网络对端身份或抗中间人性。Broker 仍必须在每次请求前解析 DNS并把结果
固定到当前连接，但不按 public/private/loopback/link-local/metadata 分类改写账户已保存的目标。

Broker 必须在授权前对 path 只解析一次并 canonicalize，拒绝 dot segment、反斜线、控制字符、encoded separator、
encoded dot、scheme-relative/absolute URL、query/fragment 混入和 base-path escape。Canonical ActionPlan 绑定 client、
transport、Secret item ref、canonical origin/base path、method、canonical path/query/body digest、response mode、risk、
target digest、matcher revision 与 expiry；executor 在读取 token 前重新读取 Secret safe detail 并逐字段比较。Secret
值轮换不改变 target identity，Secret kind、website 或 base path 漂移必须回到 Ask。

HTTP method 定义风险下限：`GET/HEAD=R1`、`POST=R2`、`PUT/PATCH=R3`、`DELETE=R4`。Broker 可以基于
typed action 提高风险，不得降低 method floor。
R1 可以记住 path predicate 并自动执行；R2/R3 可以记住 permission scope，但每个 canonical request 仍按
ADR-0009 在同一窗口 fresh confirm；R4 Allow 只允许 exact + once。

HTTP permission 使用版本化 `http-path-v1` predicate，而不是把 SSH `safe/all` 字段解释为路径。支持 exact request、
exact method/path、完整 segment `*` 和仅位于末尾的 `**`；不支持 regex、花括号变量、segment 内 wildcard 或中间
`**`。Agent 调用永远只包含精确 path；只有原生授权 UI 可以从当前 canonical path 生成/编辑 pattern，并必须展示
pattern 将允许任意 query/body 参数的范围。规则绑定 exact account、origin/base path、method、response mode 和 matcher
revision；method 不串权，任一匹配 Deny 优先，Allow 按 exact request、exact path、literal specificity、`*`、`**`
排序。持久规则继续由 OS-key-protected owner-only AEAD store 拥有，不进入 Vault payload。

通用 HTTP v3 初版只支持 broker-owned Bearer、JSON/status response 与有界 JSON request，不开放任意 header、raw
text、HTML、binary、upload/download 或 redirect。`status` 丢弃 body；`json` 在重新构造 DTO 前执行大小、深度、
item、secret canary 和敏感键 redaction，且授权 UI 必须明确业务响应将返回 Agent。

Credential lifecycle 不再属于 Agent 公共能力。Broker 不公开 generate/test/rotate/revoke 工具，不接受 managed/control
credential、credential field、apply/test/rollback 或 revoke/restore transaction descriptor，也不为这些动作编译
ActionPlan。凭据 CRUD、生成、轮换和撤销只由本地 UI 拥有。普通 `vaultmesh_http_request` 仍按本 ADR 的 exact
method/path 和 output policy 执行，但不提供跨远端写入与 Vault 提交的事务或补偿语义。

既有开发 Vault 可能包含未发布实现写入的 `revoked/needs-review` 内部标记。读取端必须继续把这些标记视为
fail-closed，不得因删除写入链而恢复 Agent authority；该兼容识别不构成公开 lifecycle 状态或可执行动作。

Managed-web recipe、Passkey target 和固定 SSH tunnel 仍可由各自 typed internal definition 拥有无法从 Vault item 推导
的 selector/endpoint，但 HTTP/access-token 不读取该 definition。按 `ADR-0012`，旧 format-2
HTTP 记录在 KDF 前整体拒绝，不存在 migration、discovery、ActionPlan、permission 或 execution 读取路径；
旧 connector-bound authorization rule 不能自动转换为新的 path Allow。

## 原因

- 与 SSH 保持同一个“Vault item → direct action → typed lease”心智模型。
- 新 HTTP path 不需要预配置 operation 或迁移 Vault format 才能被发现和授权。
- Exact origin/base path 仍由用户保存的 Secret item 拥有，Agent 不能改变 credential destination。
- 私网、loopback、HTTP 和证书异常是用户所选账户的网络属性，不再要求维护与账户重复的信任配置。
- Method/path predicate 可以表达日常 API 授权，同时保留 R2–R4 fresh confirmation 与 hard policy。

## 被拒方案

- Agent 直接提交完整 URL 或 Authorization header：可以改变 credential destination。
- 增加 `EndpointTrust`、private-host allowlist 或 per-account certificate pin：重复 Secret 已经拥有的账户目标，
  增加用户配置负担，也不能覆盖被攻陷 OS 或已批准恶意目标。
- 把 public HTTPS、WebPKI 或地址类别作为硬授权门槛：调用方不能提交 origin，该门槛重复账户绑定并排除用户明确保存的本地服务。
- Agent 在工具参数中提交 wildcard：会让不可信调用方成为权限范围作者。
- 完整复制 Spring PathPattern/AntPathMatcher：Rust runtime 不依赖 Spring，且宽泛 grammar 增加 normalization bypass；
  只保留用户熟悉的完整 segment `*` 与 terminal `**`。
- 只按 method 判定最终风险：`POST /delete-account` 等业务动作可能高于 method floor。
- 用普通 `vaultmesh_http_request` 在 Agent body 中传 generated credential：会把 secret 带入 MCP/IPC，因此删除
  lifecycle 工具不能由 Agent 自行拼接 HTTP 调用来替代。

## 验证

由 `REQ-AGENT-005`、`REQ-AGENT-010`、`REQ-AGENT-011`、`CT-AGENT-HTTP-001`、
`CT-AGENT-AUTHZ-002`、`CT-AGENT-HTTP-PATH-001` 与 `AT-AGENT-HTTP-001` 验证。
