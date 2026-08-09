# ADR-0016：桌面 API Request Workbench 的网络与响应边界

- 状态：Accepted
- 日期：2026-08-04
- 关联 Work：`CHG-2026-027-privileged-api-request-workbench`
- 关联 Requirement：`REQ-API-002`
- 关闭 OPEN：无

## 背景

`ApiEnvironment` 已由 `ADR-0015` 拥有结构化 target/auth/Header 配置，Login/Secret 继续拥有 credential value。
桌面用户需要在不把展开秘密交给 WebView 的前提下验证环境和执行少量结构化 HTTP 请求。该能力会让桌面特权进程
访问外部网络、loopback 和私网；若复用 Agent `ADR-0011` 的宽松 TLS/target 结论，renderer compromise、DNS 漂移、
redirect、系统代理或恶意响应可能扩大 credential destination 或把秘密带回 WebView。

桌面工作台是用户直接操作的独立 authority，不使用 Agent pairing、ActionPlan、permission store、MCP/IPC 或 Browser RPC。
它需要自己的目标分类、确认、TLS、DNS、proxy、quota、response 和生命周期决策。

## 决策

工作台使用短时、单次、内存态的 prepare/execute contract。Prepare 只接收 Environment opaque ID 与结构化 method、
relative path、bounded query/header/body，重新读取 live Environment，单次 canonicalize 请求，解析 DNS，将 canonical
request digest、Environment revision/policy digest、目标分类和固定地址集合绑定到随机 execution reference。Prepare
不得读取或保存 credential value。Reference 最长保留 60 秒，单次 execute 或 cancel 后失效，未知 version/field/reference
fail closed。

Execute 必须重新读取 live Environment 与 credential item，并逐字段比较 Environment ID、revision/policy digest、origin、
base path、auth/Header binding 和 request digest；漂移、deleted/disabled 不作为桌面执行门，但 Service/credential 不 live、
kind/lifecycle/reference 漂移必须拒绝。Credential 只在最终 Rust network adapter 中物化。普通 Header、auth Header、
API-key query 与 body 只能由同一 immutable plan 构造，renderer 不能提交展开 secret、Authorization、Cookie、Host、
Proxy、hop-by-hop 或传输控制 Header。

目标策略如下：

- Public target 必须使用 HTTPS 和系统 WebPKI/hostname/expiry 校验；不提供 self-signed、invalid certificate、pin 绕过或
  certificate exception。公共 HTTP 拒绝。
- Loopback/private target 可以使用 HTTP(S)，但每次执行都由 Rust-owned 原生确认显示 canonical method、origin/base path
  和 target class；不保存例外。Mutation method、任何明文 HTTP 也必须逐次原生确认。GET/HEAD 的 public HTTPS 不增加
  第二确认，仍要求当前 workbench 的显式发送动作。
- Unspecified、multicast、broadcast、link-local、IPv4/IPv6 metadata target 和 public/private 混合 DNS 结果拒绝。
  Prepare 最多接受 16 个同类地址并固定到当次连接；execute 不重新选择其他 DNS 地址。IP literal 使用同一分类规则。
- Client 禁用系统/环境 proxy、redirect、Cookie jar、credential store、自动 retry、connection pooling 和压缩协商。
  `3xx`、非 identity content-encoding、WebSocket/SSE/stream/multipart/binary 全部拒绝。

V1 支持 `GET/HEAD/POST/PUT/PATCH/DELETE`、唯一 bounded query、普通 request Header、空/JSON/UTF-8 text body。
GET/HEAD 不接受 body；mutation 不自动 retry。Connect 前明确失败返回 safe `failed`；mutation 在请求可能已发送后发生
timeout、cancel 或 transport loss 返回 `execution-unknown`。用户可以据此人工核对，产品不得把它显示为“未执行”。

