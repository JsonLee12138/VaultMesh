# 插件识别密钥默认关闭二次验证

## 问题或目标

插件从网页识别并经用户确认保存 developer/service secret 时，后台固定写入主密码二次验证开启；这与插件手动新建同类项目的默认值不一致。目标是让识别保存默认关闭二次验证。

## 预期行为

`REQ-AUTOFILL-002` 要求插件识别出的 developer/service secret 只有在用户确认后才写入，并以 `masterPasswordReprompt: false` 创建。用户保存后仍可以在项目编辑器中显式开启二次验证；既有项目不改变。

## 非目标

不改变 Login、支付卡、SSH 凭据、Passkey 或手动新建项目的默认值，不移除二次验证能力，也不改变读取、复制或填充策略。

## 影响范围

仅影响 Chromium MV3 extension background 的网页密钥捕获参数。Desktop、native host、core、Vault format/payload、Browser RPC/IPC/ABI、email、SSH、Passkey、依赖和发布打包无契约变化。

## 实现约束

捕获值继续只在扩展后台短暂存在，并且只有用户确认 Save 后通过既有 `secrets.add` 特权路径写入加密 Vault。失败、取消、忽略、锁定、过期和重复请求继续使用现有 fail-closed/清理路径。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| `TASK-CHG-017-001` | `REQ-AUTOFILL-002` | 主规格明确识别密钥的默认二次验证策略 | `CT-AUTOFILL-002` | Done |
| `TASK-CHG-017-002` | `REQ-AUTOFILL-002` | Extension capture 构造 `masterPasswordReprompt: false` | `CT-AUTOFILL-002` | Done |
| `TASK-CHG-017-003` | `REQ-AUTOFILL-002` | Extension 定向/全量测试、类型检查、构建与文档检查 | `CT-AUTOFILL-002` | Done |

## 验收与证据

- 自动化必须证明网页识别的 developer/service secret 保存参数默认关闭二次验证，并保留识别内容和非秘密元数据。
- 适用平台为 Chromium MV3；本变更不要求新的目标 OS 签名或安装验收。
- `pnpm extension:test`：34 files / 218 tests Pass，包含 captured secret 默认值回归。
- `pnpm extension:typecheck`：Pass。
- `pnpm extension:build`：Chromium MV3 production build Pass；仅保留既有 chunk-size warning。
- `pnpm docs:check`：Pass（64 Markdown、34 YAML、29 requirements、68 test IDs、21 routed Changes）。

## 安全与数据生命周期

Secret 仍由 content script 识别后仅在 extension background 内存中短暂持有，用户确认后通过 desktop privileged runtime 写入加密 Vault；不新增 extension storage、日志、通知正文、剪贴板或 crash data。默认关闭二次验证减少一次访问时的额外主密码校验，但不改变 Vault 加密、unlock、gesture、confirmation 或用户后续显式开启能力。

## 兼容与迁移

Vault format/payload、Browser RPC/IPC/ABI、settings 和 pairing 无变化。只影响新识别保存的 developer/service secret；既有项目和回滚代码继续读取各项目已持久化的布尔值，无数据迁移和不可逆操作。
