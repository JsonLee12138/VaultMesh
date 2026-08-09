# 原生文件对话框误触发失焦锁定

## 问题或目标

在启用失焦锁定并解锁 Vault 后，从导入页打开系统文件选择器。预期 VaultMesh 发起的受信任模态对话框保持当前授权，以便选择文件并建立有界 import session；实际主窗口收到 `Focused(false)` 后立即锁定，导入随即失败。`BUG-2026-012` 恢复了普通失焦锁定，但未区分应用拥有的原生对话框。

## 预期行为

`REQ-VAULT-001`、`REQ-SEC-002` 与 `REQ-IMPORT-001` 的既有行为不变：VaultMesh 自己打开的文件/确认对话框存续期间不得触发主窗口失焦锁定；对话框外切换到其他应用仍必须锁定。选择、取消和重复打开均须恢复普通失焦策略。

## 非目标

不放宽普通窗口失焦，不改变导入格式、文件大小、临时 session、Vault format、RPC/ABI 或安全设置 schema。

## 影响范围

影响 Tauri desktop runtime 的原生对话框生命周期、窗口失焦判定，以及 desktop/browser platform 发起的文件和确认对话框。核心加密、持久化格式、renderer API 和 extension wire contract 不变。

## 实现约束

原生对话框抑制必须是进程内、引用计数且通过 RAII 在成功、取消和错误路径自动释放；只抑制对话框导致的主窗口失焦，不得成为持久授权或 secret 状态。普通失焦锁定仍复用 runtime、剪贴板、import 与 renderer 通知清理。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| `BUG-013-REPRO` | `REQ-SEC-002`, `REQ-IMPORT-001` | 原生对话框活动时失焦回归测试修复前失败 | `CT-SEC-002` | Done |
| `BUG-013-GUARD` | `REQ-VAULT-001`, `REQ-IMPORT-001` | 所有 Tauri-owned modal dialog 使用共享 RAII focus guard | `CT-IMPORT-001`, `CT-TAURI-DESKTOP-001` | Done |
| `BUG-013-VERIFY` | `REQ-SEC-002` | Rust、Tauri、文档与构建门禁通过 | `CT-SEC-002`, `CT-TAURI-DESKTOP-001` | Done |

## 验收与证据

- 自动化覆盖普通失焦锁定、对话框活动时抑制、设置关闭、非主窗口和重复锁定。
- 导入选择/取消必须自动释放 guard；备份、恢复和确认对话框使用同一生命周期机制。
- 修复前：新增 native-dialog-active 分支后运行定向 Rust 测试，因失焦函数缺少对话框生命周期输入产生 `E0061`，证明原判定不能区分 Finder 文件选择器。
- 修复后：定向失焦测试与嵌套 RAII 生命周期测试通过；Tauri Rust `34 passed`；TypeScript typecheck 与 Vitest `14 files / 53 tests passed`；`cargo fmt --all -- --check`、`pnpm docs:check` 通过。
- macOS x64 的 `pnpm tauri:build` 通过并生成 `.app` 与 `.dmg`。packaged 导入交互与 Windows AT 仍由发布 Gate 承担。

## 安全与数据生命周期

guard 只保存活动原生对话框计数，不保存文件路径、文件内容、Vault Key 或授权 token。对话框之外的失焦仍清除解密 session、敏感剪贴板引用和 import 临时状态。

## 兼容与迁移

无。settings、Vault format、RPC/IPC/ABI、升级和回滚均不变。

## Bug 根因（仅 type=bug）

根因是失焦事件只有窗口 label、焦点和 `lockOnBlur` 三个判定条件，缺少“当前是否存在 VaultMesh-owned native modal dialog”的生命周期信号，导致 Finder 文件选择器被误判为离开应用。修复增加进程内引用计数 RAII guard，覆盖 desktop/browser 发起的导入、备份、恢复、Passkey 与填充确认对话框；guard 只在阻塞对话框调用期间存续，并在成功、取消或错误路径自动释放。修复版本为下一次 `0.1.0-development` 构建。
