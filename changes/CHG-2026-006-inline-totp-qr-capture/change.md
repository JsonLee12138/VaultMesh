# 在网页内识别并保存 TOTP 二维码

## 问题或目标

VaultMesh 已能从扩展 popup 扫描当前页面的 `otpauth://totp` 二维码，并能把 TOTP
保存到 Login、生成当前验证码及填入 OTP 控件，但网页内没有贴近二维码的发现入口。
以 GitHub 两步验证页面为例，二维码由动态容器加载，用户必须离开当前交互上下文打开
popup，保存后当前 OTP 输入框的候选也不会主动刷新。

本变更目标是在可见的验证器二维码附近提供 VaultMesh 识别按钮，让用户在网页内把密钥
附加到一条现有 Login，并立即从同页 OTP 输入框选择该 Login 的当前验证码。

## 预期行为

- `REQ-ITEM-001`：content script 必须观察动态页面；当可见容器包含疑似验证器 QR 图像、
  canvas 或直接 `otpauth://totp` 值时，在不改变网站表单布局和提交行为的前提下显示
  “使用 VaultMesh”识别按钮。隐藏的 loading placeholder 不得产生可操作按钮。
- `REQ-AUTOFILL-002`：只有受信任 HTTP(S) 页面中的真实用户点击才可以启动目标 QR
  解码。解码成功后必须显示现有 Login 选择器，同 origin/path 候选优先；不得静默选择或
  新建 Login。
- `REQ-ITEM-001`：用户选择 Login 后必须把规范化的 TOTP URI 保存到该 Login。目标已有
  TOTP 时必须明确提示覆盖；取消、解码失败、锁定、导航、目标消失、重复点击和写盘失败
  都不得改变 Vault。
- `REQ-AUTOFILL-001`：保存成功后必须失效该文档内已有的 OTP 候选并重新查询 broker；
  用户点击下方 OTP 输入框的 VaultMesh 入口时，必须可以选择刚更新的 Login 并通过既有
  one-use assignment 填入当前验证码，且不得提交表单。
- `NFR-PRIV-001`：按钮和选择器必须挂载在隔离的 extension shadow root。TOTP URI 只可
  在 content script、background worker 和 desktop privileged mutation 的有界内存中短暂
  存在；不得写入 extension storage、页面 DOM attribute、日志、通知正文或非秘密设置。
- 一个页面存在多个 QR 时，按钮必须绑定被点击的目标，不得扫描后把另一个 QR 静默保存。
  非 TOTP、参数不受支持或超过现有限制的 URI 必须 fail closed。

## 非目标

- 不创建独立 `authenticator-key` Secret，不增加新的 Vault item kind。
- 不支持 HOTP、Steam、自定义 digits/period/algorithm，也不改变 core 当前支持的 TOTP profile。
- 不自动保存、不自动覆盖已有 TOTP、不自动提交网站的验证表单。
- 不从隐藏二维码、跨 origin 不可读图片、不可访问 closed shadow root 或 canvas-only 页面绕过
  浏览器安全边界读取内容。
- 不新增 Browser RPC operation；复用既有 `items.list`、`items.detail`、`items.update`、
  `browser.autofill.candidates` 和 `browser.autofill.execute`。

## 影响范围

- Extension content script：动态 QR 候选发现、隔离按钮/选择器、目标绑定、销毁与候选刷新。
- Extension background worker：验证 sender/tab/origin/document 上下文，短暂持有待附加 URI，
  调用现有 Login metadata/detail/update 操作并返回最小状态。
- Desktop broker/core：复用已有 TOTP normalization、原子 Login update 和 fill assignment；不增加
  新 RPC、持久化所有者或加密逻辑。
- Vault format、Browser RPC version、IPC、ABI、Email OTP、Passkey、SSH 和发布身份：无变化。
- 依赖：优先复用现有 `jsqr`、React 和 shadow-root inline autofill 基础设施，不新增依赖。

## 实现约束

- content script 不得直接持有 Vault Login detail 或执行 native RPC；所有 sender、tab、origin 和
  document 绑定在 background/broker 重新验证。
- 扫描必须由点击触发并优先限定到按钮绑定的 QR source；不得因 MutationObserver 对页面全部
  图片持续执行像素解码。
- 新的 content/background message 必须使用穷举 Zod schema、长度限制和拒绝路径测试。若实现
  需要新 Browser RPC operation，则本 Draft 必须重新评审，并同步 operation schema、policy、
  dispatcher、workflow manifest、Tauri parity 和 RPC version/compatibility 决策。
- `items.update` 必须保留目标 Login 的 password、URL、custom fields、policy 等未修改字段；底层
  原子持久化失败时保留旧文件和旧内存状态。
- 待处理 URI 必须绑定 tab、frame origin、document ID、QR target handle 和短 expiry；navigation、
  pagehide、extension lock/disconnect、成功、取消或超时必须清除。
- UI 复用现有 inline autofill 的最高层级定位、键盘可达性、escape/失焦关闭、resize/scroll 重定位
  和 destroy 语义，不能把网站事件处理器当成可信确认。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| `AUTH-010` | `REQ-ITEM-001`、`NFR-PRIV-001` | 动态、可见、目标绑定的 QR 识别入口与隔离 UI | `CT-AUTHENTICATOR-001` | Done |
