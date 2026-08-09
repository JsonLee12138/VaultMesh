# 移除 Electron 与已停止的原生客户端源码

- Work ID：`CHG-2026-008-electron-native-source-removal`
- 类型：Migration
- 状态：Implementing
- 主 Requirement：`REQ-TAURI-002`
- 决策：`ADR-0006`

## 问题或目标

Tauri 已成为默认桌面入口并完成本机 macOS replacement。用户于 2026-07-23 明确要求删除
已停止的 SwiftUI/AppKit、WinUI 开发目录和旧 Electron 源码，并确认接受覆盖原先等待完整
平台 Gate 后再删除 reference source 的顺序。

Electron 目录仍拥有 Tauri 正在复用的 React renderer、typed API/contracts、测试和图标，不能
整目录直接删除。本 Change 先把这些当前产品资产迁入 Tauri owner，再删除 Electron-only 和
Native Preview 源码、workspace 成员、脚本及依赖。

## 预期行为

- `REQ-TAURI-002`：仓库中的 macOS/Windows 桌面产品源码只能由 Tauri 2 拥有；不得保留
  Electron main/preload/N-API 或 SwiftUI/WinUI presentation 构建入口。
- Tauri build、typed adapter、renderer tests 和 Browser RPC parity 不得依赖已删除路径。
- 删除只作用于仓库源码和构建产物，不删除 Electron/Tauri user-data、Vault、迁移 receipt、
  backup、browser credential 或系统安装数据。
- 源码移除不把尚未执行的 Windows、真实 Chromium、签名、upgrade/rollback AT 标记为通过。

## 非目标

- 不改变 Vault format 1、Browser RPC 2、KDF、payload 或扩展信任模型。
- 不删除 `vault-ffi`；Tauri Rust runtime 当前仍将其作为共享 Rust operation/runtime crate 使用。
- 不删除本机旧 Electron 加密数据目录或迁移 receipt。
- 不宣称本 Change 完成正式发布门禁。

## 影响范围

| Surface | 影响 |
| --- | --- |
| Tauri | 接管 renderer、typed contracts、UI tests 和 product assets |
| Electron | 删除 app、N-API bridge、CLI、Forge/IPC/main/preload/test/build 和旧 Node host 入口 |
| Native UI | 删除 `apps/macos`、`apps/windows`、`apps/macos-cli` 与专属脚本 |
| Rust | workspace 移除 `electron-bridge`、`desktop-cli`；保留 core、FFI 和 Tauri runtime |
| Browser | parity owner 路径迁到 Tauri shared；extension wire/RPC 版本不变 |
| Data | Vault、user-data、credential、receipt 和备份均不删除 |
| Release | 未完成 AT 继续保持 Not Run，Change 不因源码删除自动 Verified |

## 实现约束

- 必须先迁移并通过 Tauri typecheck/build/test，再删除旧 owner。
- renderer 继续无 Node/filesystem/generic invoke；typed API 和 Rust dispatcher 约束不变。
- Browser operation/schema/policy 只能迁移所有权位置，不能缩减 route 或测试断言。
- 历史 Change 和 ADR 保留；当前主规格、路径索引和 Traceability 必须指向新 owner。
- 删除目标必须是已确认的仓库路径，不使用用户主目录或应用数据路径作为递归删除目标。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| ESR-010 | REQ-TAURI-002 | Change、Requirement、Scope、Spec、ADR、Traceability 进入 Implementing | `pnpm docs:check` | Done |
| ESR-020 | REQ-TAURI-002 | renderer/contracts/tests/assets 迁入 Tauri owner | CT-TAURI-SHELL-001、CT-TAURI-DESKTOP-001 | Done |
| ESR-030 | REQ-TAURI-002 | 删除 Electron/Native roots、旧 Node host、workspace、脚本和依赖引用 | CT-TAURI-SOURCE-001 | Done |
| ESR-040 | REQ-TAURI-002、NFR-COMPAT-001 | Tauri/Rust/extension/Rust host/browser parity 回归 | CT-TAURI-COMMAND-001、CT-TAURI-BROWSER-001 | Done（automated） |
| ESR-050 | REQ-TAURI-002 | 删除误导命令；本地 package/launch/host 脚本只使用 Tauri owner 且不读取用户 Vault | CT-TAURI-SOURCE-001 | Done |

## 验收与证据

- `CT-TAURI-SOURCE-001` 由 `pnpm verify:tauri-source` 验证确认目录不存在、workspace/lockfile 无 Electron package/N-API
  owner，并且 Tauri 不引用 `apps/desktop`、`apps/macos` 或 `apps/windows`。
- 必须执行 docs check、Tauri typecheck/test/production WebView build、适用 Rust test/clippy、
  extension test/typecheck/build、Rust native-host test 和 Browser RPC parity。
- 平台 AT 未完成时保持 Change 为 Implementing，不得标记 Verified。

| Evidence ID | 日期 | 范围 | 证据 | 结果 |
| --- | --- | --- | --- | --- |
| EVID-ESR-001 | 2026-07-23 | ESR-010..040；macOS 14.8.7 x86_64 | `pnpm verify:tauri-source`：7 个旧 root removed、7 个 Tauri owner located；`pnpm docs:check`：46 Markdown/16 YAML/27 requirements/65 tests/6 ADR；Tauri renderer/shared 14 files/52 tests、Browser parity 2 files/6 tests、typecheck 与 production WebView build Pass；extension 25 files/161 tests、typecheck/build Pass；Rust core 25、FFI 25、Tauri 30 tests，fmt 与 Clippy `-D warnings` Pass；完整 `pnpm tauri:build` 生成 `.app` 与 x64 `.dmg` | `CT-TAURI-SOURCE-001` 与适用自动化 Pass；Windows、真实 Chromium、签名/upgrade/rollback AT Not Run，Change 保持 Implementing |
| EVID-ESR-002 | 2026-07-23 | ESR-050 command/script cleanup；macOS 14.8.7 x86_64 | 删除 `desktop:make`、伪 local uninstall、`native:ffi:*` 等旧入口；FFI 命令改为 `ffi:*`；本地 package 脚本移除 Electron Vault 强制访问/摘要比对和 replacement 文案；CI workflow 改名并增加 Tauri source/typecheck gate。全部脚本 `node --check` Pass；`pnpm verify:tauri-source` 验证 13 个旧命令 retired；docs check、FFI check、Tauri/extension typecheck 与 Browser parity 6/6 Pass | Command/script owner cleanup Pass；本轮未执行会覆盖 `/Applications/VaultMesh.app` 的本地安装命令 |

## 安全与数据生命周期

本 Change 不读取、复制或删除任何用户 Vault、主密码、Vault Key、pairing secret、quick-unlock
wrapper 或 provider token。删除仅限仓库源码。Tauri 的 secret owner、最小 DTO、final-lock cleanup
和原子持久化规则保持不变。

## 兼容与迁移

Vault format 1、Browser RPC 2 和扩展 wire contract 不变。源码级 Electron/Native 回退在本 Change
后不可用；历史设计与测试证据保留在 Rejected Change/ADR 文档中。旧 Electron 加密 user-data
继续保留，直到未来 Release 定义的回滚窗口和平台 AT 允许单独删除。
