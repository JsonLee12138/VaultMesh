# 统一 React 客户端反馈为顶部居中 Sonner toast

- Work ID：`CHG-2026-005-sonner-feedback`
- 类型：Feature
- 状态：Verified
- 主规格：`../../docs/03-functional-requirements.md`（`REQ-FEEDBACK-001`）

## 问题或目标

Electron React renderer 和 Chromium extension popup 的操作反馈同时使用内联 `Alert` 与 Sonner，
导致反馈位置、停留方式和视觉语义不一致。目标是把 React 客户端的瞬态通知统一为页面上方居中的
Sonner toast。

本 Change 由用户明确接受；行为增量已合并到 Scope、Requirement、测试计划和 Traceability，
现已完成实现与适用自动化验证。

## 预期行为

- `REQ-FEEDBACK-001`：React 客户端的成功、失败、警告和普通瞬态反馈必须通过 Sonner toast
  展示，并由客户端根 Toaster 统一放置在 `top-center`。
- 错误反馈必须使用 `toast.error`；成功反馈必须使用 `toast.success`；普通说明可以使用默认 toast。
- Toast description 必须使用客户端语义前景色，不得使用低对比度的默认灰色。
- 同一状态在未变化时不得因 React 重渲染重复弹出 toast。

## 非目标

- 不替换需要用户明确确认的 `AlertDialog`。
- 不移除表单字段的内联校验语义、`role="alert"` 或非通知用途的可访问性标记。
- 不改变 Vault、IPC/RPC/ABI、权限、业务操作结果或错误文案的所有权。

## 影响范围

- Electron/Tauri 复用的 React renderer：统一根 Toaster 位置并移除通知用途的内联 `Alert`。
- Chromium extension popup：增加 Sonner 依赖、根 Toaster 与 toast 触发。
- Core、bridge、native host、Vault format、Browser RPC、IPC/ABI、email/SSH/Passkey 安全边界：无变化。
- 依赖：extension 增加与 desktop 一致的 `sonner` 运行时依赖。

## 实现约束

- Toast 只能接收当前 renderer 已可见的安全反馈文本，不得加入 protected value、页面字段值或持久化状态。
- 状态驱动的 toast 必须在状态变化时触发，并在清除、卸载或重复执行时避免重复通知。
- `AlertDialog` 和字段级校验继续保留原有交互与可访问性。
- 不涉及迁移、回滚、过期凭据或锁定逻辑；依赖回滚只需恢复 React Alert 渲染与移除 extension 依赖。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| FEEDBACK-010 | REQ-FEEDBACK-001 | Electron/Tauri renderer Toaster 为 top-center，通知 Alert 改为 Sonner | CT-FEEDBACK-001 | Done |
| FEEDBACK-020 | REQ-FEEDBACK-001 | Extension popup 接入 top-center Toaster，通知 Alert 改为 Sonner | CT-FEEDBACK-001 | Done |
| FEEDBACK-030 | REQ-FEEDBACK-001 | 静态扫描、renderer/extension tests、typecheck/build 与 docs gate | CT-FEEDBACK-001 | Done |

## 验收与证据

- 自动化必须验证两个 React 根节点都挂载 `position="top-center"` 的 Toaster。
- 自动化或静态合约必须确认产品 React 源码不再导入通知 `Alert`，且保留 `AlertDialog` 与字段校验。
- Electron renderer 和 extension 的相关测试、typecheck、production build 及 `pnpm docs:check` 必须通过。
- 适用平台为 Electron/Tauri WebView renderer 与 Chromium MV3 popup；无 OS 签名或安装包变化。

| Evidence ID | 日期 | 范围 | 证据 | 结果 |
| --- | --- | --- | --- | --- |
| EVID-FEEDBACK-001 | 2026-07-22 | `CT-FEEDBACK-001`；macOS 14.8.7 x86_64 | 产品 React 源码静态合约确认无通知 `Alert` import/浏览器 `alert()`，保留 `AlertDialog`；desktop/extension 根 Toaster 均为 `top-center`，description production CSS 均生成 `text-foreground!`；`pnpm electron:typecheck`、Electron 35 files/174 tests、extension typecheck、22 files/141 tests、Chromium MV3 production build、desktop renderer production build、`pnpm tauri:typecheck`、38 Markdown/9 YAML docs check 通过 | Pass；`CHG-2026-005` Verified |

## 安全与数据生命周期

Toast 只展示原先已进入 renderer 的通知文本，不新增 secret owner、DTO 或日志。通知只存在于内存和 DOM，
由 Sonner 生命周期清理，不写入 storage、analytics、crash data、clipboard 或 Vault。

## 兼容与迁移

Vault format/payload、Browser RPC、Electron IPC、Native ABI、settings、pairing、upgrade/downgrade 均无变化。
回滚可恢复内联 React Alert 并移除 extension 的 Sonner 依赖，无数据迁移和不可逆影响。
