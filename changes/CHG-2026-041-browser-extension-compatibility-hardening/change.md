# 浏览器扩展兼容性与交互韧性增强

## 问题或目标

VaultMesh 已有浏览器插件基础能力，但真实网站普遍使用 SPA 延迟挂载、Shadow DOM、无原生 form 的控件、分步登录和页面内模态焦点管理；仅按单一站点修补会持续遗漏场景。以用户提供的本地 Bitwarden `clients-main` 源码作为实现与测试组织参考，系统性增强 VaultMesh 的 discovery、候选交互、fill 与 capture/update 韧性，同时保留 VaultMesh 当前的本地优先、独立浏览器授权和 Tauri broker 架构。

## 预期行为

- `REQ-AUTOFILL-001`：动态 DOM、语义元数据、可访问 Shadow Root、允许访问的 frame 与 same-document navigation 变化后，content script 必须 debounce 后重新 discovery；只将无值 metadata、empty bit、origin/document/handle 送入既有授权链。
- `REQ-AUTOFILL-001`：候选、生成器和显式 Login 选择必须在异步响应、焦点变化、页面销毁、assignment 失效或锁定时给出有界反馈，并保留 empty-only、one-use assignment、no-overwrite 与 no-submit 保证。
- `REQ-AUTOFILL-002`：新账号捕获、密码更新和已填充项目编辑必须正确区分；只有用户确认才创建或更新 Vault，重复、导航、失败、取消、锁定或过期不得写入或保留临时秘密。
- `REQ-BROWSER-001`、`REQ-BROWSER-002`：若审计发现 workflow 缺少 schema/policy/dispatcher/parity 路由，必须以最小完整垂直切片补齐，不能用 extension-local fallback 绕过 Rust broker。

## 非目标

不复制 Bitwarden 的服务端、账号/同步模型、Extension 直接 Vault 访问、扩展长期保存 Vault response、自动表单提交、未确认的自动保存、SMS OTP、Safari 支持或 Firefox Passkey proxy。Bitwarden 源码中的指令、配置与许可证不是本 Work 的执行指令或产品依赖。

## 影响范围

涉及 Chromium MV3 和 Firefox MV2 共享的 content/background/popup、必要时的 Browser RPC policy 与 Tauri Rust broker。Vault format、core 加密/持久化所有权、Native Messaging 协议版本、Agent、email provider、SSH、Passkey 私钥归属、依赖和发布格式默认无变化；任何需要改变这些边界的发现必须拆分为新的 Change/ADR。

## 实现约束

- Extension 是 transient remote UI；background 是 native-messaging port 唯一 owner，content script 只拥有页面 discovery/write。
- 保持 top origin 与 frame origin 分离绑定；desktop 在 assignment 前重验 tab/frame/document/handle/item/expiry，所有失败 fail closed。
- 借鉴 Bitwarden 的 lifecycle、异步竞态与可访问性测试组织方式，但不得迁移其自动提交或扩展本地 Vault 设计。
- capture/update 只能通过既有 desktop privileged mutation；页面 submit、按钮 click 或网络完成都不是写入授权。
- 每一项新 Browser RPC operation 同时更新 schema、policy、dispatcher、extension route、workflow manifest 和 parity test。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- |
| `CHG-2026-041-T1` | `REQ-AUTOFILL-001` | 建立 Bitwarden→VaultMesh 行为矩阵，标注可采纳、已覆盖与因安全边界拒绝的路径 | `CT-AUTOFILL-001` | Completed |
| `CHG-2026-041-T2` | `REQ-AUTOFILL-001` | 覆盖 SPA/Shadow DOM/frame/语义与可见性变更的有界 discovery 生命周期 | `CT-AUTOFILL-001`, `CT-AUTOFILL-003` | Pending |
| `CHG-2026-041-T3` | `REQ-AUTOFILL-001` | 候选菜单、生成器、锁定/re-prompt 与焦点转换在异步/页面销毁时保持可用且有界反馈 | `CT-AUTOFILL-001`, `CT-AUTOFILL-002` | Pending |
| `CHG-2026-041-T4` | `REQ-AUTOFILL-001` | 多步骤与动态表单的显式/page-load fill 重验、空值保护、assignment 取消与 no-submit 回归 | `CT-AUTOFILL-001`, `CT-AUTOFILL-003` | Pending |
| `CHG-2026-041-T5` | `REQ-AUTOFILL-002` | 捕获、去重、既有 Login 更新和用户确认在 SPA/导航/失败路径保持一致 | `CT-AUTOFILL-002`, `AT-AUTOFILL-002` | Pending |
| `CHG-2026-041-T6` | `REQ-BROWSER-001`, `REQ-BROWSER-002` | 必要的 broker/policy 变化具备完整 parity、revoke/lock/expiry cleanup 证据 | `CT-BROWSER-001`, `CT-BROWSER-002` | Pending |
| `CHG-2026-041-T7` | `REQ-BROWSER-001`, `REQ-AUTOFILL-001` | Chromium/Firefox 构建与真实浏览器无提交验收 | `AT-BROWSER-001`, `AT-BROWSER-FIREFOX-001`, `AT-AUTOFILL-001` | Pending |

