# 密码框入口始终保留账号字段

## 问题或目标

最小复现：Apple 型分步登录进入密码阶段后，页面账号展示值可能与 Vault 候选 username 不完全一致；从密码框打开 VaultMesh 并选择登录项。Expected：只填密码，账号字段不发生 input/change。Actual：`BUG-2026-008` 只有账号值与候选完全匹配时才保留账号；不匹配会再次清空并输入账号，页面退回账号验证。影响 `0.1.0-development` Chromium extension。

## 预期行为

符合 `REQ-AUTOFILL-001`：从密码、OTP 等非账号登录字段选择 Login 时必须保留所有账号字段，只请求和应用非账号 assignment；只有从账号框选择 Login 时才允许清空并重新输入账号。所有路径仍禁止提交表单。

## 非目标

不自动点击下一步或登录，不比较账号值，不改变候选排序、账号框入口的切换账号语义、站点权限、保存捕获或 Browser RPC。

## 影响范围

仅影响 extension 的 inline selection intent 和 `CT-AUTOFILL-001` fixture。Desktop/core/native host、Vault format、Browser RPC/IPC/ABI、email、SSH、Passkey、依赖与发布边界无变化。

## 实现约束

保留策略必须由触发候选菜单的 control 类型决定：inline 选择默认保留账号，只有 username/email/tel 等账号入口显式发送 `replaceExistingAccount`；password/OTP 等非账号登录入口不发送替换意图。消息不携带页面账号值；后台通过字段过滤和关闭 `clearBeforeFill` 实现只填目标字段。Automatic fill 还必须在 discovery 时排除已经非空的账号字段，避免 apply 前页面状态变化导致重新输入。取消、失败、锁定、过期和重复选择沿用既有流程。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| BUG-009-REPRO | REQ-AUTOFILL-001 | 账号展示值与候选不同的密码入口 fixture | CT-AUTOFILL-001 | Done |
| BUG-009-INTENT | REQ-AUTOFILL-001 | 仅按账号/密码入口决定清理策略 | CT-AUTOFILL-001 | Done |
| BUG-009-VERIFY | REQ-AUTOFILL-001 | extension test/typecheck/build 与 docs gate | CT-AUTOFILL-001 | Done |

## 验收与证据

- 修复前：分步密码入口 fixture 失败，selection 消息没有可靠表达触发字段，后台回退到“替换账号”。
- 修复后：`autofill-page.test.ts` 覆盖 Apple 型 `username webauthn` + `password autocomplete=off` DOM，账号展示值与候选不同时密码入口仍默认保留账号；同时覆盖只有账号入口发送 `replaceExistingAccount` 并允许重新输入账号。`form-discovery.test.ts` 证明 password/OTP 等非账号登录入口保留账号；`autofill-selection.test.ts` 证明 automatic discovery 排除已经非空的账号字段。
- `pnpm extension:test`：28 files / 175 tests passed。
- `pnpm extension:typecheck`：通过。
- `pnpm extension:build`：Chrome MV3 production build 通过；仅保留既有 chunk-size warning。
- `pnpm docs:check`：52 Markdown、22 YAML、27 requirements、65 test IDs、6 ADRs、7 routed Changes，通过。
- Apple 发布安装环境仍由 `AT-AUTOFILL-001` 验收，本次未执行 Platform AT。

## 安全与数据生命周期

不再读取或比较页面账号值；新增信息仍只有短生命周期布尔意图。Broker 保持 secret assignment 所有权和 origin/tab/frame/document/handle/expiry/one-use 绑定；无 storage、日志、analytics、crash 或 clipboard 变化。

## 兼容与迁移

无 Vault format、payload、Browser RPC version、IPC、ABI、settings、pairing 或不可逆迁移。回滚恢复密码入口可能重写账号的缺陷。

## Bug 根因（仅 type=bug）

`BUG-2026-008` 错把页面账号值与候选 subtitle 的相等比较作为密码入口保留账号的条件；Apple 的展示/规范化状态不保证两者完全一致。既有测试只覆盖相同值，未覆盖不同展示值。修复版本为 `0.1.0-development`，回归测试必须直接证明入口字段而非账号文本决定清理策略。
