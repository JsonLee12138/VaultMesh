# Google Passkey assertion 兼容性

## 问题或目标

在 macOS Chromium/Edge 的 `myaccount.google.com` 创建并由 VaultMesh 保存 Google Passkey 后，从 `accounts.google.com` 使用该凭据登录：扩展成功接管 `navigator.credentials.get`、Tauri 显示 native confirmation，Google 随后进入 `challenge/pk/error` 并显示“无法为您登录账号。请重试或换个方式”。预期 Google 接受 assertion 并继续登录，实际是服务端拒绝。最小复现不读取或记录真实 challenge、credential、userHandle 或签名。

## 预期行为

`REQ-PASSKEY-001`：VaultMesh 对 Chromium WebAuthn proxy 的 ES256 assertion 必须生成可由注册公钥验证、与 RP/origin/challenge 及输入 client extensions 一致的标准响应；Google 等同时兼容 legacy FIDO AppID 的 RP 不得因未处理但已由 Chromium 验证的 AppID client input 拒绝当前 WebAuthn credential。challenge 是由 RP 提供的 opaque bytes，必须使用独立于 credential ID/userHandle 的合理有界长度接收。

## 非目标

不支持 legacy U2F credential，不使用 AppID 代替当前 WebAuthn RP ID，不新增 largeBlob/PRF，不改变私钥所有权、确认策略或 Google 账号配置。

## 影响范围

涉及 Tauri Rust Passkey request/response、extension WebAuthenticationProxy passthrough、`CT-PASSKEY-001` 和真实 Chromium `AT-PASSKEY-001`。Vault format/payload、core/FFI、Browser RPC v2 operation/schema、native host framing、其他网站数据和发布平台范围不变。

## 实现约束

Rust 仍是签名唯一所有者；只接受 Chromium `requestDetailsJson` 中有界、类型正确的 challenge、credential descriptor 与 extension input。challenge 必须使用单独的 decoded-byte 上限，不能复用 credential ID/userHandle 的 encoded-character 上限。当前 WebAuthn credential 的 authenticatorData 必须始终使用 RP ID hash；若 Chromium 提供已验证的 `appid` input，response 只可回报 `appid: false`，不得把它当作 U2F credential 或更换签名 scope。失败不得泄漏请求正文、私钥或签名。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| BUG-017-T1 | REQ-PASSKEY-001 | Google-shaped request 复现 client extension output 缺失，且 assertion 由注册公钥验签 | CT-PASSKEY-001 | Done |
| BUG-017-T2 | REQ-PASSKEY-001 | Rust assertion 对 WebAuthn credential 回报正确的 AppID false output，并保持 RP hash/signature | CT-PASSKEY-001 | Done |
| BUG-017-T4 | REQ-PASSKEY-001 | 接受 Google 实测 5212-byte challenge，保持独立 16 KiB challenge bound 与既有 identifier bound | CT-PASSKEY-001 | Done |
| BUG-017-T3 | REQ-PASSKEY-001 | Chromium/Edge Google 登录回归 | AT-PASSKEY-001 | Pending |

## 验收与证据

- 自动化必须先证明修复前 Google-shaped `appid` input 没有对应 output，再在修复后断言 `clientExtensionResults.appid === false`。
- 自动化必须用注册公钥验证 `authenticatorData || SHA-256(clientDataJSON)` 的 ES256 DER signature，并检查 RP ID hash、UP/UV/BE/BS/AT/ED flags、counter、credential ID 和 userHandle。
- malformed/oversized AppID input、credential mismatch、锁定与 native confirmation 取消继续 fail closed；N/A：重复、过期由既有 Browser RPC policy 处理，Vault format/rollback 无变化。
- 平台：macOS Chromium/Edge 当前开发扩展与 Tauri runtime；真实 Google 登录作为 `AT-PASSKEY-001`，若当前任务无法安全重试则保持 Not Run。

验证证据（2026-07-24）：

