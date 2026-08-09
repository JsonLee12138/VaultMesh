# ADR-0010：Agent 解锁租约可以显式按客户端共享

- 状态：Accepted
- 日期：2026-07-27
- 关联 Work：`CHG-2026-023-agent-client-shared-unlock`
- Supersedes：`ADR-0007` 中“unlock lease 永远绑定单条 verified transport”的绝对约束；默认行为和其他隔离约束保持不变

## 背景

一个已配对 MCP integration 可以同时拥有多个真实 stdio/IPC transport。固定要求每条 transport 分别输入解锁 factor 隔离最强，但会让同一客户端的并行进程重复解锁。稳定 client key 本身可由同 OS 用户进程自报，不能当作软件品牌认证；不过 pairing proof 已经把该 key、OS 用户和 protocol epoch 绑定为用户明确批准的本地 integration identity。

## 决策

Agent access settings 必须提供 `connection` 与 `client` 两种 unlock scope，默认 `connection`。`connection` 保持每条 verified transport 独立 lease。用户显式选择 `client` 时，broker 可以让同一 `client key × OS user × protocol epoch × Vault namespace` 的并行 verified transport 共享一个 memory-only unlock lease。

共享只改变 unlock factor 的复用范围，不共享 connection session、action permission、connection permission、pending continuation 或资源 owner。不同 pairing identity、desktop、browser 和其他 Vault 不得借用。共享身份只能由 Rust broker 从已验证 transport 与 pairing identity 推导，Agent、renderer 和 MCP 参数不得指定。

在 `client` 模式下，单条 transport 断开必须清理它自己的 session、authority 与资源，但只在该身份最后一条真实 transport 断开时清除共享 unlock lease。空闲时限、有限最长连续时限、系统锁屏/睡眠、pairing revoke、显式 Agent lock、Vault 锁定/切换、factor drift、App/broker 退出和关机仍清除共享 lease 及该身份全部下游 authority。切换 scope 必须清除全部现有 lease，不得迁移或提升 authority。

## 原因

- Pairing identity 是产品内已经由用户批准的客户端边界，比进程名、PID 或自报品牌更稳定。
- 默认 per-connection 保持现有最小权限；共享必须由用户显式开启。
- 最后一条连接语义允许同一客户端并行 transport 复用一次 factor，同时保留真实客户端断连即锁定。
- 只共享 unlock gate 而不共享动作权限，避免把易用性设置扩展成执行授权。

## 后果

- Broker 必须把 transport 注册/断连同步给 Rust lease owner，并能按 pairing identity 返回全部受影响 transport。
- Shared lease 的活动、空闲与绝对期限由同一 owner 聚合；到期或显式锁定需要撤销同身份全部连接 authority。
- 设置格式增加默认安全的 enum；模式切换会中断当前 Agent 工作并要求重新解锁。
- Packaged macOS/Windows 必须验证同 client 并行连接、最后断连、锁屏/睡眠和 App restart。

## 被拒方案

- 永久仅 per-connection：隔离最强，但无法满足用户明确选择的同客户端单次解锁工作流。
- 仅按 client key 共享：忽略 OS user、protocol epoch 和 Vault namespace，会扩大自报字符串的权限含义。
- 跨最后断连或 App restart 持久化 lease：需要持久化解锁 authority，违反 memory-only 和终止清理边界。
- 同时共享 action/connection permission：unlock gate 不等于动作授权，会造成权限静默提升。

## 验证

由 `REQ-AGENT-001`、`NFR-AGENT-002`、`CT-AGENT-UNLOCK-001`、`CT-AGENT-LIFECYCLE-001` 和 `AT-AGENT-UNLOCK-001` 验证。
