# 桌面窗口内容捕获保护

## 问题或目标

Tauri 主窗口当前未设置 `contentProtected`，常规截屏和录屏可以直接包含窗口内容。用户已在
2026-07-24 接受按平台能力提供保护：Windows 使用系统公开的窗口捕获排除能力；macOS 启用
Tauri/AppKit 可用提示作为纵深防御，但不承诺平台无法兑现的通用截屏阻断。

## 预期行为

- `REQ-SEC-003`：每个 VaultMesh 自有 Tauri 产品窗口必须从创建起请求平台内容捕获保护，且
  renderer 不得获得关闭保护的 capability。
- Windows 10 2004+ 的 packaged app 必须通过平台验收，证明主窗口从受支持的公共系统截屏/
  录屏路径排除；该能力不是 DRM，也不覆盖被攻陷 OS、非公开捕获路径或外部相机。
- macOS 必须启用 Tauri/AppKit 当前可用的保护提示；由于 Apple 已把对应 AppKit sharing type
  定义为 legacy 且不再用于通用捕获阻断，macOS 只作尽力防护，不以“无法截屏”作为承诺。
- 内容保护在锁定和解锁状态均保持开启，不替代失焦锁定、敏感值最小展示和 secret lifecycle。

## 非目标

不拦截全局快捷键，不申请 Accessibility/Screen Recording 权限，不使用私有 API，不检测或
对抗外部相机、已被攻陷的 OS/process，也不改变 browser extension 或网页内容的捕获行为。

## 影响范围

影响 Tauri desktop window 配置、安全主规格、自动化配置合约及 macOS/Windows packaged AT。
不影响 extension、native host、vault-core、Vault format、RPC/IPC/ABI、持久化、迁移或生产依赖。

## 实现约束

保护必须由 Rust/Tauri shell 在窗口创建时拥有，不能依赖 renderer 启动后的异步调用；main
capability 必须继续不授予 `core:window:allow-set-content-protected`。未来新增产品窗口时必须
继承同一要求。平台 API 的能力边界必须保留在主规格和验收中，不能把 best-effort 描述为绝对
安全保证。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| `CAPTURE-001` | `REQ-SEC-003` | 主规格、范围、测试与追踪拥有最终行为 | `CT-SEC-003` | Completed |
| `CAPTURE-002` | `REQ-SEC-003` | 所有 Tauri 产品窗口从创建起启用内容保护且 renderer 不可关闭 | `CT-SEC-003` | Completed |
| `CAPTURE-003` | `REQ-SEC-003` | macOS packaged app 记录尽力防护的实际捕获结果 | `AT-TAURI-MACOS-002` | Pending |
| `CAPTURE-004` | `REQ-SEC-003` | Windows 10 2004+ packaged app 从公共系统捕获路径排除 | `AT-TAURI-WINDOWS-002` | Pending |

## 验收与证据

- 自动化必须解析 Tauri 配置并证明所有声明产品窗口设置 `contentProtected: true`。
- 自动化必须证明 main capability 未授权 renderer 调用 `set_content_protected`。
- macOS/Windows 必须使用 packaged app 执行系统截图和系统录屏验收，分别记录 OS/build/结果；
  macOS 失败不会被误报为已保证阻断，Windows AT 未通过则不得标记 Verified。
- 2026-07-24 `pnpm docs:check`：通过（65 Markdown、35 YAML、30 requirements、71 test IDs、
  6 ADR、22 routed Changes）。
- 2026-07-24 `cargo fmt --all -- --check`：通过。
- 2026-07-24 `cargo test -p vaultmesh-tauri-desktop`：通过（56 Rust tests，包含
  `CT-SEC-003` 的窗口配置与 capability 回归）。
- 2026-07-24 `pnpm tauri:typecheck`：通过。
- 2026-07-24 `pnpm tauri:test`：通过（56 Rust tests；16 renderer/shared files、65 tests）。
- 2026-07-24 `pnpm tauri:build`：通过，生成 macOS `VaultMesh.app` 与 x64 DMG。
- `AT-TAURI-MACOS-002`、`AT-TAURI-WINDOWS-002`：Not Run；packaged system capture AT
  仍阻止本 Change 进入 Verified。

## 安全与数据生命周期

窗口保护不读取、复制、持久化或记录任何 secret。它只改变 OS compositor/capture 对窗口的处理，
不建立新的 renderer 或 IPC 权限，也不替代锁定和最小披露。

## 兼容与迁移

Vault format、payload、RPC/IPC/ABI、settings、pairing、upgrade 和 downgrade 均无变化。配置回滚
只需移除窗口保护标志；不会改变用户数据。旧 Windows 对排除值的降级行为和现代 macOS 的平台
限制由目标平台 AT 记录。

## Bug 根因（仅 type=bug）

N/A；这是新增的已接受安全行为，不是既有 Requirement 的实现偏离。
