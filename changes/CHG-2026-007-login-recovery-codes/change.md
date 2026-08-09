# 为 Login 保存并受控使用 2FA 恢复码

## 问题或目标

VaultMesh 可以在 Login 中保存 TOTP 密钥并生成验证码，但没有与该 Login 关联的 2FA 恢复码保存和使用入口。通用 Secret 的“恢复码”分类不能表达与 Login 的关联，也不保证每次使用都重新验证主密码。

## 预期行为

- `REQ-ITEM-001`：用户必须可以在 Login 新建或编辑页粘贴换行分隔的恢复码；空行被忽略，保存时保留每个非空码的原始内容，并原子持久化到加密 payload。
- `REQ-ITEM-001`、`NFR-PRIV-001`：Login summary/detail 只能返回是否存在恢复码，不得返回恢复码值。桌面端和插件查看全部恢复码或复制单个恢复码时，每次都必须输入并由 core 验证主密码，即使该 Login 未启用普通 re-prompt；插件复制只由桌面 Rust 写入带过期清理的系统剪贴板。
- `REQ-ITEM-001`：桌面 Login 新建/编辑和插件 Login 编辑必须可选择本地 UTF-8 文本文件；普通文本按换行解析，完整识别为 Google 编号双栏下载格式时忽略说明文字、拆分两列并按编号排序，再填入当前瞬时草稿。插件发起时必须先把桌面主窗口恢复、显示并聚焦到最前，文件框与删除确认框必须绑定主窗口。解析成功后必须立即弹出原生确认框；只有用户明确选择删除时才删除原文件，选择保留、取消、删除失败或文件在确认期间变化都不得删除。
- `REQ-BROWSER-002`、`NFR-PRIV-001`：插件文件选择必须通过需要 unlock、fresh gesture 和 command-bound confirmation 的固定 Browser RPC 系统对话操作。返回值只在当前 popup 编辑状态中短暂存在，不得包含本地路径或进入 extension storage。
- `REQ-BROWSER-002`、`NFR-PRIV-001`：插件查看和复制必须分别通过需要 unlock、fresh gesture 和逐次主密码 core re-auth 的固定 Browser RPC；查看响应只在当前 popup 内存短暂存在，复制响应不得包含恢复码值。
- `NFR-REL-001`：错误密码、取消、锁定、非法索引、非法输入或写盘失败不得返回恢复码、写入剪贴板或发布新的内存状态。
- `NFR-COMPAT-001`：旧 payload 缺少恢复码字段时必须按空列表读取；envelope format 保持 1。

## 非目标

- 不自动抓取网站页面上的恢复码，不把恢复码发送给 content script 或自动填充网页。
- 不跟踪恢复码是否已经在服务端使用，也不自动删除或轮换恢复码。
- 不新增 Vault item kind、Native ABI field 或 envelope format version；只新增三个有界 Browser RPC recovery-code operation。

## 影响范围

- Core：Login 增加 defaulted recovery-code collection、零化、兼容反序列化和强制主密码验证读取。
- Tauri：typed desktop operation adapter、Rust runtime 有界读取/复制路径和过期 clipboard。
- Tauri-owned renderer/shared contracts：Login 编辑入口、存在性提示、主密码确认和短时查看/单码复制。
- Tauri Rust runtime：有界文件选择、UTF-8/长度解析、原生删除确认、文件未变校验与删除结果。
- Extension/native host/Browser RPC：插件 Login 编辑器的瞬时文件导入、逐次复验查看/复制，以及 operation schema、policy、dispatcher、client、workflow manifest 和 parity。
- Native ABI、Email、Passkey、SSH、KDF 和 envelope header：无变化。

## 实现约束

