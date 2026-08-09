# 邮件字母数字验证码完整识别

## 问题或目标

带数字前缀的品牌名与混合字母数字验证码同时出现时，当前实现会把真实 token 截断成数字前缀，并从品牌名误识别另一个验证码。数字专用提取规则无法完整处理带字母的 OTP，且宽松的反向上下文匹配会跨越品牌文本。

## 预期行为

`REQ-EMAIL-002` 的候选提取必须完整保留 4–8 位 ASCII 字母数字 OTP 的大小写，并要求候选至少包含一个数字。显式验证码语义位于候选之前时可以识别数字或混合字母数字 token；候选位于语义之前时必须使用受支持的紧邻连接表达，不能跨过品牌名或无关文本形成候选。纯数字 OTP 的既有行为保持不变。

## 非目标

不识别纯字母 token、不支持超过 8 位或包含连字符等符号的验证码，不扩大邮件权限、Provider、domain matching、候选过期或通知范围。

## 影响范围

仅影响 Tauri Rust Email OTP service 的候选提取与 `CT-EMAIL-002`。不改变 Vault format、settings、公共 typed operation、Browser RPC、IPC、ABI、Provider credential 或 renderer DTO。

## 实现约束

提取必须使用完整 ASCII 字母数字边界，禁止返回合法 token 的数字子串；验证码原始大小写必须保留。反向上下文只允许空白、标点或明确的中英文连接词，不能跨过其他字母数字文本。结果仍按 message/account/code 去重并遵守现有数量、过期、锁定和清理上限。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| `TASK-CHG-015-001` | `REQ-EMAIL-002` | 主规格定义字母数字 OTP 与反误报边界 | `CT-EMAIL-002` | Done |
| `TASK-CHG-015-002` | `REQ-EMAIL-002` | Rust 提取器完整返回合成混合 token 且拒绝数字前缀品牌误报 | `CT-EMAIL-002` | Done |
| `TASK-CHG-015-003` | `REQ-EMAIL-002` | 定向 Rust 测试、Clippy、fmt 与文档校验 | `CT-EMAIL-002` | Done |

## 验收与证据

- 回归样本必须证明完整邮件只返回合成的混合字母数字 token，不返回其数字前缀或品牌中的数字。
- 自动化必须覆盖纯数字前后文案、混合大小写、完整 token 边界、品牌邻接误报和无验证码语义负例。
- 适用实现与验证平台为 Rust-owned Tauri desktop runtime；无新增 packaged/live Provider AT。

| Evidence ID | 日期 | 范围 | 证据 | 结果 |
| --- | --- | --- | --- | --- |
| `EVID-CHG-015-001` | 2026-07-23 | `TASK-CHG-015-001..003`；macOS 14.8.7 x86_64 | 修复前定向测试稳定失败：合成样本 actual 为混合 token 的数字前缀与品牌数字、expected 为完整混合 token。修复后 Email OTP tests 8/8、Tauri Rust lib 42/42；`cargo clippy -p vaultmesh-tauri-desktop --all-targets --no-deps -- -D warnings`、`cargo fmt --all -- --check`、`pnpm tauri:typecheck`、`pnpm docs:check`（60 Markdown、30 YAML）均通过。 | `CT-EMAIL-002` Pass |

## 安全与数据生命周期

验证码和邮件正文继续只在 Rust service 的有界内存中处理；renderer 只接收现有短时候选事件。新增 token 形式不得进入日志、持久化 settings、测试快照、analytics 或 crash data，final lock 与 expiry 清理不变。

## 兼容与迁移

无。纯数字验证码行为向后兼容；Vault format、payload、RPC/IPC/ABI、Provider account、settings 和回滚均不需要迁移。
