# 桌面端登录时静默启动

## 问题或目标

VaultMesh 已支持关闭主窗口后常驻托盘，但没有注册 macOS 登录项或 Windows 开机启动项，重启设备后桌面 runtime 与托盘不会自动可用。目标是提供默认启用且用户可关闭的登录时启动能力。

## 预期行为

- `REQ-DESKTOP-001`：首次运行默认注册当前打包应用为登录项；由登录项启动时保持 Vault 锁定，只显示托盘，不弹出或聚焦主窗口。
- 用户手动启动应用时继续正常显示主窗口；设置页显示系统当前真实注册状态，并允许启用或关闭。
- 用户关闭后，后续手动启动不得擅自重新注册；系统注册失败不得阻止 VaultMesh 正常启动，并可从设置页重试。

## 非目标

不实现开机自动解锁、后台保存秘密、Linux 启动项、登录后自动显示主窗口或操作系统级后台服务。

## 影响范围

影响 Tauri macOS/Windows runtime、桌面 typed adapter、设置 UI、打包依赖与平台验收。Browser RPC、extension/native host wire contract、Vault core、Vault format、加密、邮件、SSH 和 Passkey 无变化。

## 实现约束

Rust runtime 独占系统登录项操作；renderer 只能通过穷举 typed operation 读取和更新布尔状态，不获得 autostart 插件 capability。登录项参数固定为 `--autostart`，不能由 renderer 提供。首次默认注册与用户显式选择使用非秘密初始化标记区分；外部系统设置改变后，UI 必须以系统真实状态为准。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| `TASK-STARTUP-SPEC` | `REQ-DESKTOP-001` | Scope、Requirement、测试计划与追踪一致 | `CT-DESKTOP-STARTUP-001` | Complete |
| `TASK-STARTUP-RUNTIME` | `REQ-DESKTOP-001` | Rust 注册、初始化标记、固定参数和静默启动路径 | `CT-DESKTOP-STARTUP-001` | Complete |
| `TASK-STARTUP-UI` | `REQ-DESKTOP-001` | 设置页读取真实状态并可启停 | `CT-DESKTOP-STARTUP-001` | Complete |
| `TASK-STARTUP-AT` | `REQ-DESKTOP-001` | 打包应用登录项与静默托盘验收 | `AT-DESKTOP-STARTUP-MACOS-001`、`AT-DESKTOP-STARTUP-WINDOWS-001` | Pending |

## 验收与证据

- 自动化覆盖首次默认注册、已初始化后不强制重开、固定 `--autostart` 参数、手动/登录项启动窗口差异、typed adapter、设置 UI 与 renderer 无直接插件权限。
- macOS 与 Windows packaged app 分别验证启用、重启登录、静默托盘、保持锁定、显示主窗口、关闭后不再启动及重新启用。
- 实现完成后在本节记录命令与结果；平台 AT 未执行前不得标记 Verified。

2026-07-25 自动化证据：

- `pnpm docs:check`：Pass（66 Markdown、36 YAML、31 Requirement、74 Test ID、23 routed Changes）。
- `pnpm tauri:typecheck`：Pass。
- `pnpm tauri:test`：Rust 75 Pass、1 ignored（需要本机 OpenSSH daemon）；renderer/shared 18 files、77 Pass。
- `cargo fmt --all -- --check`、`cargo clippy -p vaultmesh-tauri-desktop --all-targets -- -D warnings`：Pass。
- `pnpm verify:tauri-source`：`CT-TAURI-SOURCE-001` Pass；typed adapter/dispatcher parity 为 114/114。
- `pnpm tauri:build`：Pass，生成 `VaultMesh.app` 与 `VaultMesh_0.1.0_x64.dmg`；`hdiutil verify` Pass，DMG SHA-256 为 `741a0ae37cb2c932b1ef430256cf898d30ebd13ab63b001fa5a918aa15888b96`。
- macOS 构建未签名，且未启动打包应用修改当前用户登录项；macOS/Windows 真实登录、关闭、重新启用和卸载清理 AT 均为 Not Run，因此 Change 保持 Implementing。

## 安全与数据生命周期

启动项不包含 Vault path、密码、Vault Key、受保护字段或 pairing secret。初始化标记只表示默认注册策略已处理；Vault 在登录项启动后保持锁定，renderer 未显示时不获得解密数据。

## 兼容与迁移

Vault format、payload、Browser RPC、native ABI 和 extension storage 无变化。升级后首次运行尝试默认注册；注册失败保留可重试状态且不阻止应用使用。降级版本忽略初始化标记，操作系统启动项可由系统设置移除。关闭开关会立即移除当前注册；通用 macOS DMG 拖拽删除没有应用卸载回调，卸载残留清理必须继续由平台打包 AT 验证并在发布前补齐或明确补偿步骤。

## Bug 根因（仅 type=bug）

N/A。
