# 退休未交付的 vault-ffi C ABI

## 问题或目标

`vault-ffi` 在 Tauri-only 桌面运行时下仍携带为已停止的 SwiftUI/AppKit 和 WinUI 客户端准备的 C ABI v1：header、`staticlib`/`cdylib` 工件、raw pointer/buffer 入口与专属测试。当前 Tauri 只以 Rust crate 使用 `DesktopRuntime`；仓库、打包脚本和发布记录均无 C ABI consumer。

## 预期行为

- `REQ-TAURI-002`：Tauri 继续是唯一 desktop runtime owner；`DesktopRuntime` 保持其现有 Rust API、原子持久化、锁定和受保护值边界。
- `NFR-COMPAT-001`：Vault format 3 与 Browser RPC 的版本拒绝行为不变；C ABI v1 不再是支持或发布的兼容契约。

## 非目标

- 不删除 `vault-ffi` crate，不重写 Tauri Rust runtime，不改变 Vault format、RPC/IPC、settings、pairing、用户数据或历史 Electron migration。
- 不修改已封存的历史 Change/ADR；历史 Native Preview 证据继续只读保留。

## 影响范围

删除 C ABI 公开入口、C header、C artifact crate type 和专属 ABI contract tests；把 Tauri source-ownership gate 扩展为拒绝这些残留。直接删除无消费者的 extension Alert 组件和未索引设计 QA 工件，二者不构成 C ABI 兼容变更。

## 实现约束

保留 Rust runtime 所需的 session、operation dispatch、状态映射、原子文件写入和受保护值 helper。不得削弱 zeroization、fail-closed 错误映射、锁定清理或现有 Rust runtime coverage。`CT-TAURI-SOURCE-002` 必须证明仓库不再声明、构建或文档化 C ABI。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| TASK-039-01 | REQ-TAURI-002 | 删除 C ABI v1 的入口、header、artifact type 与专属测试，同时保留 Rust runtime | CT-TAURI-SOURCE-002 | Completed |
| TASK-039-02 | NFR-COMPAT-001 | 当前规格和 Traceability 只拥有存续的 format/RPC compatibility contract | CT-TAURI-SOURCE-002 | Completed |
| TASK-039-03 | N/A | 删除无消费者 Alert 与孤立设计 QA 工件 | extension typecheck/test | Completed |

## 验收与证据

- Residue search 不得保留 C ABI header、`extern "C"` export、`staticlib`/`cdylib` 或 `CT-NATIVE-ABI-001` current-source owner。
- `cargo fmt --all -- --check`、`cargo test -p vaultmesh-ffi`、Tauri source-ownership check、extension typecheck/test 和 docs check 通过。
- 不要求平台 package AT：本次不改变 Tauri package 可观察行为或持久化格式。

- 2026-09-02：`cargo fmt --all -- --check` 通过；`cargo test -p vaultmesh-ffi` 通过（23 passed）。
- 2026-09-02：`cargo test -p vaultmesh-tauri-desktop` 通过（224 passed，1 ignored，忽略项需要本地 OpenSSH daemon）；native-host 测试通过（1 passed）。
- 2026-09-02：`node scripts/verify-tauri-source-ownership.mjs` 通过 `CT-TAURI-SOURCE-001` 和新增的 `CT-TAURI-SOURCE-002`。
- 2026-09-02：browser extension 的 `tsc --noEmit` 通过，`vitest run` 通过（240 passed）；`node --test scripts/*.test.mjs` 通过（103 passed）。
- 2026-09-02：`node scripts/docs-check.mjs` 通过。根目录 `pnpm` 在此主机因 `@pnpm/exe.darwin-x64` 原生二进制身份无法与 lockfile 校验而不可用，等价的本地 Node、Cargo 和包内工具已直接执行。

## 操作记录

- 删除了没有仓库或发布消费者的 ABI 1 header、C export、caller-owned buffer 路径和 FFI-only 测试；`DesktopRuntime`、Vault 格式、Tauri commands、Browser RPC 与 Agent IPC 保持不变。
- `vaultmesh-ffi` 现只构建 Rust 库；源码所有权校验会拒绝已退休 ABI 工件、`staticlib`/`cdylib` crate type 和 FFI crate 中的 `extern "C"`/`VaultmeshBytes` 残留。
- 清除了无 import 的 extension Alert 原语及根目录孤立的 Design QA 文档和两张截图。
- 风险边界：仓库与既有发布没有 C ABI 消费者；未来若引入外部 Swift/WinUI 原生客户端，必须先恢复或替换 ABI 并建立新的兼容性 Work。
- 回退：恢复本 Work 删除的路径并回滚相关文档与校验脚本即可；不涉及 Vault 数据、设置或任何持久化格式迁移。

## 安全与数据生命周期

删除 foreign pointer 和 caller-owned buffer 入口，缩小秘密跨边界面。存续的秘密仍由 Rust runtime/core 拥有；不增加日志、clipboard、crash、backup 或持久化状态。

## 兼容与迁移

不迁移 Vault payload、settings、RPC、IPC 或用户数据。C ABI v1 被有意退休；未来外部 native client 必须新建 Work 并重新定义受支持的桥接契约。
