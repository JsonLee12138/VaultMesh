# 分步登录账号框识别与后续密码填充

## 问题或目标

最小复现：打开 Apple Account 一类分步登录页。第一步账号框使用 `autocomplete="username webauthn"`，密码输入框提前存在于 DOM，但其祖先为 `aria-hidden="true"`、高度为 0；输入账号并继续后才展开密码步骤。

- Expected：第一步账号框显示 VaultMesh 图标并可显式/自动填入账号；隐藏密码框不参与 discovery；第二步密码框展开后重新 discovery 并填入与当前账号对应的密码。
- Actual：`webauthn` token 使整个账号框被排除；隐藏密码框因只检查自身样式而被误判为可见；祖先展开也不触发 rescan。
- 影响版本与 surface：`0.1.0-development` Chromium extension。

## 预期行为

- 符合 `REQ-AUTOFILL-001`：`username webauthn` 必须仍按 login username 识别，同时 discovery 不读取字段值。
- 祖先 `hidden`、`aria-hidden="true"`、`display:none`、`visibility:hidden` 或无可见布局区域的控件不得进入 discovery。
- 分步登录容器通过 `aria-hidden`、class 或 style 展开后必须 debounce rescan，并以新 document/signature 触发第二步填充。

## 非目标

- 不启用 conditional WebAuthn mediation，不改变 Passkey proxy 行为。
- 不自动点击“继续”或提交登录表单。
- 不绕过浏览器 site-access 权限；扩展仍需获准在目标 iframe origin 运行。

## 影响范围

- Browser extension form discovery、content mutation observation 和 CT-AUTOFILL-001 tests。
- Desktop、native host、core、bridge、Vault format、RPC/IPC/ABI、email、SSH 和 Passkey ownership 无变化。

## 实现约束

- `webauthn` 只作为 autocomplete 辅助 token，不得导致同字段的 `username`/`current-password` 语义丢失。
- 可见性检查不得读取或传输页面字段值。
- 动态 rescan 必须 debounce；dispose 清理既有 observer/timer。
- 不可见密码不得提前获得 secret assignment。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| BUG-002-REPRO | REQ-AUTOFILL-001 | Apple 型 `username webauthn` + 隐藏密码 fixture | CT-AUTOFILL-001 | Done |
| BUG-002-DISCOVERY | REQ-AUTOFILL-001 | 账号识别与祖先可见性修复 | CT-AUTOFILL-001 | Done |
| BUG-002-RESCAN | REQ-AUTOFILL-001 | 密码步骤展开触发新 signature | CT-AUTOFILL-001 | Done |
| BUG-002-VERIFY | REQ-AUTOFILL-001 | extension test/typecheck/build 与 docs gate | CT-AUTOFILL-001 | Done |

## 验收与证据

- 修复前：两个 `username webauthn` 回归用例失败；账号 control 被排除，隐藏密码反而进入 descriptors，inline trigger 为 hidden。
- 修复后：`form-discovery.test.ts` 覆盖 `username webauthn`、hidden/aria-hidden/display/visibility/clipped 祖先和 value-free descriptors；`autofill-page.test.ts` 覆盖第一步 trigger 与密码步骤展开后的新 signature。
- `pnpm extension:test`：22 files / 141 tests passed。
- `pnpm extension:typecheck`：通过。
- `pnpm extension:build`：Chrome MV3 production build 通过；仅保留既有 chunk-size warning。
- `pnpm docs:check`：27 Markdown、5 YAML、23 requirements、43 test IDs、4 ADRs，通过。
- 真实 Apple 页面确认账号字段为 `autocomplete="username webauthn"`，密码祖先初始为 `aria-hidden="true"` 且高度为 0；未输入或提交用户账号。当前浏览器未向 `account.apple.com`/`idmsa.apple.com` 注入 VaultMesh，需在浏览器中重新加载扩展并允许这两个域的站点访问后执行 Platform AT。

## 安全与数据生命周期

Discovery 继续只传输字段元数据和 `isEmpty`，不传输字段值。隐藏密码框在实际展开前不会获得 handle 或 secret assignment。无 storage、日志、analytics、crash、clipboard 或持久化变化。

## 兼容与迁移

无 Vault format、payload、Browser RPC version、IPC、ABI、settings 或 pairing 迁移。回滚恢复旧的分步登录识别缺陷。

## Bug 根因（仅 type=bug）

`isSupportedControl` 把 `webauthn` 放在 control-level 排除集合中，使合法的 `autocomplete="username webauthn"` 整体失效。`isVisible` 只检查 control 自身 computed style 和 rect，没有检查隐藏祖先；MutationObserver 也没有观察祖先的 `aria-hidden`、class、style 变化。既有测试只覆盖 username-only submit staging，没有覆盖第一步 inline trigger 和第二步动态展开。修复后保留组合 autocomplete tokens，沿 composed ancestor chain 拒绝隐藏/折叠 control，并观察可见性相关属性变化以 debounce rescan。
