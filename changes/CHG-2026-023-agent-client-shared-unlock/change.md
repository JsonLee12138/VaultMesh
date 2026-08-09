# Agent 解锁支持按客户端共享

> 2026-07-27，维护者明确要求用一个开关控制“每条连接分别解锁”或“同一客户端只解锁一次”，并要求其余自动锁定和强制清理配置保持一致；该行为已接受并进入 Implementing。

## 问题或目标

当前 memory-only Agent unlock lease 严格绑定每条 stdio transport。一个已配对客户端同时建立多个真实连接时，每条连接都要重复输入 factor。目标是在保留默认 per-connection 隔离的同时，允许用户显式选择同一已配对客户端身份共享一次解锁。

## 预期行为

- `REQ-AGENT-001`：设置提供 `connection`（每条连接）和 `client`（同一客户端）两种解锁范围，默认 `connection`。
- 用户可以从安全中心或当前独立 Agent 解锁窗口切换范围；解锁窗口只获得读取状态、修改 scope、解锁和取消所需的最小 typed capability。
- `client` 模式只在相同 OS 用户、规范化 client key、protocol epoch 和 Vault namespace 对应的已配对身份内共享 memory-only lease；不同客户端不得借用。
- `NFR-AGENT-002`：同一客户端最后一条真实 transport 断开时清除共享 lease；单条并行 transport 退出不得锁定仍在线的同身份连接。
- 两种模式使用相同的空闲、最长连续解锁、系统锁屏/睡眠、撤销、Vault 锁定/切换、factor drift、应用退出和关机清理规则。
- 切换共享范围必须立即清除全部现有 Agent unlock lease 和下游 authority，要求按新范围重新解锁。
- 同一 scope owner 的并发调用必须合并为一个 pending unlock request，一次 factor 结果供全部 waiter 使用；可见解锁窗口不得被重复请求反复唤醒或抢焦点。

## 非目标

- 不让 lease 跨最后一条真实连接、App/broker 重启、Vault 锁定或关机恢复。
- 不让不同 client key、不同 OS 用户或仅拥有同名进程的调用方共享解锁。
- 不改变 action permission、connection permission 或高风险 fresh confirmation 语义。

## 影响范围

影响 Rust broker 与 Agent Vault access 之间的 transport 注册/断连回调、lease owner、owner-only settings、桌面 typed contract、安全中心 UI 和生命周期测试。不影响 Vault payload、MCP tool schema、扩展、secret DTO 或依赖。

## 实现约束

- 共享身份必须使用 broker 从 `client key × OS user × protocol epoch` 推导的 pairing identity，不得信任 renderer 或 MCP 额外提交 group ID。
- Lease、factor、Vault Key 和 authority 继续只存在于 Rust 内存；settings 只持久化非秘密 enum。
- Shared lease 的活动计数、空闲时间和创建时间必须由同一 owner 聚合；任一适用到期清除该身份的全部连接 authority。
- `connection → client` 或 `client → connection` 不迁移现有 lease，必须 fail-closed 清除后重解锁。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| `AGENT-023-001` | `REQ-AGENT-001` | broker 注册身份、connection/client lease owner 与共享 access gate | `CT-AGENT-UNLOCK-001` | Completed |
| `AGENT-023-002` | `NFR-AGENT-002` | 最后一条断连、模式切换、到期与强制锁定清理 | `CT-AGENT-LIFECYCLE-001` | Completed |
| `AGENT-023-003` | `REQ-AGENT-001` | 安全中心与独立解锁窗口共享开关、最小 typed capability、typed contract 与兼容设置 | `CT-AGENT-UNLOCK-001`、`AT-AGENT-UNLOCK-001` | Automated Pass / AT Pending |

## 验收与证据

- `connection` 模式保持两个同 client-key transport 必须分别解锁。
- `client` 模式下第一条连接解锁后，第二条同 pairing identity 的在线连接无需再次输入 factor；不同 identity 仍锁定。
- 一条并行连接断开后共享 lease 保留；最后一条断开后 lease 与 Agent-only runtime 清除。
- 模式切换、空闲/有限最长时限及所有终止事件清除完整 authority/resource。
- 签名 packaged macOS/Windows 的真实多进程 MCP 场景在发布前执行 `AT-AGENT-UNLOCK-001`。

## 安全与数据生命周期

持久设置只增加非秘密 `unlockScope`。Pairing identity 由 broker 内部计算；renderer 只读取和修改 enum。共享 lease、factor、Vault Key、transport 列表和下游 authority 不持久化，不进入 MCP/IPC response、日志或 audit。

## 兼容与迁移

缺少 `unlockScope` 的旧 JSON 按 `connection` 读取。新版本保存新增字段；旧版本因 unknown field 拒绝整份设置并回退默认 per-connection/15 分钟/8 小时，因此降级只会收紧权限。无 Vault format、MCP schema 或不可逆迁移。

## 实现证据（2026-07-27）

- Rust lease owner 支持 `Connection(Uuid)` 与 broker-derived `Client(pairing_ref)`；pairing ref 绑定规范化 client key 与 OS user，并包含当前 pairing protocol epoch。
- Broker 在 transport 注册/断连时同步身份；client scope 聚合同身份活动、空闲与绝对期限，单条并行断连保留共享 lease，最后断连锁定 Agent-only runtime。
- 显式 client lock 返回同身份全部 transport 并清除其 authority；scope 切换清空全部 lease；两个并发 unlock wait 可以在一次共享解锁后各自继续原请求。
- 旧 settings 缺少 `unlockScope` 时保留原 idle/max 值并默认 connection；安全中心开关保存 `connection/client` enum，定向 Rust 8 tests 与 renderer/shared/API 51 tests Pass。
- 独立 Agent 解锁窗口展示当前 scope，可通过专用 `agent_unlock_set_scope` 命令切换；该窗口没有主 renderer dispatcher 权限，scope 变化继续清除现有 lease/authority。窗口 renderer 4 tests 与 Rust capability/并发 unlock 2 tests Pass。
- 重复解锁回归修复按 `AgentVaultAccess::shares_unlock` 合并同 scope pending，结果不再由首个 waiter 单独消费；displayed transport 断开时 request 转移给仍在线 participant，完成的 request 不会在重新锁定后复用。已显示的解锁窗口对重复 wake 保持幂等。
- `pnpm tauri:test`：重复解锁修复后 Tauri Rust 199 passed / 1 ignored（本机 OpenSSH）、Agent MCP 10 passed、desktop renderer 112 passed。
- `cargo clippy -p vaultmesh-tauri-desktop -p vaultmesh-agent-mcp --all-targets -- -D warnings`、`pnpm docs:check`、desktop typecheck/build、`cargo fmt --check` 与 `git diff --check` 通过。
- `AT-AGENT-UNLOCK-001` 尚未在签名 packaged macOS/Windows 的真实同客户端多进程场景执行，因此 Work 保持 Implementing。
