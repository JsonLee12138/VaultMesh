# 修复 Tauri Browser RPC 大响应被截断

- Work ID：`BUG-2026-005-tauri-browser-large-response`
- 类型：Bug
- 状态：Implementing
- 关联：`REQ-BROWSER-002`、`REQ-TAURI-001`、`NFR-REL-001`、`NFR-PRIV-001`

## 问题或目标

macOS Tauri 本机包连接固定开发扩展，Browser Vault 已解锁且 `vault.status` 正常。Vault 包含
505 项时打开扩展保险库页。Expected：`vault.workspace` 返回 renderer-safe summary，扩展显示
条目。Actual：popup 显示“无法读取桌面端保险库”，Rust Host 返回
`invalid-broker-response`；同一路径的 `items.list` 也失败。

## 预期行为

- `REQ-BROWSER-002`：合法且未超过协议上限的 Browser RPC 响应必须完整写入 Host，不能发布截断 JSON。
- `REQ-TAURI-001`：Tauri Unix transport 必须在有界超时内完成大于 socket 首次 buffer 的响应写入。
- `NFR-REL-001`：写入失败必须返回受控 transport failure，不得把部分 JSON 当作成功响应。
- `NFR-PRIV-001`：测试和诊断只记录响应长度/公开状态，不输出条目内容或受保护字段。

## 非目标

- 不改变 Browser RPC operation、schema、policy、Vault format 或扩展 UI。
- 不增加服务器、同步或无界消息；不处理 Windows named pipe transport。

## 影响范围

Tauri Rust Unix listener、Rust Native Host response bound、macOS 本机包和 Browser transport
contract test。Electron reference、Vault core payload、renderer、email/SSH/Passkey 语义无变化。

## 实现约束

- `accept()` 后必须把 stream 切回 blocking，并设置读写超时；慢客户端不能永久占用 listener。
- Broker/Host response 必须有显式上限；超过上限必须 fail closed，不能截断或输出秘密。
- 回归测试必须通过真实 Unix socket 返回大于 8 KiB 的 JSON，并验证完整解析和 correlation。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| BUG-TBLR-010 | REQ-BROWSER-002、NFR-REL-001 | 复现 non-blocking partial write 的大响应 socket 测试 | CT-TAURI-BROWSER-001 | Done |
| BUG-TBLR-020 | REQ-TAURI-001、NFR-PRIV-001 | blocking + timeout + bounded response transport | CT-TAURI-BROWSER-001 | Done |
| BUG-TBLR-030 | REQ-BROWSER-002 | 505 项本机 Vault 的 `items.list`/`vault.workspace` 真实 Host 往返 | AT-BROWSER-001 | Pending |

## 验收与证据

修复前：`vault.status` 为 164 bytes 且成功；`items.list`/`vault.workspace` 均只收到 8192
bytes 的截断 JSON，Host 返回 `invalid-broker-response`。修复后必须记录自动化、Clippy、package、
安装态只读路由字节数和公开状态。

| Evidence ID | 日期 | 范围 | 证据 | 结果 |
| --- | --- | --- | --- | --- |
| EVID-TBLR-001 | 2026-07-23 | BUG-TBLR-010..020；macOS 14.8.7 x86_64 | accepted stream 显式切回 blocking，read/write timeout 为 1/2 秒，Broker/Host response bound 为 1 MiB；真实 Unix socket 32 KiB+ response 完整 JSON/correlation regression 修复前 Fail、修复后 Pass。Tauri Rust 30/30、Clippy `-D warnings`、docs check（40 Markdown/11 YAML）、`pnpm tauri:local:package`、strict code seal、Vault SHA-256、Rust Host `vault.status`、DMG verify Pass。本机重签流程补充终止旧 Host，Chrome 自动拉起新 PID；插件授权按重启规则为 locked | `CT-TAURI-BROWSER-001` Pass；505 项真实 workspace 需用户重新解锁插件后完成 `AT-BROWSER-001`，Work 保持 Implementing |

## 安全与数据生命周期

RPC summary 仅通过 owner-only Unix socket 和 Native Messaging stdout；不写日志、settings 或
extension storage。诊断不打印 response body。配对 HMAC、expiry、replay 与 Browser 独立授权不变。

## 兼容与迁移

Browser RPC 2、Vault format 1、Native ABI 1、pairing credential 和 manifest 均不变，无迁移。

## Bug 根因

Tauri listener 被设为 non-blocking，macOS `accept()` 得到的 stream 保留该状态。现有实现仅设置
read timeout，没有切回 blocking；较大响应在首次 socket buffer 后使 `write_all` 返回
`WouldBlock`，且写入结果被忽略，最终 Host 收到 8192-byte 截断 JSON。既有 socket CT 只覆盖
小型 `vault.status`，没有跨越首次 buffer，因此未发现。受影响版本为本机
`0.1.0-development` Tauri package；本机修复包已安装，尚未发布。
