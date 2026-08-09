# 邮件字母数字验证码复制静默失败

## 问题或目标

最小复现：在 macOS Tauri 本地包中解锁 Vault，扫描包含 `A9b2C3` 一类 4–8 位字母数字 OTP 的邮件；“最近验证码”能显示完整 token，点击复制按钮后剪贴板不变且 UI 没有提示。预期是完整复制现有候选并按安全设置过期；实际是 Rust `email.copy-code` 和 TypeScript Schema 仍限制纯数字，renderer 又未捕获 rejection。

## 预期行为

`REQ-EMAIL-002` 已接受的 4–8 位、至少含一个数字的 ASCII 字母数字候选必须能通过既有 privileged clipboard operation 原样复制并按配置清理。复制失败必须显示后端的非秘密公共错误，重复点击在请求完成前必须被抑制。

## 非目标

不扩大 OTP 长度或字符集，不改变提取、Provider、候选持久化、剪贴板所有权或清理期限。

## 影响范围

影响 Email OTP renderer、desktop typed Schema 和 Rust `email.copy-code` 输入校验。无 Vault format、Browser RPC、ABI、Provider credential、迁移或发布平台变化。

## 实现约束

候选和复制输入必须共享 `REQ-EMAIL-002` 的 ASCII 字母数字边界并至少包含一个数字。验证码不得进入日志、持久化状态或错误文本；写入和定时清理继续由 Rust runtime 所有。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| `TASK-BUG-016-001` | `REQ-EMAIL-002` | candidate/copy Schema 与 Rust dispatcher 接受同一字母数字 OTP | `CT-EMAIL-002` | Done |
| `TASK-BUG-016-002` | `REQ-EMAIL-002` | 最近验证码复制显示成功或公共失败反馈，并抑制重复点击 | `CT-EMAIL-002` | Done |
| `TASK-BUG-016-003` | `REQ-EMAIL-002` | 定向 UI、adapter、Rust、typecheck 与文档验证 | `CT-EMAIL-002` | In progress（等待真实候选点击确认） |

## 验收与证据

- 修复前回归：混合验证码可显示，但 copy Schema/Rust validator 拒绝，renderer rejection 无反馈。
- 自动化必须覆盖混合 token 成功复制、后端失败反馈、typed adapter 固定路由和非法 token 拒绝。
- 验证平台为 macOS x86_64 开发环境；真实剪贴板安装包冒烟在完成后记录。

| Evidence ID | 日期 | 范围 | 证据 | 结果 |
| --- | --- | --- | --- | --- |
| `EVID-BUG-016-001` | 2026-07-23 | Schema、Rust dispatcher、renderer feedback、typed adapter | 修复前代码证据：extractor 接受 `A9b2C3`，copy Schema/Rust 只接受数字，renderer 无 rejection handler。修复后定向 Rust 1/1、Vitest 29/29、完整 Tauri Rust 43/43、Vitest 61/61、typecheck、fmt、docs check 通过；`pnpm local:package` 成功生成单一 app bundle、验证 DMG/ZIP、安装并启动 macOS x86_64 本地包。 | 自动化 Pass；真实候选点击待用户确认 |

## 安全与数据生命周期

OTP 继续只作为短时候选进入当前 renderer，并由 Rust 写入系统剪贴板；按配置过期或策略清理。测试仅使用合成 token，不记录真实邮件或验证码。

## 兼容与迁移

无格式或版本迁移。operation 名称与输入字段不变，只修正其校验语义以匹配已接受的候选契约；纯数字行为保持兼容。

## Bug 根因

`CHG-2026-015` 将提取器扩展为字母数字 OTP，但遗漏 `EmailOtpCopySchema`、`EmailOtpCandidateSchema` 和 Rust `email.copy-code` 的纯数字限制，也没有覆盖复制 UI 的 rejection。受影响版本为 `0.1.0-development`，修复版本相同。