| `AUTH-020` | `REQ-AUTOFILL-002`、`NFR-PRIV-001` | gesture/origin/document/expiry 绑定的扫描、Login 选择与覆盖确认 | `CT-AUTHENTICATOR-001` | Done |
| `AUTH-030` | `REQ-ITEM-001`、`NFR-REL-001` | 复用原子 Login update 保存 TOTP，完整处理取消/锁定/失败/重复 | `CT-AUTHENTICATOR-001` | Done |
| `AUTH-040` | `REQ-AUTOFILL-001` | 保存后 OTP inline candidates 刷新并经 one-use assignment 填入 | `CT-AUTHENTICATOR-001`、`AT-AUTOFILL-002` | Automated Pass / AT Pending |
| `AUTH-050` | `NFR-PRIV-001` | URI 不持久化、不记录，并在导航/锁定/超时/结束时清理 | `CT-AUTHENTICATOR-001` | Done |

## 验收与证据

- 自动化必须覆盖 GitHub 风格的初始 `hidden` loading placeholder、动态 QR 出现、单 QR、多 QR、
  非 TOTP QR、跨 origin 图片失败、扫描失败、目标被移除、重复点击和 SPA navigation。
- 自动化必须覆盖未解锁、无 Login、单/多候选、已有 TOTP 覆盖确认/取消、保存失败、原子回滚、
  expiry、frame/origin/document 不匹配和消息伪造拒绝。
- 自动化必须证明保存成功前 OTP 候选不变化，成功后同页 OTP 输入框可以选择更新后的 Login，
  生成值不返回 seed、填充不覆盖非空字段且不提交表单。
- 适用命令至少包括 `pnpm extension:typecheck`、`pnpm extension:test`、
  `pnpm extension:build`、`pnpm tauri:test`、`pnpm verify:browser-parity` 和 `pnpm docs:check`。
- `AT-AUTOFILL-002` 必须在受支持 Chromium 的真实 GitHub 2FA setup DOM 和一个通用动态 QR
  fixture 上执行；正式发布仍受现有 extension/host 安装签名 Gate 约束。

当前状态为 Implementing；Accepted 行为已合并到主规格和 Traceability，自动化实现已完成，
真实 Chromium AT 与下列 workspace baseline gate 尚未完成。

### 自动化证据

| Evidence | 日期 | 范围 | 结果 |
| --- | --- | --- | --- |
| `EVID-AUTH-001` | 2026-07-23 | `page-information-capture`、inline QR UI、bounded background registry、protocol、OTP candidate refresh、native disconnect 定向 Vitest | 6 files / 66 tests Pass |
| `EVID-AUTH-002` | 2026-07-23 | 标准 `pnpm extension:test` 与 `pnpm extension:typecheck` | 25 files / 161 tests Pass；TypeScript Pass |
| `EVID-AUTH-003` | 2026-07-23 | Extension TypeScript 与 Chrome MV3 production build | Pass；content script 545.05 kB、background 114.83 kB |
| `EVID-AUTH-004` | 2026-07-23 | Electron broker、共享 Browser RPC policy/workflow parity、native host、Tauri browser broker | Electron 35 files / 174 tests、parity 2/6、native host 13、Tauri broker 7 全部 Pass |
| `EVID-AUTH-005` | 2026-07-23 | 文档/YAML/Requirement/Test/ADR gate | `docs:check` Pass（43 Markdown、14 YAML、26 Requirements、64 Test IDs、5 ADRs） |
| `EVID-AUTH-006` | 2026-07-24 | 无 metadata hint 的 path-based inline SVG QR 发现、目标绑定解码与缺失静区兼容回归 | Extension 33 files / 216 tests、TypeScript、Chrome MV3 production build Pass；用户提供样例经临时像素栅格化与 `jsQR` 解码 Pass，未记录或持久化 URI |

执行期间并行的 copy-action 工作曾短暂缺少实现文件，现已由其所有者补齐；本变更没有修改
该工作。Electron/Native Preview parity owner 已由 `CHG-2026-008` 移除，当前共享 Tauri parity
2 files / 6 tests 通过。真实 Chromium `AT-AUTOFILL-002` 未完成，因此 Change 保持
Implementing，不标记 Verified。

## 安全与数据生命周期

页面本身拥有 QR 像素。用户点击后，content script 才把解码得到的 `otpauth://totp` URI 放入
内存并发给 background。background 只在 tab/frame origin/document/target/expiry 绑定的待处理
操作中持有它，选择 Login 后把 URI 交给 active desktop privileged process。core 规范化 seed，
并只在加密 payload 内持久化。扩展只接收 Login 安全摘要和最终状态；生成当前验证码仍沿用
既有有界 fill assignment，不返回 seed。所有取消、失败、锁定、断开、导航和超时路径清除待处理
URI，不写日志、storage、通知正文或页面 DOM。

## 兼容与迁移

无 Vault format/payload、Browser RPC、IPC 或 ABI 迁移。旧扩展没有页内入口，但 popup 扫描和
既有 TOTP 编辑/填充继续工作；回滚只需移除新增 content/background UI 路径，不影响已经保存的
Login TOTP。
