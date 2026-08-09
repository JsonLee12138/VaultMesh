# 修复 Windows Native Host 丢失已写入的管道响应

## 问题或目标

最小复现：在 Windows 安装 VaultMesh 与固定 ID Edge 扩展，保持桌面端运行后打开插件 popup，或执行
`pnpm tauri:windows:browser-at`。Expected：Host 通过 `VaultMesh.BrowserBroker.v2` 完成
`vault.status` 往返。Actual：插件显示“未连接 VaultMesh 桌面端”，AT 返回
`desktop-unavailable`；同一时刻直接阻塞读取管道可收到完整响应。

## 预期行为

- `REQ-BROWSER-001`：正确注册和配对的固定 ID 扩展必须能连接运行中的桌面 Broker。
- `REQ-BROWSER-002`：Broker 已完整写入且在上限内的响应必须由 Host 读取并关联，服务端随后断开不得把成功响应降级为 `desktop-unavailable`。
- 连接、写入或无响应的真实 transport failure 仍必须 fail closed，并返回稳定的非秘密状态。

## 非目标

不改变 Browser RPC 操作、schema、HMAC、配对凭据、扩展授权、Vault format、UI 文案或平台范围；不引入新的长期后台进程。

## 影响范围

仅影响 Windows Rust Native Host 的命名管道 response read、Windows transport contract test、安装态 Host 二进制和 `AT-BROWSER-001`。macOS Unix transport、renderer、Vault core、扩展存储、email/SSH/Passkey 语义无变化。

## 实现约束

- response 仍以换行结尾并受 1 MiB 上限约束；必须支持分块读取。
- 服务端写完后立即 `DisconnectNamedPipe` 时，已缓冲响应必须仍可读取。
- 未写响应、截断响应、超限响应和真实 broken pipe 必须失败，不能伪造成功。
- 不记录 RPC body、HMAC、配对 secret、Vault 数据或受保护字段。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| BUG-WNHP-010 | REQ-BROWSER-001、REQ-BROWSER-002 | 服务端分块写完即断开的真实 named-pipe 回归复现 | CT-NATIVE-BROWSER-001 | Done |
| BUG-WNHP-020 | REQ-BROWSER-002 | bounded overlapped response read，不丢失已缓冲响应 | CT-NATIVE-BROWSER-001、CT-TAURI-BROWSER-001 | Done |
| BUG-WNHP-030 | REQ-BROWSER-001 | Windows 安装态 Edge/Host/Broker `vault.status` 往返 | AT-BROWSER-001 | Done |

## 验收与证据

- 修复前：真实安装态 `pnpm tauri:windows:browser-at` 返回 `desktop-unavailable`；Win32 阻塞客户端对同一 Broker 收到 `invalid-message`，证明 Broker 可达且 Host 丢失响应。
- `cargo test --release -p vaultmesh-tauri-desktop --bin vaultmesh-native-host -- --nocapture`：2/2 通过，覆盖分块写入、立即断开、空响应与 1 MiB 上限。
- `cargo build --release -p vaultmesh-tauri-desktop --bin vaultmesh-native-host`：通过；最终安装二进制 SHA-256 为 `4C1C2CE8BE3F4581251DFB0E3D09213880C44E8CC7A982F5F491FC0507021B3F`。
- `pnpm tauri:windows:browser-at`：通过；固定扩展 ID `dmmjcaemejijgkpginfccokjmbknbgif`，Chrome/Edge 注册、manifest、packaged Host 路径与真实 `vault.status` 往返均通过。
- `pnpm verify:browser-parity`：6/6 通过；`pnpm extension:test`：229/229 通过；Tauri 与扩展 typecheck、扩展 production build 均通过。
- `pnpm scripts:test`：28/31 通过；3 个既有失败均为 Windows 上用 `/` 断言本机 `\\` 路径（agent sidecar、browser Host sidecar、Tauri browser dev manifest directory），未命中本 Work 修改文件。
- `pnpm docs:check` 无法运行至规则校验：当前工作树不存在脚本固定读取的 `releases/` 目录，报 `ENOENT`；本 Work 的 YAML/Markdown、追踪和封存仍由 `work:archive` 单独校验。
- 全量 Tauri lib 定向测试未进入目标用例：既有 Windows test 配置引用仅在 Unix 编译的 `agent_broker_transport`，并缺少 `thread`/`Duration` 导入；本 Work 的 Native Host 二进制回归测试和真实安装 AT 均已独立通过。

## 安全与数据生命周期

配对 secret 继续只存在 Windows Credential Manager 和 Rust 进程内存；Host 仍只转发 HMAC-authenticated、bounded RPC。修复不新增持久化、日志、clipboard、crash data 或 renderer 数据。

## 兼容与迁移

Browser RPC v2、命名管道名、manifest、固定扩展 ID、配对凭据、Vault format 和 ABI 均不变。旧 Host 可通过重新安装回滚；无数据迁移和不可逆操作。

## Bug 根因（仅 type=bug）

Windows Host 在写请求后使用 `PeekNamedPipe` 轮询响应。Broker 完整 `WriteFile` 后立即
`DisconnectNamedPipe`；若断开发生在 Host 下一次 peek 前，peek 可先返回 broken-pipe，即使响应已进入客户端缓冲区。Host 因而丢弃有效响应并返回 `desktop-unavailable`。既有 Windows transport test 直接阻塞 `ReadFile`，未覆盖 Host 的 peek 读取路径和“写完即断开”竞态。受影响版本为 `0.1.0-development`。