默认 connect timeout 为 5 秒、overall timeout 为 15 秒；request body 最大 256 KiB；response wire/body 最大 1 MiB；
response Header 最多 64 个且合计 16 KiB；JSON 最大深度 16、最多 2,048 个容器项；同一主窗口最多 2 个 active、
4 个 prepared 请求。Response 只返回 status、`content-type/content-length/content-language/cache-control/expires/etag/
last-modified/retry-after` allowlist 和有界 JSON/UTF-8 text。危险 Header、raw library error 与未允许 content type 不返回。
Secret canary 覆盖 exact credential、Basic 组合、标准/URL-safe Base64 与 hex；Header/body 任一命中都丢弃 body并返回
safe error。通用变换无法被绝对检测，UI 必须把业务 response 视为可能敏感且 memory-only。

Prepare state、request/response buffer、auth material、DNS result 和 parser state只存在于当前 desktop authorization。
成功、失败、取消、timeout、Vault lock/switch/restore、窗口关闭/隐藏、应用退出和 panic cleanup 都必须幂等取消并清除。
工作台不写 history、console、audit body、telemetry、snapshot、argv、environment、proxy 或临时文件。

## 原因

- 两阶段 immutable reference 让 native confirmation、DNS pin、live profile revalidation 和 renderer 请求保持同一摘要。
- Public HTTPS + WebPKI 避免把 Agent direct compatibility 的宽松网络风险扩展到用户桌面工具。
- Local/private 逐次确认保留本地开发 fixture 能力，同时不产生持久 SSRF/明文例外。
- 禁用 redirect/proxy/retry/compression 能在 V1 中清晰证明 credential destination、结果未知和 byte quota。
- Response 重构与 canary 降低直接反射泄露，但不把任意远端业务数据错误宣传为非敏感。

## 后果

- 已保存的 public HTTP 或 self-signed HTTPS Environment 仍可配置/供其他已接受 surface 使用，但桌面工作台会拒绝执行；
  用户必须使用有效 public HTTPS，或在 loopback/private 的逐次原生确认范围内测试。
- 工作台不是 Postman/Insomnia 替代品，不支持 redirect、压缩、binary、stream、Cookie、OAuth acquisition、mTLS、脚本或 proxy。
- `ADR-0011` 的 Agent direct Secret HTTP 与 `CHG-2026-028` 的 Agent Environment execution 不继承本决策的用户确认，
  工作台也不继承 Agent permission。共享底层 parser/helper 时必须保留独立 policy owner 和 parity test。
- macOS 与 Windows packaged app 必须分别使用无生产凭据 fixture 验证原生确认、TLS、DNS pin、cancel/lock cleanup 和
  response memory-only；目标 OS 证据不能由交叉编译替代。

## 被拒方案

- Renderer 直接 `fetch` 或使用 Tauri HTTP plugin：会让 WebView 获得 target/auth 与任意网络 authority。
- 复用 Agent pairing/permission/宽松 TLS：混淆两个独立用户与威胁模型，并扩大持久权限。
- 接受 self-signed/public HTTP 或由 Profile 保存 TLS 例外：产生长期中间人和 downgrade 配置面。
- 跟随 redirect 或系统 proxy：credential 可能离开已绑定 destination，proxy credential/日志也成为新秘密所有者。
- 自动重试 mutation：无法区分请求未送达与远端已执行。
- 返回 raw Header/body/library error：会绕过 response allowlist、quota、canary 和安全错误契约。

## 验证

`CT-API-REQUEST-001` 覆盖 contract、canonical request、auth/header/body 注入、live drift、single-use、timeout/cancel、
execution-unknown 和有界 JSON/text response；`CT-API-REQUEST-SEC-001` 覆盖 target classification、WebPKI、DNS pin、
metadata/link-local/mixed DNS、redirect/proxy/compression/header smuggling、oversize/depth、secret canary 与 lifecycle cleanup；
`CT-SEC-001`、`CT-PRIV-001`、`CT-AGENT-HTTP-001` 回归边界隔离；`AT-API-REQUEST-001` 在 macOS/Windows packaged app
使用无生产凭据 fixture 完成用户可见验收。
