# Tauri 窗口失焦未按策略锁定

## 问题或目标

在 `0.1.0-development` 的 Tauri 桌面端解锁 Vault，确认“失焦锁定”开启后切换到其他应用。预期主窗口失焦时立即锁定；实际 Vault 保持解锁。设置 schema、默认值和 UI 均存在，但 Tauri 窗口事件只处理 macOS 关闭隐藏，没有把失焦事件接入 Rust runtime 锁定路径。

## 预期行为

`REQ-VAULT-001` 与 `REQ-SEC-002` 的既有行为不变：主窗口在 `lockOnBlur=true` 时失去焦点必须锁定已解锁的 Vault；设置关闭、窗口获得焦点、非主窗口或已经锁定时不得产生额外锁定。

## 非目标

不改变空闲/休眠策略，不新增设置，不调整 Vault format、RPC、ABI、quick unlock 或剪贴板超时。

## 影响范围

只影响 Tauri desktop Rust runtime 的主窗口事件与锁定清理。Renderer、extension、native host、core format、公共 API/Schema、依赖和发布边界不变。

## 实现约束

窗口事件必须调用 Rust runtime 的真实锁定并沿用剪贴板、import 临时状态和 `vault-locked` 通知清理；设置读取失败时按默认安全策略锁定。重复失焦保持幂等，且不得阻塞 renderer 主线程上的 KDF/I/O。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| `BUG-012-REPRO` | `REQ-SEC-002` | 失焦锁定回归测试在修复前失败 | `CT-SEC-002` | Done |
| `BUG-012-RUNTIME` | `REQ-VAULT-001`, `REQ-SEC-002` | 主窗口 `Focused(false)` 接入 runtime 锁定与清理 | `CT-TAURI-DESKTOP-001` | Done |
| `BUG-012-VERIFY` | `REQ-SEC-002` | Rust 定向测试、Tauri 测试与文档检查通过 | `CT-SEC-002`, `CT-TAURI-DESKTOP-001` | Done |

## 验收与证据

- 自动化必须覆盖启用失焦锁定、禁用策略、获得焦点、非主窗口和重复锁定。
- 当前验证平台为 macOS 开发环境；packaged macOS/Windows 用户验收仍由现有 `AT-TAURI-*` Gate 承担。
- 修复前：`cargo test -p vaultmesh-tauri-desktop --lib window_blur_policy_locks_unlocked_runtime_and_respects_setting` 因缺少 `lock_runtime_on_window_blur` 产生 5 个 `E0425`，证明窗口失焦没有 runtime 锁定入口。
- 修复后：同一定向测试通过；`cargo fmt --all -- --check` 与 Tauri Rust `33 passed`；Tauri TypeScript typecheck 与 Vitest `14 files / 53 tests passed`；`pnpm docs:check` 通过。
- macOS x64 的 `pnpm tauri:build` 通过并生成 `.app` 与 `.dmg`。packaged 交互式 `AT-TAURI-MACOS-001` 和 Windows `AT-TAURI-WINDOWS-001` 未在本 Work 执行，继续由发布 Gate 承担。

## 安全与数据生命周期

窗口失焦不得让 Vault Key 或解密 session 留在 runtime；成功锁定后必须清理敏感剪贴板引用和 import 临时状态并通知 renderer。没有新增 secret、DTO、日志或持久化。

## 兼容与迁移

无。安全设置 JSON、Vault format、RPC/IPC/ABI 和升级/降级行为不变；回滚代码会重新暴露失焦不锁定缺陷，但不会改变持久化数据。

## Bug 根因（仅 type=bug）

根因是 `Builder::on_window_event` 没有处理 `WindowEvent::Focused(false)`，`SecuritySettings.lock_on_blur` 因此只有存储和展示消费者，没有 runtime 执行消费者。既有测试只覆盖 schema/default、显式锁定和空闲锁定，没有覆盖原生窗口失焦到 core session 清理的接线。修复后主窗口失焦在后台阻塞任务中锁定真实 runtime，并复用剪贴板/import/renderer 通知清理；回归测试从修复前失败转为修复后通过。修复版本为下一次 `0.1.0-development` 构建。
