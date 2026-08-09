# 在桌面特权运行时执行结构化 API 请求

> 路线说明：用户已明确 API 环境的主要消费者是 Agent。本 Draft 保留为可选的人类桌面请求工作台，
> 不再属于网站/服务 → Agent API 环境 → Agent 执行的三阶段主路线，也不是
> `CHG-2026-028-agent-api-environment-execution` 的依赖。

状态说明：已于 2026-08-04 冻结 Draft → Accepted 决策，并在主 Scope、`REQ-API-002`、Architecture、Security、
Test Plan、Traceability 与 `ADR-0016` 合并后进入 Implementing。

## 问题或目标

结构化 API Profile 能集中保存 endpoint、认证方式和 Header，但不能验证配置是否可用。若 renderer 自行发送请求或
先取得展开后的 Authorization/Header 值，就会破坏 VaultMesh 的 secret owner、WebView 隔离和最小披露边界。

本阶段评估并实现桌面端 API request workbench：用户显式构造并发送受约束请求，Tauri Rust 特权 runtime 从 live
Profile 和 credential item 编译不可变请求计划、内部注入秘密并返回有界响应。它是用户直接操作的 desktop surface，
不复用 Agent pairing/permission，也不扩大 Agent MCP 或 Browser RPC。

## 预期行为

已新增 `REQ-API-002`：

- 用户从已保存的 API Profile 打开 request workbench，选择 uppercase method，输入相对 base path 的 path、受限 query、
  普通 Header 和 JSON/text request body；界面在发送前显示 canonical method、origin/base path 和最终非秘密配置摘要。
- renderer 只提交 profile reference、结构化 request 和 opaque credential/header references。Rust runtime 在执行前重新读取
  live Profile 与 credential item，比较 destination、auth binding、Header policy、lifecycle 和 request digest，漂移时
  fail closed 并要求用户重新确认，不使用 renderer 提交的展开 secret。
- Rust executor 只向 Profile 的 exact canonical origin/base path 发送，内部构造 Authorization/API-key/Basic auth；
  credential 不进入 renderer request、URL 预览、log、audit、crash、argv、environment、proxy 或临时文件。
- 初始 response 支持有界 status、response Header allowlist、JSON 和 UTF-8 text。Binary、stream、WebSocket、SSE、
  multipart upload/download、Cookie jar 和自动 redirect 不在初始范围。
- Response 在 Rust 内执行大小/时间/decompression/encoding 限制、credential canary 和危险 Header 移除后返回 renderer；
  request/response 内容默认只存在于当前 workbench 内存，不持久保存 console 或历史。
- 用户取消、timeout、锁定、Vault 切换、窗口关闭或退出必须中止网络和 DNS/response processing，清除 auth material、
  request/response buffer 和 pending state。非幂等请求结果未知时必须显示 `execution-unknown`，不得自动重试。
- `GET/HEAD` 与 mutation method 的发送确认、TLS/证书错误、localhost/私网/link-local/metadata target、proxy 和 DNS pin
  策略必须在 Draft 决策门冻结；renderer 或 Profile 不能静默降低已接受策略。
- Agent `REQ-AGENT-005` 继续只使用 access-token Secret website、Bearer、status/JSON、有界 Agent output 和独立 ActionPlan；
  desktop request workbench 不继承 Agent persistent permission，Agent 也不能读取 API Profile 或 desktop response。

## 非目标

- 不实现完整 Postman/Insomnia 替代品：无 collection runner、脚本、测试 DSL、mock server、协作、云同步或插件系统。
- 不提供任意 curl、shell、JavaScript、dynamic eval、raw socket、HTTP/2 frame、WebSocket、SSE 或浏览器 DOM。
- 不把 secret、完整请求/响应、raw Header 或认证失败 dump 写入持久 history、audit、telemetry 或 snapshot。
- 不修改 Browser RPC、extension、Agent MCP/IPC、Agent permission store 或 `ADR-0011` 的 Agent account owner。
- 初始范围不支持 OAuth token acquisition/refresh、mTLS、JWT signing、AWS SigV4、Cookie jar、redirect 或 proxy credential。

## 影响范围

- Desktop renderer：新增 API request editor、canonical target 预览、显式 send/cancel 和有界 response viewer。
- Desktop typed API：新增固定 request contract、opaque execution reference、cancel 和 stable result/error schema；无 generic invoke。
- Tauri Rust runtime：新增 request-plan compiler、DNS/connect/HTTP executor、auth injection、quota、redaction 和 lifecycle cleanup。
- Core/runtime：按 Profile/credential reference 有界读取受保护值并在 use 前 revalidate；不把值返回 WebView。
- Agent：共享底层 HTTP library 或 canonicalizer前必须证明 policy owner 隔离；Agent public schema、Header denial 和权限不变。
- Browser/native host：无行为或协议变化。
- 持久化：初始 request/response memory-only；只有 Profile mutation 写 Vault。
- 发布：macOS/Windows packaged app 必须对真实测试 fixture 验证网络、取消、锁定和 secret canary。