- 恢复码 collection 最大 100 条；单码长度 1–256 字符；禁止空码，前后空白按用户输入保留，只有全空白行被丢弃。
- Core 是验证、持久化和读取策略唯一所有者；Tauri 只能转换 DTO、执行固定 operation 和受控 clipboard write。
- 编辑现有 Login 时未提交新恢复码必须保留旧值；明确移除才可清空。所有 mutation 继续先原子写盘成功再发布内存状态。
- reveal 响应只在当前 dialog 的组件状态中短暂存在；关闭、锁定、离开页面或验证失败必须清除。复制使用特权 clipboard service 及现有过期清理。
- 插件 reveal 与每次 copy 使用不同的新鲜请求和主密码输入；copy 由 Tauri Rust 直接写 clipboard，只向插件返回 `clearsAt`，不得复用 reveal 授权或回传被复制值。
- 恢复码文件上限 32 KiB，必须是普通 UTF-8 文件；允许首行 UTF-8 BOM。普通文本保留非空码内容；Google 格式只按结构识别 `N. DDDD DDDD` 条目，不依赖账户名、页面语言或真实值，编号必须从 1 连续且不得重复。两种格式都继续执行 100 条/256 UTF-16 code units 限制。文件内容、完整路径和摘要不得写入日志、DTO 或持久状态。
- 确认删除不是安全擦除；删除前必须重新读取并比对文件 SHA-256，变化、不可读或 `remove_file` 失败时保留文件并向当前 UI 返回非敏感状态。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| `RCV-010` | `REQ-ITEM-001`、`NFR-COMPAT-001` | defaulted/zeroized Login recovery-code model 与原子 CRUD/history | `CT-RECOVERY-CODES-001` | Done |
| `RCV-020` | `REQ-ITEM-001`、`NFR-PRIV-001` | summary/detail presence-only 与 core 强制主密码读取 | `CT-RECOVERY-CODES-001` | Done |
| `RCV-030` | `NFR-PRIV-001` | Tauri 固定 reveal/copy operation、Rust payload validation 与 capability 拒绝 | `CT-RECOVERY-CODES-001` | Done |
| `RCV-040` | `REQ-ITEM-001` | shared Login editor 保存、移除、验证、查看和单码复制 UI | `CT-RECOVERY-CODES-001`、`AT-RECOVERY-CODES-001` | Done |
| `RCV-050` | `REQ-ITEM-001`、`REQ-BROWSER-002`、`NFR-PRIV-001` | 桌面/插件恢复码文件选择、前台 parent 绑定、解析、确认删除和 RPC parity | `CT-RECOVERY-CODES-001`、`CT-BROWSER-002`、`AT-RECOVERY-CODES-001` | Done |
| `RCV-060` | `REQ-ITEM-001`、`REQ-BROWSER-002`、`NFR-PRIV-001` | 插件模态主密码弹窗逐次查看/单码复制、瞬时 popup 状态、Rust clipboard 和 107/107 RPC parity | `CT-RECOVERY-CODES-001`、`CT-BROWSER-002`、`AT-RECOVERY-CODES-001` | Done |
| `RCV-070` | `REQ-ITEM-001`、`NFR-PRIV-001` | Google 编号双栏下载文件的结构化提取、排序、说明过滤与不完整编号拒绝 | `CT-RECOVERY-CODES-001`、`AT-RECOVERY-CODES-001` | Done |

## 验收与证据

- 自动化必须覆盖 create/update/preserve/clear/history、旧 payload default、debug/DTO redaction、错误/缺失主密码、锁定、非法索引、输入上限和原子写盘回滚。
- Tauri contract 必须证明只有固定 operation 可读取值，summary/detail 不含 sentinel，复制走过期剪贴板路径。
- renderer contract 必须覆盖恢复码输入、存在性、每次操作要求主密码、取消/关闭清理和错误反馈。
- 插件 contract 必须证明查看与每次复制分别发送新鲜手势和主密码，查看不持久化，复制响应不回传 code 且只走 Rust 过期剪贴板。
- 文件导入自动化必须覆盖 UTF-8/BOM/CRLF、空文件、非 UTF-8、文件/条数/单码超限、选择取消、确认删除、选择保留、确认期间变化、删除失败、路径红线、插件发起时主窗口前台聚焦/原生 parent 绑定、插件瞬时状态和 Browser RPC parity。
- Google 下载格式自动化必须使用虚构值覆盖双栏拆分、按编号排序、说明文字过滤以及缺号/重复编号拒绝；不得读取或提交真实恢复码 fixture。
- 适用命令至少包括 `cargo fmt --all -- --check`、`cargo test -p vaultmesh-core -p vaultmesh-ffi`、`pnpm tauri:typecheck`、`pnpm tauri:test` 和 `pnpm docs:check`。

自动化证据：

