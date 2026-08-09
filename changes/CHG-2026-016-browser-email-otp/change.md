# 插件显示并选择邮箱验证码

## 问题或目标

桌面端已经能够只读邮件并提取短时验证码，但浏览器插件尚不能在当前验证码页面完整展示这些候选。用户在网页点击“获取验证码”或“重新发送”后，应立即启动有界高频检查，并可从插件 popup 或验证码输入框右侧图标选择任意未过期邮箱候选填入验证码字段；事务邮件发件域名与业务网站经常不同，因此候选不按域名过滤。

用户已在当前任务中明确接受该交互；主规格已合并行为增量，本 Change 进入 Implementing。

## 预期行为

- `REQ-EMAIL-002`：受信任的获取/重发验证码点击立即检查一次，并刷新 90 秒、3 秒间隔的高频监听；重复点击重新计时，超时后回到普通轮询。
- `REQ-EMAIL-003`：独立解锁的插件 popup 和 OTP 字段页内列表在任意 HTTP(S) 网站显示全部未过期候选；用户选择后通过短时、单次、文档绑定 assignment 填入空 OTP 字段。
- 页面导航、候选过期、插件锁定、断开、撤销或 final lock 必须使候选/assignment 不可继续使用；所有路径都不得提交表单。

## 非目标

不自动点击网站按钮，不无限高频轮询，不支持 SMS OTP，不把验证码保存到 Vault、extension storage、通知正文、日志或 fill history，不自动选择/填入候选，也不覆盖非空字段。

## 影响范围

新增 Browser RPC v2 的 append-only 邮箱 OTP watch/candidate/fill operations，连接 Rust Email OTP service、broker policy、extension background/content script、页内候选和 popup。Vault format、Provider 权限、native host transport、KDF、ABI 和持久化格式不变。

## 实现约束

邮件 IO、Provider credential、邮件正文、候选集合和候选选择重验继续由 Tauri Rust runtime 拥有。Popup 或 closed shadow root 页内列表可以在组件内存显示全部未过期候选的有界 code/source/received/expiry 摘要；页内选择只向 background 发送 candidate ID，code 仅在 desktop 批准后的单次 assignment 中传递。候选界面关闭、锁定、导航、断开、失败或过期后清除。Discovery 不读取页面值，assignment 必须绑定 origin/tab/frame/document/handle/expiry 且只允许空 OTP 字段。任意已授权 HTTP(S) 页面显式打开候选 UI 后都能看到最近验证码是本 Change 接受的安全取舍。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| `TASK-CHG-016-001` | `REQ-EMAIL-002` | 获取/重发点击触发立即 scan 与 90 秒高频监听 | `CT-EMAIL-003` | Done |
| `TASK-CHG-016-002` | `REQ-BROWSER-002`、`REQ-EMAIL-003` | RPC schema/policy/broker/workflow parity 与全局未过期候选 | `CT-BROWSER-002`、`CT-EMAIL-003` | Done |
| `TASK-CHG-016-003` | `REQ-AUTOFILL-001`、`REQ-EMAIL-003` | popup/OTP 字段页内候选选择与一次性空 OTP assignment | `CT-AUTOFILL-001`、`CT-EMAIL-003` | Done |
| `TASK-CHG-016-004` | `REQ-EMAIL-003` | 自动化、构建和真实 Chromium/live Provider 验收 | `CT-EMAIL-003`、`AT-EMAIL-003` | In Progress（自动化与生产构建 Done；真实 Provider/Chromium AT Pending） |

## 验收与证据

- 自动化覆盖点击识别、立即检查、重复 boost、普通/高频间隔、跨站全局候选、候选过期、锁定清理、RPC policy/parity、popup/OTP 字段页内候选生命周期、仅 candidate ID 选择、空 OTP 字段填充、非空/非 OTP/跨 origin frame/导航/replay 拒绝和 no-submit。
- `AT-EMAIL-003` 在真实 Chromium 与至少一个真实只读 Provider 上验证点击、候选出现、选择填入、重发刷新、超时和锁定路径。

