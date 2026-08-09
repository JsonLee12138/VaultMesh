# macOS privileged access and platform security slice design

- Work ID：`CHG-2026-002-native-desktop-migration`
- Task：`NDM-040`
- Requirement：`REQ-SEC-002`
- Tests：`CT-NATIVE-PRIVILEGED-001`、`CT-NATIVE-QUICK-UNLOCK-001`、
  `CT-NATIVE-CLIPBOARD-001`、`AT-NATIVE-MACOS-003`
- 状态：Automated verification passed；interactive AT pending

本文记录 NDM-040 的实现定位，不重新定义 quick unlock、锁定或 clipboard 的用户行为。

## Privileged value ABI

- ABI v1 追加 field-scoped protected-value operation。调用方必须提供 item kind、field、
  opaque UUID、可选主密码和 empty out-buffer；未知组合、缺失字段、锁定、错误 UUID、
  ABI mismatch 和 non-empty out-buffer 必须 fail closed。
- core 继续拥有 protected-field lookup 和 `master_password_reprompt`。需要重新验证但未提供
  主密码时返回稳定 re-auth-required status；错误主密码返回 authentication-failed。
- 成功结果使用 Rust-owned `VaultmeshBuffer`。Rust 临时值、Swift copy/reveal 临时 bytes、
  取消、失败、选择变化、lock 和 teardown 都必须走显式清零路径。
- TOTP operation 只返回当前 code，不返回 seed。Identity 没有 protected-value operation；
  login custom field 不进入本切片的普通 metadata/protected-copy ABI，Browser RPC 只能通过
  `NDM-050` 明确分类的 fresh-gesture `items.detail` page-disclosure route 有界读取。

## Clipboard and reveal

- SwiftUI 不直接拥有 clipboard capability；`MacClipboardService` 是 AppKit adapter，并使用
  pasteboard change count 识别值是否仍由 VaultMesh 写入。默认 expiry 为 30 秒。
- 新 copy 覆盖旧 timer；普通 app deactivation 锁定 Vault/reveal 但保留已授权 clipboard
  到原 expiry，使值可以粘贴到目标应用。到期、显式 lock、system sleep/session lock 和
  app termination 只清除仍未被其他应用替换的 clipboard，避免删除用户之后复制的内容。
- Reveal 只在用户动作后短时显示，默认 15 秒自动隐藏；selection、lock、scene inactive、
  operation supersession 和 teardown 立即清除。需要 re-prompt 的 item 在读取前使用当前
  主密码验证，不把主密码写入 view restoration、defaults 或 log。

## Touch ID and secure storage

- `vaultmesh_vault_quick_unlock_key` 只从已解锁 session 导出 32-byte 随机 Vault Key；
  `vaultmesh_vault_unlock_with_key` 读取有界 encrypted Vault 后由 core 解锁。两端临时 key
  bytes 必须清零，错误长度和被修改 Vault 返回 authentication-failed，不能发布 handle。
- `MacQuickUnlockService` 使用 bundle-scoped Keychain service/account，并以
  `biometryCurrentSet` + device-only accessibility 保存 key。Keychain item 不保存主密码、
  Vault path 或 payload；Native Preview 固定默认 Vault path 由 adapter 自行计算。
- Touch ID availability、用户取消、Keychain item 缺失/失效和 FFI unlock 失败必须保持
  locked；失败不得退化为无 user-presence 的 Keychain read。Disable 删除 credential。
- Quick unlock credential 不等于当前 authorization：每次 app 启动或 lock 后仍保持 locked，
  必须重新完成 Touch ID。主密码轮换/restore 后续接入时必须删除旧 credential。

## Verification

- Rust contract 覆盖所有 protected field、re-prompt、错误密码、locked/not-found/invalid
  combination、ABI mismatch、buffer ownership，以及 quick-key export/unlock/错误长度/篡改。
- Swift static-link contract 使用独立 named pasteboard 验证 unchanged expiry、external
  replacement preservation 和 explicit cleanup，并验证 privileged/quick-unlock worker buffer
  销毁路径。
- `AT-NATIVE-MACOS-003` 在真实 Touch ID/Keychain/AppKit 环境验收 enable、cancel、unlock、
  disable、sleep/scene inactive、copy expiry、replacement preservation 和 reveal cleanup。
