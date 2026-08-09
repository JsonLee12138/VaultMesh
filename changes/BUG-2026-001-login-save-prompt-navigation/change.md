# 登录整页跳转后恢复账号保存提示

## 问题或目标

最小复现：在 Chromium 中打开会在登录成功后通过 `window.location.replace` 整页导航的 HTTP(S) 登录页，输入一个 VaultMesh 中不存在的账号并提交。VaultMesh content script 已注入且插件已解锁。

- Expected：提交被观察并完成账号核对后，用户在同一 tab、同一 origin 的新页面仍能看到“保存新账号？”并选择 Save/Ignore。
- Actual：旧文档在 `pagehide` 时销毁 in-page prompt；如果浏览器或系统通知被静默，用户看不到任何确认入口。
- 影响版本与 surface：`0.1.0-development` Chromium extension。

## 预期行为

- 符合 `REQ-AUTOFILL-002`：同一 tab、同一 origin 的整页导航不得丢失仍在有效期内的 Save/Ignore 确认入口。
- 新文档只能恢复 bounded prompt metadata；用户名、密码和其他捕获值不得返回 content script。
- 不同 tab、不同 origin、已过期、已保存或已忽略的 capture 不得恢复。

## 非目标

- 不把观察到 submit 视为服务端登录成功。
- 不延长现有 capture 的两分钟后台有效期。
- 不改变 Vault format、Browser RPC、Electron IPC、配对或通知权限策略。

## 影响范围

- Browser extension protocol、background pending-capture lookup、content prompt rehydration 和 extension tests。
- Desktop、native host、core、bridge、Vault format、RPC/IPC/ABI、email、SSH 和 Passkey 无变化。

## 实现约束

- Background worker 继续唯一持有捕获 secret；恢复响应只包含 capture ID、hostname、labels、update/actions。
- 恢复必须复用现有 `decideSaveCapture` 的 tab/origin/expiry 检查。
- 页面初始化与后台排队存在竞态时必须有界重试；dispose 必须清理重试 timer。
- 重复恢复同一 capture 不得创建第二份 secret 或第二个 pending capture。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| BUG-001-REPRO | REQ-AUTOFILL-002 | 整页导航后的新 content script 可复现丢失提示 | CT-AUTOFILL-002 | Done |
| BUG-001-PROTOCOL | REQ-AUTOFILL-002 | bounded pending-capture lookup schema | CT-AUTOFILL-002 | Done |
| BUG-001-RECOVER | REQ-AUTOFILL-002 | 同 tab/origin 新文档恢复 Save/Ignore prompt | CT-AUTOFILL-002 | Done |
| BUG-001-VERIFY | REQ-AUTOFILL-002 | extension test/typecheck/build 与 docs gate 证据 | CT-AUTOFILL-002 | Done |

## 验收与证据

- 修复前：`restores a pending save prompt in the new document after a full-page login navigation` 失败；新页面只发送 `vaultmesh.autofill-state`，没有 pending lookup，prompt 保持隐藏。
- 修复后：`apps/browser-extension/src/lib/autofill-page.test.ts` 覆盖恢复、启动竞态重试和 dispose 清理；`pending-save-prompt.test.ts` 覆盖顶层 frame、tab/origin、expiry 与最新 capture 选择；`protocol.test.ts` 验证恢复响应只保留 bounded prompt metadata。
- `pnpm extension:test`：22 files / 138 tests passed。
- `pnpm extension:typecheck`：通过。
- `pnpm extension:build`：Chrome MV3 production build 通过；仅保留既有 chunk-size warning。
- `pnpm docs:check`：26 Markdown、4 YAML、23 requirements、43 test IDs、4 ADRs，通过。
- 适用平台：Chromium extension 自动化与 production build 已验证；未使用或写入真实 AdGuard Home 凭据。

## 安全与数据生命周期

用户名、密码和其他捕获 secret 仍只存在于 extension background worker 的内存 pending capture 中，并按既有两分钟 expiry 或 Save/Ignore 清理。新页面只接收非秘密 prompt metadata；不进入 storage、日志、analytics 或 crash data。

## 兼容与迁移

无 Vault format、payload、RPC、IPC、ABI、settings 或 pairing 迁移。旧 content script 不发送 pending lookup；更新扩展后新 background/content script 共同生效。回滚只会恢复为依赖页面内 prompt 和系统通知的旧行为。

## Bug 根因（仅 type=bug）

`startAutofillPage` 把 prompt 附着在提交页文档上，并在 `pagehide` 调用 `dispose()`/`savePrompt.destroy()`。后台虽然保留 pending capture 并创建系统通知，却没有让同 tab、同 origin 的新文档重新取得 prompt metadata。既有测试只覆盖单一 document 内 submit 和 SPA save，没有覆盖成功登录后的整页导航。修复后由 background 继续持有 secret，新顶层文档通过 tab/origin/expiry 绑定的 lookup 恢复非秘密提示，并用有界重试处理导航竞态。修复版本待 Release 确定。
