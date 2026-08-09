# 登录跳转时等待保存候选准备完成

## 问题或目标

最小复现：在 Chromium 中向 `http://10.0.1.1/login.html` 提交一个新账号，站点立即整页跳转到同一 tab、同一 origin 的 `/`。后台账号核对耗时超过新文档现有三次查询（约 750 ms）时，新页面停止等待，之后候选虽成功排队，页面也不再显示保存提示。

- Expected：符合 `REQ-AUTOFILL-002`，同 tab、同 origin 的新页面在后台候选仍处于有效准备期时继续等待，并在候选就绪后显示 Save/Ignore 提示。
- Actual：新页面过早把短暂的 `none` 当成最终结果，保存提示永久隐藏。
- 影响版本与 surface：`0.1.0-development` Chromium extension。

## 预期行为

- Background 在收到合法 capture 后、首次异步账号核对前登记 bounded `preparing` 状态。
- 同 tab、同 origin 的顶层新文档收到 `preparing` 后，必须在既有两分钟 capture 上限内有界等待；候选就绪后恢复非秘密提示 metadata。
- 核对返回 unchanged、失败、过期、tab 关闭或扩展清理时，必须终止等待且不得显示误导性提示。

## 非目标

不改变是否判定为新账号/密码更新的规则，不提交登录表单，不改变系统通知策略或两分钟 capture 有效期。

## 影响范围

Browser extension protocol、background preparation lifecycle、content prompt recovery 和 extension tests。Desktop、native host、core、Vault format、Browser RPC/IPC/ABI、email、SSH、Passkey、依赖和发布策略无变化。

## 实现约束

捕获 secret 继续仅由 background 持有；`preparing` 响应只允许包含状态与 capture ID，并绑定 top-level frame、tab、origin、expiry。重复查询不得复制 capture；dispose、失败、过期和 tab 关闭必须停止或清理等待。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| BUG-010-REPRO | REQ-AUTOFILL-002 | 后台准备超过旧短重试窗口时稳定复现提示丢失 | CT-AUTOFILL-002 | Done |
| BUG-010-LIFECYCLE | REQ-AUTOFILL-002 | bounded preparing 状态及 tab/origin/frame/expiry 清理 | CT-AUTOFILL-002 | Done |
| BUG-010-RECOVER | REQ-AUTOFILL-002 | 新文档等待准备完成并恢复 Save/Ignore prompt | CT-AUTOFILL-002 | Done |
| BUG-010-VERIFY | REQ-AUTOFILL-002 | extension test/typecheck/build 与 docs gate 证据 | CT-AUTOFILL-002 | Done |

## 验收与证据

- 修复前：`keeps waiting when the background is still preparing a capture after the old retry window` 只查询一次，预期 5 次，且 prompt 未显示；`SaveCapturePendingResponseSchema` 拒绝 bounded `preparing` 响应。
- 修复后：`autofill-page.test.ts` 覆盖超过旧 750 ms 窗口的持续等待和最终恢复；`pending-save-prompt.test.ts` 覆盖 preparation 的 top-level frame、tab、origin 与 expiry 绑定；`protocol.test.ts` 验证响应只有状态和 UUID capture ID。
- `pnpm extension:test`：28 files / 182 tests passed。
- `pnpm extension:typecheck`：通过。
- `pnpm extension:build`：Chrome MV3 production build 通过；仅保留既有 chunk-size warning。
- `pnpm docs:check`：53 Markdown、23 YAML、27 requirements、65 test IDs、6 ADRs、8 routed Changes，通过。
- 适用平台：Chromium MV3 自动化与 production build；真实 AdGuard Home 页面只做无凭据只读注入检查。

## 安全与数据生命周期

用户名、密码和其他 capture secret 不进入新页面、storage、日志、analytics 或 crash data。准备标记仅保存在 background 内存并受两分钟 expiry、tab/origin 和 top-level frame 约束。

## 兼容与迁移

无 Vault format、RPC、IPC、ABI、settings 或 pairing 迁移。更新后的 background/content script 需一同加载；回滚恢复旧的短重试行为。

## Bug 根因（仅 type=bug）

`BUG-2026-001` 只让新文档查询已经进入 `pendingCredentialCaptures` 的候选，并用三次短重试覆盖简单调度竞态。`queueSaveCapture` 在把候选写入该 Map 前会等待 desktop 的账号列表、站点匹配和密码变化核对；这些异步调用可能超过约 750 ms。既有测试仅让第二次查询立即返回 queued，没有覆盖真实的长准备阶段。修复后 background 在异步核对前登记 bounded preparation，新文档只在收到该状态时继续有界轮询；终态、expiry、dispose 与 tab 关闭都会停止或清理。修复版本待 Release 确定。