- 修复前 focused Rust regression 失败：Google-shaped request 的 `clientExtensionResults.appid` 实际为 `null`、预期为 `false`；其余 RP ID hash、flags、counter、credential/userHandle 与注册公钥 ES256 验签均已到达该断言。
- 修复后 `cargo test -p vaultmesh-tauri-desktop passkey_service::tests --lib`：4 passed；`pnpm tauri:test`：Rust 51 passed、renderer 63 passed。
- `pnpm extension:typecheck`、`pnpm extension:test`、`pnpm extension:build`：通过，extension 33 files / 215 tests；`pnpm verify:browser-parity`：2 files / 6 tests。
- `pnpm tauri:typecheck`、`cargo check -p vaultmesh-core -p vaultmesh-ffi -p vaultmesh-tauri-desktop`、`cargo fmt --all -- --check`、`pnpm docs:check`：通过。
- `pnpm tauri:build` 在 macOS x86_64 成功生成 `target/release/bundle/macos/VaultMesh.app` 与 `target/release/bundle/dmg/VaultMesh_0.1.0_x64.dmg`。
- 用户安装并运行修复 bundle 后再次提交 Google 登录，仍进入 `challenge/pk/error` 并显示相同错误；`AT-PASSKEY-001` 为 Fail，`BUG-017-T3` 保持 Pending。`/Applications/VaultMesh.app/Contents/MacOS/vaultmesh-tauri-desktop` 与构建产物 SHA-256 均为 `568996fec5f57969d20f13d57fd64270e1740e67e96e3abb3685e8d4c6c6c6a0`，app mtime 均为 `2026-07-24 15:40:22`，排除误测旧 desktop bundle。
- 经用户明确允许后，在当前 Google 错误页执行一次重试并只捕获非秘密 WebAuthn 结构元数据：origin=`https://accounts.google.com`、RP ID=`google.com`、same-origin ancestors=true、challenge=5212 decoded bytes、allowCredentials=3、公开 extension keys 为空、UV=`preferred`。调用以 `NotAllowedError` 结束且没有 assertion response，证明 `myaccount.google.com` 展示来源与 `accounts.google.com` 登录来源不是阻断点，失败发生在 VaultMesh response 返回之前。
- 修复前 focused regression `google_sized_challenge_has_a_separate_bounded_limit` 失败：5212-byte challenge 被共享的 4096-character base64url identifier limit 拒绝。修复后该用例通过，并验证 decoded challenge 超过 16 KiB 仍拒绝、credential identifier 原上限不变。
- challenge 修复后 `pnpm tauri:test`：Rust 52 passed、renderer 63 passed；`cargo fmt --all -- --check` 与 `cargo check -p vaultmesh-core -p vaultmesh-ffi -p vaultmesh-tauri-desktop` 通过。新 bundle 的真实 Google AT 待安装复测。
- `pnpm tauri:build` 成功生成第二轮修复 bundle：macOS app executable SHA-256 `3981a7e31f6d83d888a35fb18d4e3b54c3c99a914b3d01ec309d8073bbff12ce`，DMG SHA-256 `945457315dc6e444f335c6c883d05e835c3f7415571d91db4bcd8c274402c194`。`AT-PASSKEY-001` 保持 Fail/Pending，直到用户安装该 bundle 并完成真实 Google 回归。

## 安全与数据生命周期

AppID 是非秘密 request metadata，只存在于当前 RPC/request 生命周期；不得持久化或记录。credential private JWK、userHandle 和 signature 仍只在 encrypted Vault 与 active Rust process 内使用，extension 仅接收当前 WebAuthn response，lock/revoke 清理语义不变。

## 兼容与迁移

无 Vault format/payload、settings、pairing、RPC version/operation、IPC 或 ABI 迁移。旧 extension 与现有 credential 继续使用同一操作；回滚会恢复不含 AppID output 的失败行为，但不会损坏 credential。

## Bug 根因（仅 type=bug）

已确认两个实现缺陷。第一，Google-compatible assertion 可以包含用于 legacy FIDO U2F 兼容的 `appid` client extension input；原 `GetRequest::extensions` 丢弃该字段并始终返回空 `clientExtensionResults`，没有回报当前 WebAuthn credential 未使用 AppID。修复后 `appid` 只作为有界 HTTPS client input 解析，当前 WebAuthn credential 返回 `appid: false` 并继续签署 RP ID hash。第二，也是本次真实重试的直接阻断点：`validate_common` 对 challenge 复用了 base64url identifier 的 4096-character 上限，而 Google 实际提供 5212 decoded bytes；Rust 因此在签名前拒绝请求，extension 将错误映射为 `NotAllowedError`，Google 未收到 assertion。修复后 challenge 使用独立的 16 KiB decoded-byte 上限，credential ID/userHandle 仍保留原上限。既有 `CT-PASSKEY-001` 只检查计数器和 redaction，未覆盖 Google-sized challenge、client extension output，也未由注册公钥验证最终 assertion，因此错误实现仍显示 Pass。受影响版本与修复版本均为未发布的 extension/Tauri desktop `0.1.0-development`；真实 Google AT 仍需安装新 bundle 后确认。