## 实现约束

- renderer 不得直接 import Tauri HTTP API、fetch 任意 target、获得 resolved auth value 或调用 generic invoke；唯一入口是
  shared typed adapter 映射的显式 operation。
- Rust request-plan compiler 必须一次 canonicalize path/query/Header/body，拒绝 absolute/scheme-relative URL、userinfo、
  fragment、控制字符、encoded separator/dot、base-path escape、duplicate reserved Header 和 request smuggling 表示。
- Profile ID、credential ID、canonical origin/base path、method/path/query/body digest、auth binding、Header policy revision、
  expiry 与 execution reference 组成 immutable plan；secret use 前从 live Vault 重编译并逐字段比较。
- `Authorization`、API key、Basic credential 和其他 protected Header 只在最终 network adapter 内物化；使用后尽快清零。
  Redirect 默认拒绝且不能携带 credential；若未来允许，必须新建 Change 和逐跳 origin policy。
- Response 必须限制 connect/overall timeout、compressed/uncompressed bytes、Header count/size、JSON depth/items、text bytes 和
 并发数。Parser/redaction 失败丢弃 body并返回 stable safe error，不能回退 raw library dump。
- Credential canary 至少覆盖 exact bound secret 与常见可逆编码；命中时遮蔽或拒绝返回，并留下不包含值的本地安全事件。
- 普通业务 response 可能敏感；只存在当前解锁 renderer 内存，默认不复制、不落盘。若以后支持保存请求模板或响应，
  必须以新 Requirement/Work 明确 secret classification、history、format 和 export 行为。
- mutation method 不自动重试。连接中断发生在请求可能送达之后必须返回 `execution-unknown`；UI 不得把失败伪装成未执行。
- TLS、私网/metadata target 和 self-signed certificate 与当前 Agent `ADR-0011` 存在不同用户/威胁模型，不得直接复用其
  “已保存 website 即接受网络风险”的结论；Accepted 前必须新增安全 ADR 或明确修订现有 ADR。

## 阶段门与决策

1. **依赖门**：`CHG-2026-026-structured-api-profiles` 的 Profile/auth/Header/credential-reference contract 达到 Accepted，且 format/owner ADR
   已冻结；否则只允许无秘密、固定本地 fixture 的 executor spike。
2. **安全决策门**：在 Accepted 前冻结 TLS validation/self-signed、localhost/私网/link-local/metadata、DNS pin、proxy、
   redirect、response exposure、method confirmation、timeout/quota 和 canary 行为；由新增 ADR 拥有不可从代码推断的理由。
3. **Draft → Accepted**：冻结 `REQ-API-002`、typed contract v1、非目标和攻击矩阵；确认不改变 Agent/Browser surface。
4. **Accepted → Implementing**：先更新 Scope、Requirement、Architecture/Security、专项 Spec（如需要）、测试计划和
   Traceability，再实现 Core/runtime→typed command→renderer workbench。
5. **Implementing → Verified**：完成 adversarial contract tests、无生产凭据的本地 fixture、macOS/Windows packaged AT，
   并回归 Agent HTTP/Header denial；写回证据后封存。

已冻结的 V1 决策：public target 只允许系统 WebPKI HTTPS；loopback/private HTTP(S)、mutation 和任何明文 HTTP
逐次 Rust 原生确认；metadata/link-local/混合 DNS 与 public HTTP 拒绝；DNS 在 60 秒 single-use prepare reference 中
固定，redirect/proxy/Cookie/retry/compression/connection pool 关闭。Response 只返回有界 status、安全 Header allowlist
与 JSON/UTF-8 text，exact/Base64/URL-safe Base64/hex credential canary 命中即丢弃。GET/HEAD 不带 body，mutation
可能送达后的中断为 `execution-unknown`。理由、quota 与被拒方案由 `ADR-0016` 拥有。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| `API-RUN-001` | `REQ-API-002` | 冻结 request/response contract、方法/body 范围、非目标与用户流程 | `pnpm docs:check` | Complete（2026-08-04） |
| `API-RUN-002` | `REQ-API-002`、`REQ-SEC-001` | TLS/target/DNS/proxy/redirect/confirmation/output 安全 ADR 与威胁矩阵 | `CT-API-REQUEST-SEC-001` | Complete（`ADR-0016`，2026-08-04） |
| `API-RUN-003` | `REQ-API-002`、`NFR-PRIV-001` | Rust immutable plan、secret injection、canary、quota、cancel/lock cleanup | `CT-API-REQUEST-001`、`CT-API-REQUEST-SEC-001`、`CT-PRIV-001` | Complete（2026-08-04） |
| `API-RUN-004` | `REQ-API-002`、`REQ-SEC-001` | 显式 typed command/adapter、无 generic invoke 的 renderer workbench | `CT-API-REQUEST-001`、`CT-SEC-001` | Complete（2026-08-04） |
| `API-RUN-005` | `NFR-REL-001`、`NFR-COMPAT-001` | profile/credential drift、execution-unknown、无自动重试和原 mutation 回滚 | `CT-API-REQUEST-001`、`CT-REL-001`、`CT-COMPAT-001` | Complete（2026-08-04） |
| `API-RUN-006` | `REQ-AGENT-005` | Agent Profile 隔离、Bearer/Header denial、权限与 safe output 回归 | `CT-AGENT-HTTP-001` | Complete（2026-08-04） |
| `API-RUN-007` | `REQ-API-002` | macOS/Windows packaged desktop 对本地无秘密 fixture 的端到端执行 | `AT-API-REQUEST-001` | In Progress（macOS app/DMG build Pass；两目标 OS packaged AT Not Run） |

