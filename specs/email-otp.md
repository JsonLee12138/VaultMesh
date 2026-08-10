# Email OTP spec

拥有：`REQ-EMAIL-001`、`REQ-EMAIL-002` 的 Provider、secret 和 runtime lifecycle。Email OTP 是 privileged desktop service；renderer 只接收 account summary 和 short-lived candidate。

## 权威实现定位

- Service/runtime：`apps/tauri-desktop/src-tauri/src/email_otp.rs`；由 `CHG-2026-004` 的 TDM-040 跟踪
- Encrypted account record：`crates/vault-core/src/model.rs`、`crates/vault-core/src/session.rs`
- Typed command boundary：`apps/tauri-desktop/src/tauri-api.ts`
- Schema/default：`apps/tauri-desktop/src/shared/contracts.ts`
- Provider preset：`apps/tauri-desktop/src/shared/email-providers.ts`
- UI route：`apps/tauri-desktop/src/renderer/src/pages/EmailOtpPage.tsx`

## Gmail

Gmail 使用 Desktop OAuth client、Gmail API 和 scopes `openid`、`email`、`https://www.googleapis.com/auth/gmail.readonly`：

```sh
VAULTMESH_GOOGLE_OAUTH_CLIENT_ID="...apps.googleusercontent.com"
VAULTMESH_GOOGLE_OAUTH_CLIENT_SECRET="..." # provider 实际签发时才设置
```

OAuth 使用 system browser、随机 `127.0.0.1` loopback port、state validation 和 PKCE S256。Restricted Gmail scope 的公开发行必须完成 Provider verification。选中 message 以 raw form 获取，只在内存解析。

Client ID 可以由构建环境直接注入，或在仓库根目录的未跟踪 `.env` 中配置；Tauri build script
把 Google Desktop OAuth Client ID、provider 实际签发的 Client Secret 和 Microsoft tenant
带入产品构建。正式构建必须由 CI Secret 注入，本地打包可以从仓库根目录未跟踪的 `.env`
读取；最终用户不配置开发者 OAuth credential。Desktop OAuth client 是 public client，包内
Client Secret 不构成安全或鉴权边界；授权安全必须依赖 system browser、PKCE S256、state 和
随机 loopback callback。构建 credential 不得进入源码提交、日志、renderer 或普通 settings。
所有生成可分发 Tauri 安装包的 CI workflow 必须显式注入
`VAULTMESH_GOOGLE_OAUTH_CLIENT_ID` 和 Provider 为该 Desktop Client 签发的
`VAULTMESH_GOOGLE_OAUTH_CLIENT_SECRET` repository Secret，并在缺失、格式无效或 Provider
不接受该 credential pair 时于编译前 fail closed；不得发布运行后才显示“尚未配置”的安装包。已经缺少该编译期配置的 immutable Review/Test
产物不得原地覆盖，必须用严格递增版本重新构建。

## Outlook/Microsoft 365

Entra public client 必须配置 mobile/desktop platform、`http://localhost` redirect 和 delegated `Mail.Read`：

```sh
VAULTMESH_MICROSOFT_OAUTH_CLIENT_ID="..."
VAULTMESH_MICROSOFT_OAUTH_TENANT="common" # optional
```

流程使用 authorization code + PKCE 和 `offline_access`；refresh/access token 只存在于 encrypted account record。

## IMAP

QQ、163、126、Yeah、iCloud、Yahoo、Zoho、Fastmail 使用 TLS IMAP preset 和 provider-generated app password/authorization code。Custom IMAP 允许。禁用 TLS 只可用于 local/private-network development，不能作为安全 internet 配置展示。

## Runtime 与数据生命周期

- Enabled 且 desktop/browser 至少一个 authorization unlocked 时开始 monitoring；final lock 后停止。
- Gmail 推进 `historyId`；Outlook 使用 received-time cursor + message-ID dedup；IMAP 使用 UID cursor。
- OTP page detection 或 send/resend gesture 启动 90-second、3-second interval 的 bounded boost。
- 受信任的 send/resend gesture 必须立即执行一次增量 scan；重复 gesture 刷新 90-second boost，超时后恢复普通 polling，navigation、browser lock 或 final lock 停止对应短时状态。
- Provider read-only；email source/body 仅在 main memory 解析，不持久化。
- 候选提取支持 4–8 位且至少包含一个数字的 ASCII 字母数字 OTP，保留原始大小写并按完整
  token 边界识别。验证码语义在 token 之前时可以提取数字或混合 token；token 在语义之前
  时只允许紧邻的空白、标点或明确中英文连接表达，禁止跨过品牌名或无关字母数字文本。
- Candidate dedup、expiry；final lock 清除 connection、cursor、boost 和 candidate。
- Tauri runtime 按非秘密 polling policy 在后台执行 bounded scan，并只通过短时事件向当前
  Email OTP 页面发布 renderer-safe candidate；账户 credential 和邮件正文不进入事件。
- Notification 必须 redact code；点击 notification 经 protected clipboard path。
- OAuth callback window 只能在 bounded callback time 内 suspend blur/idle lock，success/cancel/timeout 后立即恢复。
- Browser popup/页内 candidate query 必须由独立 browser authorization 发起并携带当前 HTTP(S) origin；Rust 验证 origin 但不得用它过滤候选，只返回全部未过期候选的有界 code/source/received/expiry 摘要。用户选择后 Rust 按 candidate ID、expiry 和当前 origin 重验，再生成只面向空 OTP field 的一次性 document-bound assignment。
- Token、app password、email source/body 和 OTP 禁止 log/persist。

Non-secret polling policy 可以写 Tauri user-data；Provider secret 必须留在 encrypted Vault。

## 验证

运行 `pnpm tauri:typecheck` 和 `pnpm tauri:test`。Rust CT 必须覆盖 encrypted account CRUD、
renderer redaction、TLS policy、OTP parsing、dedup、poll、expiry、lock cleanup 和 OAuth
state/PKCE 边界。真实 Gmail、Outlook 与代表性 IMAP Provider 仍必须执行 `AT-EMAIL-001/002`；
Provider Client ID、权限审查和 live AT 未完成时平台状态保持 Not Run。
