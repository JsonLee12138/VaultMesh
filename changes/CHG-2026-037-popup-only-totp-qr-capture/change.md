# 二维码识别仅由插件 Popup 主动触发

## 问题或目标

当前 content script 在识别到疑似 TOTP 二维码后，会在网页中自动插入“保存到 VaultMesh”按钮。
该入口干扰网站页面，并与“二维码识别必须由用户在插件内主动操作”的产品选择冲突。本变更移除
网页内按钮、菜单、观察器和后台 inline capture session，同时保留插件 popup 的当前页面识别与
Login 编辑器“从当前网页扫描验证器二维码”操作。

## 预期行为

- `REQ-ITEM-001`、`REQ-AUTOFILL-002`：content script 不得因为页面出现二维码而插入 VaultMesh
  按钮、菜单或其他 QR UI，也不得仅为 QR 发现持续观察页面；只有用户在插件 popup 主动发起
  当前页面识别或在 Login 编辑器点击扫描按钮后，才可以扫描当前 HTTP(S) 页面中的可见 TOTP QR。
- `REQ-ITEM-001`：识别结果只写入当前 Login 编辑草稿；目标 Login 已有 TOTP 时必须明确确认覆盖，
  最终仍由用户保存 Login 后生效。
- `NFR-PRIV-001`：识别出的 TOTP URI 只可在当前 popup 编辑状态和既有特权更新调用中短暂存在，
  不得进入网页 DOM、extension storage、日志、通知或非秘密设置；关闭 popup、取消编辑、锁定、
  失败或保存完成后不得保留额外 inline capture session。

## 非目标

- 不移除插件 popup 中的主动扫描按钮，不改变手工输入 TOTP URI/密钥的能力。
- 不修改已有 Login TOTP 数据、TOTP profile、OTP 填充或邮箱 OTP 行为。
- 不新增 Browser RPC operation、依赖、Vault item kind 或持久化格式。

## 影响范围

- Extension content script：停止初始化 inline TOTP controller，不再注入二维码浮层。
- Extension background/protocol：移除仅供网页内入口使用的 TOTP capture message/session。
- Extension popup：保留现有主动扫描、选择二维码、覆盖确认和 Login 保存流程。
- Desktop broker/core、Vault format、Browser RPC、IPC、ABI、Email OTP、Passkey、SSH：无变化。

## 实现约束

- 必须同时覆盖 Chromium MV3 与 Firefox MV2 的共享 WXT source。
- 删除 inline 路径后，popup 仍必须通过 `vaultmesh.scan-totp-qr` 请求扫描当前页面，并只接受
  受支持的 `otpauth://totp` 值。
- 不得以隐藏按钮代替删除注入路径；生产 content entrypoint 不得实例化 QR observer/controller。
- 回滚只恢复旧 inline 模块，不触及已有 Vault 数据。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| `POPQR-010` | `REQ-ITEM-001`、`REQ-AUTOFILL-002` | 移除网页内 QR 按钮、菜单和 controller 初始化 | `CT-AUTHENTICATOR-001` | Done |
| `POPQR-020` | `NFR-PRIV-001` | 移除 inline secret-bearing background session 和内部消息 | `CT-AUTHENTICATOR-001` | Done |
| `POPQR-030` | `REQ-ITEM-001`、`REQ-AUTOFILL-002` | 保留并验证 popup 主动扫描和 Login 草稿保存入口 | `CT-AUTHENTICATOR-001` | Done |

## 验收与证据

- 自动化必须证明 production content entrypoint 不引用 inline QR controller、浮层标记或 inline
  capture 消息，同时 popup Login 编辑器仍展示扫描按钮并发送 `vaultmesh.scan-totp-qr`。
- 适用命令：`pnpm extension:test`、`pnpm extension:typecheck`、`pnpm extension:build`、
  `pnpm --filter @vaultmesh/browser-extension build:firefox`、`pnpm docs:check`。
- 实现完成后在此记录可定位证据并封存 Work。

### 自动化证据

| Evidence | 日期 | 范围 | 结果 |
| --- | --- | --- | --- |
| `EVID-POPQR-001` | 2026-08-15 | Extension Vitest 与 TypeScript | `pnpm extension:test`：38 files / 226 tests Pass；`pnpm extension:typecheck` Pass |
| `EVID-POPQR-002` | 2026-08-15 | Chromium MV3 与 Firefox MV2 production build | 两套构建 Pass；production bundle 不包含 `startInlineTotpCapture`、`data-vaultmesh-totp-qr-trigger` 或 `vaultmesh.totp-capture.*` |
| `EVID-POPQR-003` | 2026-08-15 | Requirement、Test、路由与封存门禁 | `pnpm docs:check` Pass（99 Markdown、56 YAML、50 Requirements、124 Test IDs、17 ADRs） |

当前 Edge 现场仍加载旧扩展 bundle，刷新 `https://rcvps.cn/login` 后仍可见两个
`data-vaultmesh-totp-qr-trigger`。必须在扩展管理页重新加载新 build 后复测；在该现场证据通过前
本 Work 保持 `Implementing`，不得标记 `Verified` 或封存。

## 安全与数据生命周期

网页 QR 像素仍由网页拥有。只有 popup 内的用户点击才请求 content script 执行一次扫描；识别结果
仅保留在当前 React 编辑状态，用户确认保存时交给 desktop privileged `items.update`，由 core
规范化并写入加密 Login。删除的 inline registry 不再在 background worker 中持有 TOTP URI。

## 兼容与迁移

无 Vault format/payload、Browser RPC、IPC、ABI、settings 或 pairing 迁移。已有 TOTP 数据和 popup
扫描流程保持兼容；旧版扩展可能继续显示页内按钮，升级到新 bundle 并重新加载扩展后消失。