| Evidence | 日期 | 范围 | 结果 |
| --- | --- | --- | --- |
| `EVID-RCV-001` | 2026-07-23 | core/FFI default、validation、redaction、逐次 re-auth、locked/unavailable、Tauri runtime 与原子回滚 | `cargo test -p vaultmesh-core -p vaultmesh-ffi` Pass |
| `EVID-RCV-002` | 2026-07-23 | Tauri typed adapter、shared contracts、renderer parsing/dialog contract | `pnpm --filter @vaultmesh/tauri-desktop typecheck`；14 files / 52 tests Pass |
| `EVID-RCV-003` | 2026-07-23 | Tauri Rust command/runtime、extension regression 与 Browser parity | `pnpm tauri:test`、`pnpm extension:typecheck`、`pnpm extension:test`、`pnpm verify:browser-parity` Pass |
| `EVID-RCV-004` | 2026-07-23 | 治理、生产前端和 macOS 开发构建产物 | `pnpm docs:check`、`pnpm --filter @vaultmesh/tauri-desktop build:web`、DMG checksum Pass；本地 `.app` 未签名，不能替代 packaged AT/发布签名验收 |
| `EVID-RCV-005` | 2026-07-24 | Rust 文件 UTF-8/BOM/CRLF/上限/symlink/未变删除、桌面 typed adapter/renderer、插件瞬时编辑与 105/105 RPC policy/owner/workflow parity | `cargo test -p vaultmesh-core -p vaultmesh-ffi`；`cargo test -p vaultmesh-tauri-desktop` 47 tests Pass；Tauri 16 files / 63 tests Pass；Extension 32 files / 205 tests Pass；typecheck、`pnpm verify:browser-parity`、extension production build、Tauri web build、`pnpm docs:check` Pass |
| `EVID-RCV-006` | 2026-07-24 | 插件恢复码文件对话框的主窗口 unminimize/show/focus 顺序、选择框与删除确认框 parent 绑定 | `cargo test -p vaultmesh-tauri-desktop` 48 tests Pass；`cargo fmt --all -- --check`、`pnpm docs:check` Pass |
| `EVID-RCV-007` | 2026-07-24 | 插件恢复码逐次主密码查看/复制、current-popup-only reveal、Rust expiring clipboard 与 107/107 RPC schema/policy/owner/workflow parity | `cargo test -p vaultmesh-tauri-desktop` 48 tests Pass；Tauri browser parity 2 files / 6 tests Pass；Extension 32 files / 207 tests Pass；extension typecheck Pass |
| `EVID-RCV-008` | 2026-07-24 | 插件恢复码查看/复制主密码输入改为 Base UI modal Dialog；关闭清理、busy 防误关和可访问标题 contract | Extension 32 files / 207 tests Pass；extension typecheck 与 production build Pass |
| `EVID-RCV-009` | 2026-07-24 | Google 编号双栏下载格式的虚构 fixture：说明过滤、双栏拆分、1→10 排序、缺号/重复拒绝；普通逐行/BOM/CRLF 回归 | `cargo fmt --all -- --check` Pass；`cargo test -p vaultmesh-core -p vaultmesh-ffi` Pass；`cargo test -p vaultmesh-tauri-desktop` 54 tests Pass；Tauri 16 files / 63 tests Pass；Tauri typecheck、`pnpm docs:check` Pass |

当前状态保持 Implementing；包含文件导入与插件路径的 `CT-RECOVERY-CODES-001`/`CT-BROWSER-002` 已通过，`AT-RECOVERY-CODES-001` 尚未在 packaged macOS/Windows 执行，因此不能标记 Verified。

## 安全与数据生命周期

恢复码从 renderer 编辑表单或受控文件操作经固定 typed operation 进入特权 runtime，并由 core 作为 Login 的受保护字段写入加密 payload。安全 summary/detail 只携带 `hasRecoveryCodes`。选中文件的完整路径和原始 bytes 只存在于单次 Rust 操作；插件只短暂接收解析后的 codes、basename 和删除状态，不向 content script 传递。查看时主密码和返回值只存在于单次调用及当前 dialog/popup 内存；每次复制重新输入主密码，由 Rust 直接把选定值写入受过期清理保护的系统剪贴板，插件只接收 `clearsAt`。主密码、恢复码和值的列表不得进入日志、analytics、crash、settings、extension storage 或持久化 UI state。

## 兼容与迁移

新增字段使用 empty-list default，旧 envelope format 1 可直接解锁。保存包含恢复码的 Vault 后，旧客户端仍能解密已知字段，但不能保留未知 recovery-code 字段，任何后续 Vault save 都可能丢弃恢复码；因此降级前必须先用新版客户端单独备份或移除恢复码。本变更不提升 envelope version 或 Browser RPC v2，只追加 `items.recovery-codes`、`items.copy-recovery-code` 和 `items.recovery-codes.import-file`；旧插件可继续使用原 workflow，新插件连接旧桌面时这些功能 fail closed 为 `unsupported-operation`。Native ABI 不变。
