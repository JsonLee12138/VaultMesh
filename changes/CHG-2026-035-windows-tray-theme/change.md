# Windows 托盘图标跟随系统明暗主题

## 问题或目标

Windows 当前固定显示黑色托盘 PNG，在深色任务栏上对比度不足；macOS 已通过模板图标由系统自动适配。本 Work 让 Windows 在启动和系统主题变化时选择可读的黑/白托盘图标。

## 预期行为

`REQ-TAURI-002`：Windows 启动时必须按当前用户的 Windows 系统明暗模式选择托盘图标；系统模式变化后必须在不重启应用的情况下更新。读取或监听失败不得阻止启动，并回退为深色任务栏可读的白色图标。

## 非目标

不改变 renderer 主题、应用图标、macOS 模板图标、Vault 状态或托盘菜单；本次不承诺跟随任务栏强调色生成彩色图标。

## 影响范围

仅影响 Windows Tauri Rust runtime 与托盘资源。无 Vault format、RPC/IPC/ABI、secret、extension、native host、迁移或生产依赖变化；Windows packaged 动态切换需目标机验收。

## 实现约束

Rust runtime 是系统主题读取和托盘更新唯一 owner；renderer 不获得注册表或托盘 capability。监听线程只读取 `HKCU` 非秘密 personalization 值；未知值和 Win32 失败必须使用稳定回退并不得导致进程退出。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| `TASK-035-01` | `REQ-TAURI-002` | 黑/白 Windows 托盘资源与纯函数主题选择 | `CT-TAURI-TRAY-THEME-001` | Pass |
| `TASK-035-02` | `REQ-TAURI-002` | 启动读取、注册表变更监听与 `set_icon` 更新 | `CT-TAURI-TRAY-THEME-001` | Pass |
| `TASK-035-03` | `REQ-TAURI-002` | Windows packaged 明暗切换及失败回退 | `AT-TAURI-WINDOWS-003` | Pending |

## 验收与证据

- CT 必须证明 light→黑、dark/unknown/error→白的确定性选择，资源尺寸与解码有效，并保持 macOS 36px 模板路径。
- AT 必须在 packaged Windows 上验证启动时 light/dark、运行中双向切换、Explorer/应用重启和无效读取回退；目标机证据完成前不得进入 Verified。

## 实现与验证证据

- `apps/tauri-desktop/resources/tray-icon-windows-light.png` 与
  `tray-icon-windows-dark.png` 均为 32×32 RGBA，复用已确认的保险柜正面轮廓；light 为黑色、dark 为白色。
- Rust runtime 读取当前用户 `SystemUsesLightTheme`，以同步 registry change notification 驱动
  Tauri tray `set_icon`；缺失、未知值、读取或监听失败均保持白色安全回退，且不向 renderer 暴露 capability。
- `cargo test --manifest-path apps/tauri-desktop/src-tauri/Cargo.toml --lib`：220 passed、0 failed、
  1 ignored；覆盖 `CT-TAURI-TRAY-THEME-001` 与 macOS 36×36 Retina 模板回归。
- 本变化纳入 `0.0.3-review` hosted 三平台 package 候选；`pnpm scripts:test`（78/78）、
  `pnpm tauri:typecheck`、`pnpm docs:check`、workflow YAML parse 与 `git diff --check` Pass；Windows
  packaged 动态主题 `AT-TAURI-WINDOWS-003` 仍 Pending，因此 Work 保持 Implementing。
- 独立最小 `x86_64-pc-windows-msvc` 类型检查已通过 Win32 registry API 与 Tauri tray 更新调用；完整应用在
  macOS 交叉检查时被既有 vendored OpenSSL/AWS-LC/ring 所需 Windows C SDK/toolchain 阻止，必须由目标 Windows
  build 与 `AT-TAURI-WINDOWS-003` 完成最终验证。
- GitHub Actions run `31351302181` 的 `windows-2025` x64 原生编译发现私有 `platform` 子模块函数不能以
  `pub(crate)` 重新导出；双 macOS hosted jobs Pass，publisher 因 Windows 失败被跳过且未修改 R2。两个 Windows
  平台函数已直接提升为 crate 可见，并收窄非 Windows 的 `Image` import；修复后桌面端 220 tests Pass、1 ignored，
  workspace `cargo check`、`pnpm scripts:test`（78/78）、`pnpm docs:check` 与 `git diff --check` Pass，Windows hosted
  复跑与 packaged 动态切换 AT 仍 Pending。

## 安全与数据生命周期

只读取当前用户的非秘密系统主题 DWORD；不记录、不持久化、不发送 renderer，不影响 Vault、clipboard、crash data 或 backup。

## 兼容与迁移

无。Vault format、settings、pairing、RPC、IPC、ABI、安装和回滚语义不变；移除本变化即可恢复固定图标。

## Bug 根因（仅 type=bug）

N/A。