| Evidence ID | 日期 | 范围 | 证据 | 结果 |
| --- | --- | --- | --- | --- |
| `EVID-CHG-016-001` | 2026-07-24 | `TASK-CHG-016-001..004` automated；macOS 14.8.7 x86_64 | Rust Email OTP/domain/boost/segmented assignment/replay 与 broker policy tests 50/50；Tauri renderer/shared 16 files、63 tests；extension click/protocol/RPC/popup contract、目标表单 discovery 与既有回归 33 files、212 tests；Browser RPC v2 111/111 schema/policy/dispatcher/workflow parity 6/6；extension/Tauri typecheck、Rust Clippy `-D warnings`、`cargo fmt --check`、`pnpm docs:check`（62 Markdown、32 YAML）、extension production build 和最终 `pnpm tauri:build` 全部通过。Tauri 生成 macOS `.app` 与 12,740,467-byte x64 DMG，DMG SHA-256 `22a92cc69e6466a736414f978bb4a109f9215b84a27ac5eeafb9f098d53b4c69`。 | `CT-EMAIL-003`、`CT-BROWSER-002`、`CT-AUTOFILL-001` automated Pass；`AT-EMAIL-003` Not Run，Change 保持 Implementing |
| `EVID-CHG-016-002` | 2026-07-24 | `TASK-CHG-016-003..004` OTP 字段页内候选回归；macOS 14.8.7 x86_64 | OTP 字段图标将 origin-matched email candidate 合并进既有下拉，候选选择消息只含 UUID 并由来源 tab/origin 触发重新 discovery；菜单隐藏即卸载候选 DOM；定向 4 files、54 tests 与 extension 全量 33 files、215 tests 通过；extension typecheck、production build/zip、Browser RPC parity 6/6、`pnpm docs:check`（62 Markdown、32 YAML）通过。固定 manifest key 派生 Chrome ID `dmmjcaemejijgkpginfccokjmbknbgif`；Chrome zip 486,581 bytes，SHA-256 `f7acdb3c965d986738614bcce4f931ed0f53c6ac9a5dc22b8c5c513f9f44e6c3`。 | `CT-EMAIL-003`、`CT-AUTOFILL-001` automated Pass；`AT-EMAIL-003` 仍待真实 Provider/Chromium 验收，Change 保持 Implementing |
| `EVID-CHG-016-003` | 2026-07-24 | `TASK-CHG-016-002..004` 全局候选行为增量；macOS 14.8.7 x86_64 | Rust 证明同一未过期候选可在不同 HTTP(S) origin 列出和按 ID 选择，旧 `requireDomainMatch: true` 设置加载后归一为关闭，最终 assignment 仍 origin/tab/frame/document/handle/expiry 绑定；Rust 50/50、Tauri 16 files/63 tests、extension 33 files/215 tests、Browser parity 6/6、typecheck、Clippy `-D warnings`、fmt、docs check 与 production build 全部通过。固定 ID `dmmjcaemejijgkpginfccokjmbknbgif` 插件 zip 486,576 bytes，SHA-256 `0678eb645183a115d2da0db80c8a8a07b6621dfed0ca6a37924858d5bb3d6668`；Tauri x64 DMG 12,741,682 bytes，SHA-256 `dcdcf5ba0a6dba0f961d8f9881ee8cdb6a254feeaab85d5c902539e75d7233e1`。 | `CT-EMAIL-003`、`CT-BROWSER-002`、`CT-AUTOFILL-001` automated Pass；`AT-EMAIL-003` 仍待真实 Provider/Chromium 验收，Change 保持 Implementing |

## 安全与数据生命周期

验证码仍是 Rust-owned、memory-only、短时 secret。Provider token/app password、收件地址、subject、message ID 和邮件正文不进入 Browser RPC；候选 RPC 向任意已授权 HTTP(S) 页面返回全部未过期候选的有界摘要。Code 不进入 extension storage、持久化 UI state、通知、clipboard、audit、telemetry、日志或 crash data。Final lock 清除连接、boost 和候选；popup unmount 或页内菜单隐藏/导航清除本地候选。

## 兼容与迁移

Browser RPC 保持版本 2，只追加操作；不改变既有 wire envelope。新扩展连接旧桌面端会收到 unsupported operation 并隐藏候选，旧扩展连接新桌面端不调用新操作。无 Vault 或 Provider account 迁移；旧 `requireDomainMatch` 设置字段为兼容继续接受，但 runtime 归一为 `false` 且 UI 不再展示该开关。
