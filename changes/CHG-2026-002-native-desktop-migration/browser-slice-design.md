# macOS Native browser broker slice design

- Work ID：`CHG-2026-002-native-desktop-migration`
- Task：`NDM-050`
- Requirement：`REQ-BROWSER-001`、`REQ-BROWSER-002`、`REQ-AUTOFILL-001`、
  `REQ-AUTOFILL-002`、`REQ-PASSKEY-001`、
  `REQ-IMPORT-001` 及 RPC CRUD 对应的既有 item/recovery Requirement
- Tests：`CT-BROWSER-001`、`CT-BROWSER-002`、`CT-NATIVE-BROWSER-001`、相关 Autofill/Passkey/Import CT、
  `AT-BROWSER-001`
- 状态：In Progress

本文记录 Native broker/host 迁移的实现定位，不重新定义 Browser RPC 操作、策略或
extension workflow。完整操作枚举继续由
`apps/desktop/src/shared/browser-rpc.ts`、`browser-rpc-policy.ts` 和
`browser-extension-capabilities.ts` 所有。

## Transport 与安装边界

- Native Preview 使用独立 broker endpoint、pairing credential、host manifest target
  和 bundle helper；不得覆盖或静默复用 Electron 的 socket、pairing file、launcher 或
  native-host registration。
- Native messaging helper 只做 Chromium framing、request correlation、HMAC envelope
  和 broker forwarding；不得打开 Vault、读取 Vault Key、执行 RPC policy 或持久化 response。
- macOS host manifest 必须绑定同一固定 extension ID，并指向已签名 app bundle 内 helper。
  Development 安装必须显式执行且可卸载；正式安装、升级和卸载仍由 `NDM-070` 的签名
  package Gate 验收。
- Pairing secret 必须由 CSPRNG 生成；正式签名 package 存于 Native Preview 独立的 OS credential
  namespace，ad-hoc Debug development build 可以存于 app container 的 owner-only `0600` 文件。
  helper/launcher 只能取得完成当前 HMAC 所需的 locator/credential；revoke 删除 credential、清理
  broker session/pending request，并使旧 helper 请求立即返回 unpaired。
- Development broker socket 必须位于 Native Preview container 的短路径，满足 macOS Unix-domain
  `sockaddr_un.sun_path` 字节限制，并由 app 与 host 使用同一 locator。

## 独立授权与生命周期

- Native desktop handle 与 browser authorization 必须分离。desktop create/unlock 不得使
  `vault.status` 的 browser surface 变为 unlocked；browser `vault.unlock` 也不得解锁
  SwiftUI desktop state。
- Browser lock、revoke、broker stop、system sleep/session lock 和 application termination
  必须清除 browser handle、replay cache、confirmation、pending disclosure、import/SSH
  临时秘密会话、未被替换的 clipboard 与 response buffer。Import/SSH 会话还必须由主动
  expiry task 清除，不能依赖下一次请求才淘汰。只有 browser authorization 被撤销时，
  desktop handle 可以继续存在。
- Broker 在解析 request body 前执行 line/JSON size limit，在 dispatch 前执行 HMAC、RPC
  version、UUID correlation、issued/expiry 和 replay validation。未知 version fail closed，
  不做 v2 downgrade。

## RPC parity

- Native broker 必须对共享 RPC v2 operation manifest 建立显式 allowlist 和 capability
  policy；新增 operation 若缺少 Native route 或明确的 unavailable platform adapter，
  `CT-NATIVE-BROWSER-001` 必须失败。
- Core-backed operation 通过 `vault-ffi` 的 operation-oriented API 访问 `vault-core`；不得
  链接 `electron-bridge` 或把 Rust layout/envelope bytes 交给 Swift/helper。
- FFI 在反序列化前执行与共享 contract 对齐的 UUID、枚举、长度、数组和 HTTP(S) 边界；
  mutation 保留旧加密文件和 quick Vault Key，只有 core operation 与原子写盘均成功才发布
  新 session，任一失败必须恢复旧文件和旧内存状态。
- Clipboard、dialog、biometric、Passkey confirmation、import 和 SSH scan 由 macOS platform
  adapter 执行。Helper、extension storage 与普通 metadata DTO 不接收受保护值。
- Native broker 的 registry、policy 和 dispatch/FFI route 已通过严格 104/104 parity；在
  packaged `AT-BROWSER-001` 通过前，Native host 仍不替换默认 `com.vaultmesh.browser`
  release registration，Electron 继续提供当前 browser broker。
- Workspace 和五类普通 list/detail 继续使用 protected-value-free DTO。Login
  `items.detail` 的 custom-field value 已明确分类为 fresh-gesture `pageDisclosure`：它不是
  普通 metadata route，只能服务当前 popup 操作，不得进入 extension storage、持久化 UI
  state、日志或 crash data。Copy/fill 仍使用 field-scoped protected FFI 或一次性 assignment。
- 平台 routes 覆盖独立 Touch ID/PIN、security settings、CSPRNG password generation、加密
  backup/restore、限界 CSV/Bitwarden import、无 symlink 的 `~/.ssh` scan、ES256 Passkey
  create/get 和 origin/document/handle-bound autofill。PIN/biometric namespace 与 desktop 分离；
  Passkey 私钥只作为加密 `authenticator-key` secret 存入 Vault。

## Verification

- Cross-process contract 使用隔离临时目录、合成 pairing secret 和 Native Preview Vault，
  覆盖 native frame、socket correlation、错误 HMAC、过大/畸形消息、RPC mismatch、expiry、
  replay、desktop/browser 独立 unlock/lock、revoke、restart 和 final cleanup。
- Manifest parity test 读取共享 TypeScript operation/policy/workflow owner，并与 Native route
  registry、Swift dispatch 和 Rust FFI operation 比较；禁止通过复制一份人工维护的“支持
  列表”后只验证自身。当前严格结果为 104/104。
- `AT-BROWSER-001` 必须在目标 macOS 浏览器与已签名/隔离安装产物上覆盖 host
  install/uninstall、固定 ID、pair/revoke、background reconnect 和应用退出后的不可用状态。
