# 修复 Tauri 2 导入未调起系统文件选择器

- Work ID：`BUG-2026-004-tauri-import-dialog`
- 类型：Bug
- 状态：Implementing
- 关联：`REQ-IMPORT-001`、`REQ-TAURI-001`、`NFR-REL-001`、`NFR-PRIV-001`

## 问题或目标

在 macOS Tauri 2 客户端解锁 Vault 后进入设置，选择任一导入来源并点击选择文件。
Expected：由 Rust 特权 runtime 调起系统文件选择器，取消返回空结果，选择支持的导出文件后
返回不含秘密的预览。Actual：renderer 发出 `imports.select` 后，Rust dispatcher 进入未知操作
拒绝分支并弹出“该 Tauri 特权操作尚未迁移或不被允许”，访达文件选择器未出现。

## 预期行为

- `REQ-IMPORT-001`：Tauri Rust runtime 必须发起文件选择、限制文件类型和大小，并仅向 renderer
  返回安全预览与 opaque session ID。
- `REQ-TAURI-001`：`imports.select`、`imports.commit`、`imports.cancel` 必须通过 typed adapter
  完成，不依赖 Electron、Node sidecar 或 renderer filesystem/dialog 权限。
- `NFR-REL-001`：提交使用 core 的单次 commit-before-publish transaction；失败不得留下部分导入。
- `NFR-PRIV-001`：导入文件内容只存在于有界 Rust 内存 session，取消、过期、锁定和成功提交后清理。

## 非目标

- 不改变支持的导入来源、Vault format、Browser RPC 或现有 React 导入 UI。
- 不实现 TDM-040 中与本缺陷无关的 quick unlock、SSH scan 或 email 能力。

## 影响范围

Tauri Rust dispatcher、系统文件对话框、导入解析/临时 session、core batch mutation 和对应
contract test。Electron reference、extension、native host、IPC/RPC/ABI、格式和发布身份无变化。

## 实现约束

- 文件路径和原始内容不得返回 renderer 或写入日志/settings。
- 文件必须是普通文件且不超过 10 MiB；Bitwarden 可以选择 CSV/JSON，其余来源只选择 CSV。
- session 最长 10 分钟；取消/锁定/过期幂等清理；失效 session 提交必须拒绝。
- commit 必须先从 pending map 取出 payload，再通过 core `_native.import.batch` 单事务提交。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| BUG-TID-010 | REQ-IMPORT-001、REQ-TAURI-001 | 修复前 dispatcher 拒绝 `imports.select` 的回归测试 | CT-TAURI-DESKTOP-001 | Done |
| BUG-TID-020 | REQ-IMPORT-001、NFR-PRIV-001 | Rust 文件选择、安全预览、取消/过期/锁定清理 | CT-TAURI-DESKTOP-001 | Done |
| BUG-TID-030 | NFR-REL-001 | core batch 原子提交与重复提交拒绝 | CT-TAURI-DESKTOP-001 | Done |
| BUG-TID-040 | REQ-TAURI-001 | macOS 系统文件选择器人工验收 | AT-TAURI-MACOS-001 | Not Run |

## 验收与证据

自动化必须覆盖 CSV/Bitwarden JSON 安全预览、文件限制、取消、过期、锁定清理、单次提交和
重复提交拒绝。macOS 平台验收需在真实 Tauri app 中确认点击导入会打开系统文件选择器。

| Evidence ID | 日期 | 范围 | 证据 | 结果 |
| --- | --- | --- | --- | --- |
| EVID-TID-001 | 2026-07-22 | BUG-TID-010..030；macOS 14.8.7 x86_64 | `cargo test -p vaultmesh-tauri-desktop` = 7 tests；`cargo clippy -p vaultmesh-tauri-desktop --all-targets --no-deps -- -D warnings`；`pnpm tauri:typecheck`；Tauri adapter 2 tests；`pnpm tauri:build` 生成 `.app`/`.dmg`；`pnpm docs:check` = 39 Markdown/10 YAML | CT Pass；真实文件选择器 `AT-TAURI-MACOS-001` Not Run，因此 Work 保持 Implementing |

## 安全与数据生命周期

renderer 只接收来源、文件名、计数、非秘密标题/副标题和随机 session ID。原始导出内容由
Rust `Zeroizing<String>` 持有，不进入持久化、日志或 crash message；terminal path 清除 session。

## 兼容与迁移

Vault format 1、Browser RPC 2、Native ABI 1、settings、pairing、upgrade/downgrade 均无变化。

## Bug 根因

Tauri typed adapter 已映射 `imports.select/commit/cancel`，但 Rust `desktop_invoke` match 未实现
这些 operation；现有 CT 只验证 adapter 映射和 Vault lifecycle，未覆盖导入 dispatcher，因此
缺陷未被发现。修复加入 Rust-owned dispatcher、系统 dialog、安全预览 session、过期/锁定清理
和 core batch transaction 回归测试。受影响版本为 `0.1.0-development` 的 Tauri preview；修复
版本尚未发布。
