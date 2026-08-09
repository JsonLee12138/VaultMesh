# Agent 最长连续解锁支持直到关机

> 2026-07-27，维护者明确要求新增“直到关机”选项，并确认系统锁屏、睡眠、真实断连、撤销、VaultMesh 退出、Vault 锁定/切换和关机仍立即失效；该行为已接受并进入 Implementing。

## 问题或目标

当前 Agent 最长连续解锁只能选择 1/4/8 小时。对受控的长期本地 MCP 工作流，用户需要主动选择“直到关机”，避免绝对时限中断长任务，同时不能弱化空闲锁定和终止事件清理。

## 预期行为

- `REQ-AGENT-001`：`maxUnlockDurationMs: null` 表示不设置绝对解锁截止时间；空闲自动锁定继续生效，活动仍只刷新空闲时限。
- `NFR-AGENT-002`：系统锁屏/睡眠、真实断连、撤销、VaultMesh 退出、Vault 锁定/切换、factor drift 和关机仍立即清除 lease、authority 与资源。
- “直到关机”不得持久化 unlock lease、factor、Vault Key 或连接 authority；VaultMesh/Agent broker 重启后仍必须重新解锁。

## 非目标

- 不让解锁状态跨进程、跨真实断连、跨应用重启或跨关机恢复。
- 不关闭空闲自动锁定，也不改变 desktop/browser 的解锁策略。
- 不改变 MCP tool schema、Vault 格式或 action permission 规则。

## 影响范围

影响 Rust Agent unlock lease policy、owner-only Agent access settings、桌面 typed contract、安全中心 UI 与回归测试。不影响 Vault payload、MCP RPC、扩展、秘密所有权、依赖和发布平台范围。

## 实现约束

- `maxUnlockDurationMs` 使用显式 `null` 表示无绝对截止时间，不使用 `0`、极大整数或持久 lease 模拟。
- 设置仅是非秘密策略；实际 lease 继续只存在于 Rust 内存。
- 旧版本读取 `null` 失败时必须安全回退到默认 8 小时，不能扩大 authority。
- 所有强制终止事件必须优先于该设置，并保持幂等资源清理。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| `AGENT-022-001` | `REQ-AGENT-001` | Rust/TypeScript 契约、设置持久化和安全中心增加“直到关机” | `CT-AGENT-UNLOCK-001` | Completed |
| `AGENT-022-002` | `NFR-AGENT-002` | 无绝对截止仍保留空闲及全部强制终止清理 | `CT-AGENT-LIFECYCLE-001`、`AT-AGENT-UNLOCK-001` | Automated Pass / AT Pending |

## 验收与证据

- 选择“直到关机”后，跨越任意有限绝对时长不会仅因创建时间过期。
- 同一 lease 在超过配置空闲时间后仍到期；系统锁屏/睡眠、断连、撤销、退出和重启路径保持既有清理行为。
- 数字设置 1/4/8 小时保持兼容；非法数字和 `0` 继续拒绝。
- 签名 packaged macOS/Windows 上的 `AT-AGENT-UNLOCK-001` 在发布前完成。

## 安全与数据生命周期

设置文件只保存非秘密的 `null` 策略值。Unlock lease、factor、Vault Key、connection permission 和执行资源均不新增持久化；内存状态仍由空闲超时和所有终止事件清理。

## 兼容与迁移

既有数字 JSON 无需迁移。新版本把 `null` 解释为关闭绝对截止时间；旧版本无法验证该值时回退默认 8 小时，因此降级只会收紧权限。无 Vault format、RPC/IPC/ABI 或不可逆迁移。

## 实现证据（2026-07-27）

- Rust `AgentAccessSettings.maxUnlockDurationMs` 使用 `null`/`None` 表示无绝对截止；有限 1/4/8 小时、默认 8 小时及非法值拒绝保持不变。
- 新增租约回归证明执行中 lease 跨越 30 天不因绝对时长失效，活动结束后仍由 5 分钟空闲时限清理；设置重载后保持 `null`。
- 安全中心“最长连续解锁”新增“直到关机”，受控下拉只接受四个明确枚举值；renderer/shared/API 定向 50 tests Pass。
- `pnpm tauri:test` 最终复跑：Tauri Rust 193 passed / 1 ignored（本机 OpenSSH）、Agent MCP 10 passed、desktop renderer 110 passed。
- `cargo clippy -p vaultmesh-tauri-desktop -p vaultmesh-agent-mcp --all-targets -- -D warnings`、`pnpm docs:check`、desktop typecheck/build、`cargo fmt --check` 与 `git diff --check` 通过。
- `AT-AGENT-UNLOCK-001` 尚未在签名 packaged macOS/Windows 应用执行，因此 Work 保持 Implementing。
