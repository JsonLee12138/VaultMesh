# macOS safe item metadata slice design

- Work ID：`CHG-2026-002-native-desktop-migration`
- Task：`NDM-030`
- Requirement：`NFR-PRIV-001`
- Tests：`CT-PRIV-001`、`CT-NATIVE-MEMORY-001`
- 状态：Verified 2026-07-22

本文记录原生 summary/detail list 切片的实现定位，不重新定义 Item CRUD、
privileged copy/reveal 或持久化行为。

## Safe DTO boundary

- `vault-ffi` 从 `vault-core` 已有的安全 summary/detail operation 构造独立的
  Native item DTO；不得序列化 payload、内部 Item struct 或 Rust debug/error。
- list 与 detail response 使用带独立 schema version 的 UTF-8 JSON，承载在
  Rust-owned `VaultmeshBuffer` 中。调用方必须从 empty buffer 开始，并在成功路径、
  decode 失败、取消、锁定和 teardown 中调用 matching destroy。
- DTO 只包含 item kind、opaque UUID、标题、普通 metadata、favorite/re-prompt
  policy 和 protected-field presence。密码、TOTP seed、login custom-field value、
  完整卡号、安全码、PIN、SSH password/public/private key/passphrase 和 developer
  secret value 禁止进入 response。
- Login custom field 当前没有逐字段敏感分类，因此本切片全部省略其 label/value；
  后续只有在 core model 提供安全分类后才能通过独立 Change 暴露。
- 新 list/detail operation 与 not-found status 是 ABI v1 的 append-only addition；
  既有 operation、status 数值和 ownership 语义不变。未知 ABI、item kind、UUID 或
  非 empty out-buffer 必须 fail closed。

## macOS lifecycle

- Swift adapter 只解码 safe DTO，临时 JSON `Data` 在 decode 后清零，原始 Rust
  buffer 始终 destroy；SwiftUI state 不接收原始 JSON 或 core model。
- 所有 list/detail FFI 调用继续在 `VaultWorker` 串行队列运行。MainActor 只发布
  safe summary/detail、加载状态和稳定 status 映射。
- lock、scene inactive、operation supersession 和 app termination 必须立即使
  MainActor 上的 summary/detail 失效；队列中的旧结果通过 revision 拒绝发布。
- UI 使用真实 FFI response。空 Vault 显示 empty state，不使用静态演示数据；
  CRUD 和 privileged copy/reveal 分别属于后续切片。

## Verification

- Rust C-ABI contract 以运行时生成的合成 Vault 覆盖五类 item，在每个 protected
  field 放置唯一 sentinel，并断言 list/detail JSON 均不包含 sentinel。
- 同一 contract 覆盖 locked、not-found、ABI mismatch、invalid kind/UUID、empty
  out-buffer 和 matching destroy。
- Swift contract 通过真实 static-linked FFI 解码 empty list，并验证 lock 后响应
  buffer 保持 empty；Xcode Debug/Release build 验证实际 SwiftUI list/detail。