## 验收与证据

- Happy path：none/Bearer/API-key/Basic Profile 对固定测试 server 执行 GET、POST JSON/text，并显示有界 status/response。
- Target：origin/base path、port、path/query canonicalization，absolute URL、userinfo、fragment、encoded escape、DNS rebind、
  redirect 和跨 origin 全部按已接受 ADR 处理。
- Header：重复、大小写、保留、hop-by-hop、request smuggling、CRLF、超长/过多 Header 和 secret literal 拒绝。
- Response：oversize、compressed bomb、invalid UTF-8/JSON、过深 JSON、secret reflection、危险 Header 和 parser failure fail closed。
- 生命周期：cancel、timeout、lock、Vault switch、window close、app exit、credential delete/revoke/needs-review/drift 清理。
- 副作用：POST/PUT/PATCH/DELETE 送达后断线返回 execution-unknown；重复点击有明确去重/并发行为且不自动重放。
- 隔离：renderer/network log/audit/crash/snapshot/argv/env/temp 不出现 credential canary；Agent/extension 无 Profile 或 response。
- 平台：macOS/Windows packaged app 使用仓库内无生产凭据 fixture；不以 mock 或编译通过替代网络和 cleanup 验收。

2026-08-04 自动化证据：

- `cargo clippy -p vaultmesh-core -p vaultmesh-ffi -p vaultmesh-tauri-desktop --all-targets -- -D warnings`：Pass。
- `pnpm typecheck`：Tauri desktop 与 Browser extension 均 Pass。
- `pnpm test`：Agent MCP `4 + 6`、Core `9 + 37`、FFI `28 + 11`、Tauri `215 passed / 1 ignored`
  （ignored 为需要本机 OpenSSH daemon 的既有测试）、renderer `27 files / 120 tests`、extension
  `38 files / 228 tests`，全部适用测试 Pass。
- `CT-API-REQUEST-001` / `CT-API-REQUEST-SEC-001` 的 live loopback fixture 覆盖 Bearer、Basic、API-key、JSON、
  single-use/cancel/cleanup、mutation `execution-unknown`、self-signed TLS、redirect、compression、secret reflection、
  target/JSON quota；不含生产凭据。
- `pnpm tauri:build`：Pass；产出 `target/release/bundle/macos/VaultMesh.app` 与
  `target/release/bundle/dmg/VaultMesh_0.1.0_x64.dmg`。
- `pnpm docs:check`：Pass（88 Markdown、46 YAML、47 requirements、114 test IDs、16 ADRs、33 routed
  Changes、23 archived Changes）。

未完成证据：`AT-API-REQUEST-001` 要求分别在 macOS 和 Windows packaged app 执行真实 workbench/fixture、原生确认与
生命周期验收。macOS 构建不能替代交互 AT，当前环境也不能替代 Windows 目标 OS；因此 Work 保持 Implementing，
不得进入 Verified 或封存。

## 安全与数据生命周期

Profile 和 credential reference 位于 encrypted Vault；credential value 只在 Rust network adapter 的有界执行中短暂
物化。Canonical request plan、execution reference、DNS result、auth buffer、request/response body 和 parser state 只在
当前 desktop authorization 生命周期内存中存在。成功、失败、取消、timeout、锁定、Vault 切换、窗口关闭、进程退出和
panic cleanup 必须幂等清除。Audit 只允许 coarse profile/item opaque ID、method、target class、duration、status class、
byte count 和 result class；禁止 URL query/body、Header、credential、response、local path 和 canary。

## 兼容与迁移

本阶段没有自动迁移和持久 request/response history；已有 API Profile 保持唯一配置来源。Typed execution contract v1
未知字段/version fail closed，不提供 generic fallback。若后续保存请求模板、OAuth state、Cookie、证书例外、response
或代理配置，必须建立新的 Work/Requirement，并评估 Vault format、秘密所有权、导入导出、history 和 rollback。
Agent permission store、MCP/IPC 和 Browser RPC 不迁移、不复用 desktop execution authority。
