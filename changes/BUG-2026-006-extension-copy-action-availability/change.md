# 扩展仅显示已有登录字段的复制操作

## 问题或目标

最小复现：在 Chromium 扩展中解锁 Vault，打开一条缺少用户名、密码或 TOTP 验证器密钥的 Login 的复制菜单。

- Expected：复制菜单只显示该 Login 实际拥有的用户名、密码和验证码操作；三项均不存在时不显示复制入口。
- Actual：每条普通 Login 都固定显示“用户名 / 密码 / 验证码”，点击不存在的值后才失败。
- 影响版本与 surface：`0.1.0-development` Chromium extension popup；Tauri broker 向 popup 提供摘要。

## 预期行为

- 符合 `REQ-ITEM-001`：Login 的受控复制入口必须与实际可复制字段一致。
- 非空用户名才显示“用户名”，存在密码才显示“密码”，存在 TOTP 密钥才显示“验证码”。
- 三项均不存在的 Login 和 Passkey-only Login 都不得显示复制入口。

## 非目标

- 不改变复制操作的用户手势、主密码 re-prompt 或剪贴板清理策略。
- 不改变支付卡、SSH、Identity、Secret 的复制菜单。
- 不返回密码、TOTP seed 或其他受保护值。

## 影响范围

- Core Login 安全摘要、Tauri-owned 共享合约/browser runtime JSON、extension RPC schema、popup copy menu 和自动化测试。
- Vault format/payload、Browser RPC operation/version、IPC channel、ABI、email、SSH、Passkey 与发布平台范围无变化。

## 实现约束

- `hasPassword` 只能表达密码是否存在，不得包含或推导密码内容。
- 用户名存在性使用已获授权的现有安全摘要字段；空字符串或纯空白视为不存在。
- Tauri 必须输出 camelCase `hasPassword` 字段，extension schema 必须拒绝缺失或类型错误的摘要。
- 锁定、断开、取消、重复、过期与恢复路径沿用现有行为，本修复不新增状态。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| BUG-006-REPRO | REQ-ITEM-001 | 缺失字段仍出现复制操作的失败回归测试 | CT-ITEM-001 | Done |
| BUG-006-SUMMARY | REQ-ITEM-001 | core/Tauri 输出安全 `hasPassword` 元数据 | CT-ITEM-001 | Done |
| BUG-006-POPUP | REQ-ITEM-001 | popup 按用户名、密码、TOTP 实际存在性过滤菜单 | CT-ITEM-001 | Done |
| BUG-006-VERIFY | REQ-ITEM-001 | core/extension/Tauri 适用自动化与 build 证据 | CT-ITEM-001 | Done |

## 验收与证据

- 修复前：`login-copy-options.test.ts` 因不存在按字段存在性计算菜单的实现而失败；同次运行其余 24 files / 153 tests 通过。
- 修复后：`login-copy-options.test.ts` 覆盖用户名、密码、TOTP 单独与组合缺失、纯空白用户名和三项全空；`desktop-rpc.test.ts` 验证 `hasPassword` 为必需布尔元数据且响应不含 `password` 值。
- `pnpm extension:test`：25 files / 161 tests passed；`pnpm extension:typecheck` 通过；`pnpm extension:build` Chrome MV3 production build 通过，仅保留既有 chunk-size warning。
- `pnpm electron:typecheck` 通过；`pnpm electron:test`：35 files / 174 tests passed；`pnpm verify:browser-parity`：2 files / 6 tests passed。
- `cargo test -p vaultmesh-core -p vaultmesh-electron-bridge -p vaultmesh-ffi -p vaultmesh-tauri-desktop` 在并行 `CHG-2026-007` 写入前通过：core 24、bridge 5、FFI 26、Tauri 30 tests 及 doc-tests 全部通过。
- `CHG-2026-008` 完成后的当前工作区重新执行 Rust core 25、FFI 25、Tauri 30 tests，Tauri renderer/shared 52 tests、Browser parity 6 tests 和 extension 161 tests 全部通过，确认当前 `hasPassword` core/Tauri 路径。
- `pnpm docs:check`：43 Markdown、14 YAML、26 requirements、64 test IDs、5 ADRs，通过。
- 适用平台：共享 Chromium extension popup 自动化；无需真实密码或 Vault fixture。

## 安全与数据生命周期

密码和 TOTP seed 仍只存在于加密 payload 和既有有界特权复制操作中。新增 `hasPassword` 与既有 `hasTotpSecret` 相同，只是 renderer-safe presence metadata；不进入 extension storage、日志、analytics、crash data 或剪贴板。

## 兼容与迁移

无 Vault format/payload、RPC version、ABI、settings 或 pairing 迁移。Tauri 与 extension 必须同时更新；回滚恢复旧的固定菜单行为，不改变已存 Vault。

## Bug 根因（仅 type=bug）

Popup 的 `copyOptions` 只接收 item type，并为全部 Login 固定返回三个操作；现有 Login summary 虽有用户名和 `hasTotpSecret`，却没有密码存在性元数据。既有测试覆盖 RPC 安全与复制路由，但没有覆盖菜单动作可用性。修复版本待 Release 确定。