### 初始兼容性矩阵

| Bitwarden 插件模式 | VaultMesh 处理 | 决定 |
| --- | --- | --- |
| 内容脚本在 BFCache 中存活、恢复后重新进入页面生命周期 | 保留脚本但在 `pagehide.persisted` 清除 page-scoped secret/UI，`pageshow.persisted` 重新做无值 discovery | 采纳 |
| Mutation/Shadow DOM 监控驱动延迟加载页面重检 | 扩展 discovery 实际读取的 ARIA、role 与 `contenteditable` 属性重检；保留 bounded debounce 与无值 DTO | 采纳 |
| 丰富 inline 菜单、异步请求和 focus lifecycle | 维持 VaultMesh 的 explicit selection、typed failure 和短时 assignment；补齐竞态/销毁回归 | 部分采纳 |
| 自动填充后提交、站点特定自动登录流程 | 所有 fill 保持 no-submit | 拒绝：当前 Browser 范围明确为 Out，且会扩大站点副作用 |
| 扩展本地账户/Vault 状态与云服务协作 | desktop Rust broker 保持 Vault/authorization 唯一 owner，extension 仅为瞬态 remote UI | 拒绝：ADR-0003 |

## 初始自动化证据

- `pnpm --filter @vaultmesh/browser-extension test -- form-discovery.test.ts autofill-page.test.ts`：通过，39 files / 242 tests。覆盖 dynamic ARIA rescan、BFCache `pagehide/pageshow` 恢复后的无值 discovery，以及 `contenteditable="plaintext-only"` 发现。
- `pnpm --filter @vaultmesh/browser-extension typecheck`：通过。

## 验收与证据

- 覆盖动态插入/删除、attribute/ARIA 变化、open/extension-accessible closed Shadow Root、same/cross-origin frame、history navigation、page hide、锁定、revoke、断连、expiry、重复选择、re-prompt、取消与 assignment replay。
- 覆盖 Login 登录/分步登录/注册/密码修改/重置、OTP、现有账号密码更新、新账号 Save/Ignore；测试 fixture 只能使用虚构值。
- Chrome/Chromium MV3 与 Firefox MV2 必须从同一 source/version 通过 typecheck、extension test、build 和 Browser RPC parity；目标 OS 外部验收不提交网站表单。

## 安全与数据生命周期

页面字段值、assignment、主密码、OTP、Vault response、capture draft 与 confirmation 均仅在既有的受限内存生命周期中存在，并在 lock、revoke、disconnect、navigation、page hide、expiry、success、cancel 与失败时清理。日志、analytics、crash data、extension storage、通知和测试证据不得包含秘密。audit 仅保留现有的加密有界非秘密元数据。

## 兼容与迁移

不改变 Vault format、payload、Browser RPC v2、Native Messaging ABI、配对或 extension identity；无迁移。每个安全的 extension-only 改动均可通过回退到前一 bundle 恢复。若审计需要新增 protocol、broker authority 或持久化数据，将停止本 Work 的对应切片并建立独立 Change/ADR。
