# Passkey 按网站默认登录账号归属

## 问题或目标

Passkey 创建已把私钥保存为 protected Secret，但 `secrets.list` 未呈现 Passkey/关联 Login 的安全派生字段，导致 `AtlanKJ · GitHub` 等记录落入“密钥”。同时创建服务只按 WebAuthn 用户名唯一匹配 Login，没有消费扩展对当前 origin 记住的默认登录账号。

## 预期行为

`REQ-PASSKEY-001`：创建 Passkey 时，扩展可以提交当前 origin 已记住的默认 Login opaque ID；Tauri 必须重新确认该 Login 是当前 RP/origin 的候选后再写入 `login:<uuid>` scope。无有效默认值时保留唯一用户名匹配；仍无法确定时表示为 Passkey-only Login，不进入普通密钥列表。任何可用 Passkey 导入路径必须复用同一归属规则。

## 非目标

不新增外部密码管理器或平台 Passkey 私钥导入格式/入口，不改变 ES256 私钥所有权、WebAuthn 签名、确认或 Browser RPC 版本。

## 影响范围

涉及 extension 默认登录偏好、Browser RPC v2 的向后兼容可选输入、Tauri Passkey service、core renderer-safe Secret summary 和 desktop/extension 展示。Vault envelope/payload、Native ABI、Email/SSH 和发布平台范围不变。

## 实现约束

扩展提供的 Login ID 只是提示，不能作为授权结论；broker 必须使用当前 RP/origin 重新查询候选。过期、删除、跨站或畸形 ID 必须忽略并安全回退。Passkey 私钥不得进入 summary、RPC 日志、extension storage 或 renderer。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| CHG-013-T1 | REQ-PASSKEY-001 | core summary 派生 `isPasskey/loginId`，不暴露私钥 | CT-PASSKEY-001 | Done |
| CHG-013-T2 | REQ-PASSKEY-001 | 创建请求传递并由 broker 重验默认 Login | CT-PASSKEY-001, CT-BROWSER-002 | Done |
| CHG-013-T3 | REQ-PASSKEY-001 | desktop/extension 归类与 RPC parity 回归 | CT-NATIVE-BROWSER-001 | Done |

## 验收与证据

- 已有同 origin 默认 Login 时，新 Passkey 关联到该 Login 并只在登录信息下显示。
- 默认 ID 过期、删除或不属于当前 RP/origin 时不得跨站关联，并回退到唯一用户名匹配或 Passkey-only Login。
- 无默认 Login 的旧 extension 请求继续可用；重复 credential、取消、锁定和 WebAuthn 过期语义不变。
- 自动化覆盖 Rust service、extension proxy 和 Browser RPC parity；真实 Chromium/package 验收仍由 `AT-PASSKEY-001`。

验证证据（2026-07-23）：

- `cargo test -p vaultmesh-tauri-desktop passkey_service::tests --lib`：3 passed；覆盖默认 Login 优先、跨 origin hint 拒绝、用户名回退、持久化重开、counter 和私钥 redaction。
- `pnpm tauri:test`：Rust 32 passed；desktop Vitest 53 passed。
- `cargo check -p vaultmesh-core -p vaultmesh-ffi -p vaultmesh-tauri-desktop` 与 `cargo test -p vaultmesh-core -p vaultmesh-ffi`：通过。
- `pnpm extension:typecheck`、`pnpm extension:test`、`pnpm extension:build`：通过，extension Vitest 186 passed；覆盖 password-free Login detail contract。
- `pnpm tauri:typecheck`、desktop web build、`pnpm verify:browser-parity`：通过，parity 6 passed。
- `pnpm docs:check` 与 `cargo fmt --all -- --check`：通过。

## 安全与数据生命周期

Extension storage 只保存每个 origin 的 Login UUID，不保存 Passkey 私钥或 Vault response。Passkey protected value、counter 和签名仍只在 encrypted core/active desktop privileged process；summary 只新增布尔标记和 Login opaque UUID。

## 兼容与迁移

`loginId` 是 Browser RPC v2 `passkeys.create` 的可选输入，旧 extension 可省略。Vault format 不变；现有 `vaultmesh:passkey:v1` 与 `login:<uuid>` scope 原地获得正确展示，并已覆盖锁定重开。Passkey-only Login 不自动猜测或迁移。当前没有外部 Passkey 私钥导入入口；完整 Vault restore 原样保留既有 scope，未来新增的外部导入必须复用本 Change 的归属规则。
