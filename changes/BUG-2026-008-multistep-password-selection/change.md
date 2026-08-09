# 分步登录密码阶段保留已提交账号

## 问题或目标

最小复现：在 Apple 型分步登录页先提交账号，密码步骤保留非空账号框并显示空密码框；点击密码框的 VaultMesh 图标并选择登录项。Expected：保留页面已提交的账号，只填密码且不提交。Actual：显式选择被统一当作切换账号，扩展先清空并重写账号框，页面因此退回账号步骤，无法完成登录。影响 `0.1.0-development` Chromium extension。

## 预期行为

符合 `REQ-AUTOFILL-001`：当前密码控件属于登录密码、同一表单的可见非空账号与所选登录项匹配时，从密码入口选择该登录项必须保留账号控件，只请求和应用其余安全 assignment；选择其他账号及普通单页登录的显式账号切换仍可替换账号与密码，所有路径仍禁止提交。

## 非目标

不自动点击“下一步”或“登录”，不向后台传输页面账号值，不改变候选排序、站点权限、自动填充策略或保存捕获行为。

## 影响范围

仅影响 extension 的 inline selection intent、内部消息校验、discovery field filtering 和 `CT-AUTOFILL-001`。Desktop/core/native host、Vault format、Browser RPC/IPC/ABI、email、SSH、Passkey、依赖与发布边界无变化。

## 实现约束

“保留账号”只能由当前密码入口及本地账号与候选 username 的规范化相等比较触发，消息不得携带页面账号值；后台只能缩小发送给 broker 的字段集合。取消、失败、锁定、过期和重复选择沿用既有流程，普通显式账号切换语义不得回归。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| BUG-008-REPRO | REQ-AUTOFILL-001 | Apple 型非空账号 + 密码入口 fixture | CT-AUTOFILL-001 | Done |
| BUG-008-INTENT | REQ-AUTOFILL-001 | value-free 保留账号意图与协议校验 | CT-AUTOFILL-001 | Done |
| BUG-008-FILTER | REQ-AUTOFILL-001 | broker discovery 排除既有账号字段 | CT-AUTOFILL-001 | Done |
| BUG-008-VERIFY | REQ-AUTOFILL-001 | extension test/typecheck/build 与 docs gate | CT-AUTOFILL-001 | Done |

## 验收与证据

- 修复前：`autofill-page.test.ts` 的分步密码选择用例失败，实际消息缺少 `preserveExistingAccount`，随后 selection 路径会清空并重写账号。
- 修复后：`autofill-page.test.ts`、`form-discovery.test.ts`、`autofill-selection.test.ts` 和 `protocol.test.ts` 覆盖密码入口仅保留与候选匹配的非空账号、不同账号仍允许切换、消息 schema 拒绝非布尔意图、后台字段过滤保留密码但排除账号。
- `pnpm extension:test`：28 files / 173 tests passed。
- `pnpm extension:typecheck`：通过。
- `pnpm extension:build`：Chrome MV3 production build 通过；仅保留既有 chunk-size warning。
- `pnpm docs:check`：51 Markdown、21 YAML、27 requirements、65 test IDs、6 ADRs、6 routed Changes，通过。
- Apple 真实页面仍属于 `AT-AUTOFILL-001`，本次未执行发布安装环境的 Platform AT。

## 安全与数据生命周期

页面账号值不离开 content script；新增信息只有短生命周期布尔意图。Broker 仍是 secret assignment 所有者，assignment 继续绑定 origin/tab/frame/document/handle/expiry 并一次性使用；无 storage、日志、analytics、crash 或 clipboard 变化。

## 兼容与迁移

无 Vault format、payload、Browser RPC version、IPC、ABI、settings、pairing 或不可逆迁移。旧 background 会拒绝新增严格消息，重新加载同版本 extension 后恢复；回滚只恢复该重复填充缺陷。

## Bug 根因（仅 type=bug）

`BUG-2026-002` 覆盖了账号识别、隐藏密码排除和动态 rescan，但未覆盖密码步骤中的显式候选选择。当前 `shouldReplaceExistingFields("selection", "login")` 无法区分单页账号切换与分步密码入口，导致 `clearBeforeFill` 清空所有 login controls；Apple 对账号 input/change 事件回退到第一步。修复版本为 `0.1.0-development`，以失败回归、修复后自动化和适用 build 作为证据。
