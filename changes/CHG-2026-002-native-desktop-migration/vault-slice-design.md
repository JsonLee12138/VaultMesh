# macOS Vault lifecycle slice design

- Work ID：`CHG-2026-002-native-desktop-migration`
- Task：`NDM-020`
- Requirements：`REQ-VAULT-001`、`NFR-REL-001`
- Tests：`CT-NATIVE-VAULT-001`、`CT-NATIVE-RESPONSIVENESS-001`、
  `AT-NATIVE-MACOS-001`
- 状态：Automated verification passed；interactive AT pending

本文记录首个 macOS 原生垂直切片的实现定位，不重新定义 Requirement。

## Operation boundary

- `vaultmesh_vault_create` 接收 ABI version、UTF-8 Vault path、borrowed password
  bytes 和 empty out-handle。operation 必须先在 `vault-core` 创建 session 和加密
  envelope，确认目标不存在并原子提交成功后才发布 opaque handle；现有 Vault 必须
  fail closed，禁止 create 覆盖。
- `vaultmesh_vault_unlock` 读取有大小上限的加密文件并调用 `vault-core`；错误密码
  使用稳定 authentication-failed status，不能返回 core error string。
- `vaultmesh_vault_status` 只返回 locked/unlocked state，不返回路径、header、Key 或
  payload metadata。
- `vaultmesh_vault_lock` 必须幂等并立即调用 core lock。`vaultmesh_vault_destroy`
  接收 handle pointer-to-pointer，先置空调用方 handle，再 lock/drop，因此显式 lock、
  app termination 和失败 teardown 使用同一最终清理路径。
- 同一 handle 由 macOS `@MainActor` adapter 串行调用；ABI v1 不接受同一 handle
  的并发 operation。实现必须把 handle 移入专用串行 worker；MainActor 不直接调用
  阻塞 FFI，worker 的同步 destroy 是 application termination 的最终清理路径。

## Persistence ownership

- 原生客户端的原子 Vault 文件持久化由 `vault-ffi` 持有；SwiftUI/AppKit 只计算
  应用容器内的默认 path，不读取或写入 envelope bytes。
- `vault-ffi` 可以复用与 Electron bridge 相同的原子写语义和 64 MiB 输入上限，
  但不得依赖 `electron-bridge` 或 N-API。
- Create 的 session 在原子 commit 失败时仍是局部值并立即 drop/zeroize；out-handle
  保持 null。后续 mutation 必须采用相同的 commit-before-publish/rollback 模式。
- 原生 preview 使用 `com.vaultmesh.preview.macos`、独立应用名和 App Sandbox
  Application Support 默认路径。默认 UI 不显示 path picker 或“打开其他 Vault”；
  启动时只检测默认文件是否存在，然后显示 create 或 unlock。
- 显式 import/restore/backup 才可以在后续切片使用系统文件面板；`NDM-DEC-002`
  完成前不得把 Electron Vault 作为 native 默认文件。

## macOS presentation

- App 使用 SwiftUI scene、单内容窗口、semantic colors 和 SF Symbols；当前只有
  lifecycle 一个真实目的地，因此不显示侧边栏或占位导航项，也不使用文件面板。
- Lifecycle 内容列最大宽度为 520 pt；外层使用可滚动的全窗口居中容器和 32 pt
  最小安全边距，使窗口放大时内容保持双向居中、窗口缩小时不裁切操作区域。
- 密码只存在于当前 secure input 操作。adapter 将其转为临时 UTF-8 `Data`，在 FFI
  返回后清零临时 bytes；view 随后清空 secure-field binding，禁止 scene storage、
  defaults、日志和 restoration。
- create/unlock 期间显示原生 indeterminate progress，禁用 secure input 与提交按钮；
  worker 完成后才在 MainActor 发布最终 state。scene 失活时排队 lock，使正在执行的
  create/unlock 完成后立即锁定且不发布过期的 unlocked UI state。
- Scene 失活、最后窗口关闭和 application termination 必须锁定并销毁 handle。
- 本切片只显示 lifecycle state，不包含演示数据或尚未迁移的 item UI。

## Verification

- Rust contract tests 覆盖 create→lock→unlock、错误密码、重复 lock/destroy、ABI
  mismatch、null/invalid argument、I/O failure 和 failure out-handle。
- Swift contract probe 必须经过同一 header/static library 执行 create/status/lock/
  wrong-password/unlock/destroy。
- `CT-NATIVE-RESPONSIVENESS-001` 必须在 Debug KDF 运行时验证 MainActor heartbeat
  不被阻塞，并验证 worker 返回的 lifecycle state。
- `xcodebuild` 必须在完整 Xcode/macOS SDK 上编译 app，产物必须通过 ad-hoc
  `codesign --verify`。交互式默认 create/unlock、错误密码和 lifecycle 验收记录为
  `AT-NATIVE-MACOS-001`；本切片的执行结果已记录为 `EVID-NDM-009` 并通过。
