# HTTP 页面捕获使用兼容 UUID 生成器

## 问题或目标

最小复现：在 Chrome 打开普通 HTTP 登录页 `http://10.0.1.1/login.html`，VaultMesh 已注入且解锁，填写账号密码并提交。登录成功跳转到 `/`，但 content script 在创建 capture ID 时抛出 `TypeError: crypto.randomUUID is not a function`，因此没有向 background 发送 capture，也不会显示保存提示。

- Expected：符合 `REQ-AUTOFILL-002`，HTTP(S) 页面都能生成强随机 UUID 并进入同一 capture/Save/Ignore 流程。
- Actual：HTTP content context 缺少 secure-context-only `randomUUID()` 时捕获同步中断。
- 影响版本与 surface：`0.1.0-development` Chromium extension content script。

## 预期行为

- Content script 必须复用既有 `createUuid()`：优先原生 `crypto.randomUUID()`，不可用时以 `crypto.getRandomValues()` 生成 RFC 4122 v4 UUID。
- 保存捕获与页内 TOTP QR target handle 都不得直接依赖 HTTP 页面不保证提供的 `randomUUID()`。
- Background、popup 等 extension secure context 的 UUID 行为不变。

## 非目标

不改变账号新建/更新判定、capture expiry、Save/Ignore 语义、Vault format、RPC 或站点权限。

## 影响范围

Browser extension content UUID wiring 与回归测试。Desktop、native host、core、Vault format、RPC/IPC/ABI、依赖和发布策略无变化。

## 实现约束

Fallback 必须使用 CSPRNG `crypto.getRandomValues()`，不得使用 `Math.random()`、时间戳或页面数据；生成值必须通过现有 UUID schema。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| BUG-011-REPRO | REQ-AUTOFILL-002 | 缺少 `randomUUID` 的 HTTP content context 稳定复现提交中断 | CT-AUTOFILL-002 | Done |
| BUG-011-WIRE | REQ-AUTOFILL-002 | 保存 capture 与 TOTP handle 复用 `createUuid` | CT-AUTOFILL-002 | Done |
| BUG-011-VERIFY | REQ-AUTOFILL-002 | extension test/typecheck/build、docs gate 与真实 HTTP 登录证据 | CT-AUTOFILL-002 | Done |

## 验收与证据

- Chrome 真实复现日志：content script 在登录提交时抛出 `crypto.randomUUID is not a function`；登录本身成功跳转到 `/`，提示保持 idle。
- 修复前：`captures a submitted login when an HTTP content context has no crypto.randomUUID` 未发送 `vaultmesh.save-capture`，并捕获同一 `TypeError`。
- 修复后：该测试验证 deterministic `getRandomValues` fallback 生成合法 UUID 并发送 capture；既有 `uuid.test.ts` 同时覆盖原生和 fallback 路径，`inline-totp-capture` 也复用同一生成器。
- `pnpm extension:test`：28 files / 183 tests passed。
- `pnpm extension:typecheck`：通过。
- `pnpm extension:build`：Chrome MV3 production build 通过；仅保留既有 chunk-size warning。
- `pnpm docs:check`：54 Markdown、24 YAML、27 requirements、65 test IDs、6 ADRs、9 routed Changes，通过。
- 真实 Chrome HTTP 验收：用户在 `http://10.0.1.1/login.html` 重新登录并确认保存提示行为正常；测试凭据未写入仓库、日志或证据。

## 安全与数据生命周期

UUID 仅标识内存 capture/target，不包含凭据。Fallback 使用 CSPRNG；账号和密码仍只沿既有 transient capture 通道进入 background，不进入 DOM attribute、storage、日志、analytics 或 crash data。

## 兼容与迁移

无 Vault format、RPC、IPC、ABI、settings 或 pairing 迁移。更新 content script 后普通 HTTP 页面获得与 secure context 等价的 UUID v4 行为。

## Bug 根因（仅 type=bug）

仓库已经提供并测试 `createUuid()` 兼容封装，content entrypoint 和 form discovery 也已使用它；但 `autofill-page.ts` 的保存 capture 和 `inline-totp-capture.ts` 的 target handle 仍直接调用 `crypto.randomUUID()`。既有 jsdom 测试环境提供该方法，未覆盖普通 HTTP Chrome content context，因此遗漏了真实运行时失败。
