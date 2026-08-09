# 原生桌面客户端增量迁移计划

- Work ID：`CHG-2026-002-native-desktop-migration`
- 类型：Migration
- 状态：Rejected（被 `CHG-2026-004-tauri-desktop-migration` 取代；保留历史证据）
- 主规格：`../../specs/native-desktop-migration.md`
- 决策：`../../adr/0004-incremental-native-migration.md`
- 平台顺序：macOS first，Windows second（`OPEN-002` 已关闭）
- 当前任务：`NDM-050` Native browser broker、host、独立授权与 RPC v2 parity（104/104 自动化通过，`AT-BROWSER-001` 待执行，In Progress）
- 并行门禁：`NDM-040` automated pass；`AT-NATIVE-MACOS-003` 因当前主机无 Touch ID 且无合成测试数据延期
- macOS 工具链：`NDM-ENV-001` 已关闭；Developer ID/notarization 仍属于发布门禁
- Windows 阻塞：安全切片仍受 `OPEN-001` 阻塞

## 问题或目标

Electron 是当前 macOS/Windows 的可运行参考客户端，但其内置 Chromium
带来体积和资源成本。目标是在不改变 Vault 格式、不削弱现有安全边界、
不停止 Electron 交付能力的前提下，逐个垂直切片建立 SwiftUI/AppKit 与
WinUI 3 客户端。

本 Change 是迁移总计划和证据入口。平台顺序与第一切片已经接受：立即以
macOS 为第一平台，在 ABI contract 冻结后实现 create/unlock/status/lock；
Windows 在 macOS 核心闭环后推进。该计划已通过 Accepted 门禁并进入 Implementing，
允许准备和实施已定义切片，
但不绕过任务自身的 ABI、工具链、安全和平台验收门禁。

## 预期行为

- Electron 必须在迁移期继续作为行为和安全参考客户端。
- 原生客户端必须通过 `vault-ffi` 使用 `vault-core`，不得复用
  `electron-bridge` 或复制加密、格式、session 逻辑。
- macOS 默认只使用 Native Preview 自有 Application Support Vault：没有文件时创建，
  已存在时直接进入解锁；默认 UI 不提供路径选择或打开其他 Vault。
- 首个 lifecycle preview 使用单内容窗口，不显示没有实际导航作用的侧边栏。
- Lifecycle 表单限制最大内容宽度并在可用窗口中双向居中；窗口过小时保留安全边距
  和垂直滚动，不通过无限拉伸填满大窗口。
- 密码派生与 Vault 文件 I/O 必须在串行后台执行，MainActor 只发布进行中状态和最终
  结果；操作期间不得重复提交。
- 每个垂直切片必须同时具备跨语言 contract test、失败/锁定路径、secret
  destruction 路径和目标平台验收证据，才可以标记完成。
- 未达到功能、安全、Browser RPC、打包、升级和回滚 parity 前，不得替换
  默认桌面客户端或删除 Electron。
- 用户可观察结果继续由关联 Requirement 所有；迁移机制由主规格和
  `ADR-0004` 所有，本 Change 不建立重复规则。

## 非目标

- 不创建无法端到端运行的完整 UI 空壳。
- 不改变 Vault format、payload、KDF、Browser RPC v2 或现有 Electron IPC。
- 不把 SwiftUI 与 WinUI 做成像素相同；两端必须遵循各自平台行为，同时
  保持产品流程、数据语义和安全门禁一致。
- 不把 Linux、mobile、web client 提升为当前范围。

## 影响范围

| Surface | 影响 |
| --- | --- |
| Core | 继续由 `vault-core` 唯一拥有；只有跨平台需要且不依赖 UI 的能力可以进入 core |
| Native ABI | 需要定义 version、ownership、allocation、error、panic、zeroization 和并发规则 |
| macOS | 新增 SwiftUI presentation、AppKit adapter、Keychain/LocalAuthentication、生命周期和签名链路 |
| Windows | 新增 WinUI 3 presentation、DPAPI/Windows Hello、生命周期和安装链路 |
| Electron | 保持可构建、可测试、可打包；作为 parity oracle，不被原地改造成 native shell |
| Browser | Native broker 与 host 注册必须保持 RPC v2、配对、独立授权和撤销语义 |
| Vault format | 本计划不改变；若后续切片需要变化，必须建立独立 Change/ADR 和格式迁移 Gate |
| Release | 两个平台必须分别在目标 OS 完成签名、安装、升级、卸载和回滚验收 |

## 实现约束

- FFI 必须 operation-oriented，不暴露 Rust layout 或让 panic 跨边界传播。
- 每个跨 FFI allocation 必须有唯一 owner 和 matching destroy operation；
  secret-bearing buffer 必须明确何时清零。
- Native UI state/restoration、日志、crash data 和非秘密 settings 禁止持久化
  decrypted record、主密码、Vault Key 或受保护字段。
- Vault mutation 必须继续满足 `NFR-REL-001`：文件提交成功后才能发布新状态。
- Native preview 必须使用独立 app/package ID、user-data、browser-host ID 和
  installer target；实现并验证跨进程锁前不得与 Electron 同时写同一 Vault。
- 每一阶段必须保持 `pnpm electron:test`、`pnpm electron:typecheck` 和适用
  Browser parity Gate 通过，不能以原生迁移为由降低现有断言。

## 决策与阻塞

| ID | 必须决定的事项 | 当前状态 | 阻塞范围 | 关闭条件 |
| --- | --- | --- | --- | --- |
| `OPEN-001` | Windows quick unlock 使用 DPAPI only 或 DPAPI + Windows Hello | Open | Windows platform-security/release | 安全方案被接受并进入对应 Requirement/AT |
| `OPEN-002` | 首个平台、启动时间和平台顺序 | Closed 2026-07-22 | 无 | 立即以 macOS 为第一平台；第一切片为 create/unlock/status/lock；Windows second |
| `NDM-DEC-001` | ABI request/response 表示、allocator 与错误模型 | Closed 2026-07-22 | 无 | ABI v1 contract design、C header、Swift binding、`CT-NATIVE-ABI-001` 和 `CT-NATIVE-MEMORY-001` 通过 |
| `NDM-DEC-002` | Native/Electron 跨进程 Vault 写锁策略 | Pending | 并行预览和迁移回滚 | 竞争、崩溃恢复、陈旧锁和只读拒绝行为被规格化并测试 |
| `NDM-ENV-001` | 完整 Xcode 与 macOS App build/ad-hoc sign 工具链 | Closed 2026-07-22 | 无 | Xcode 16.2（16C5032a）已选择；first-launch、SDK、SwiftUI typecheck、`codesign` 通过。Developer ID/notarization 仍属于 M3/M4 发布门禁 |

## 阶段与任务

状态只使用 `Done`、`Pending`、`Blocked`、`In Progress`。`Done` 必须在下方
证据表存在可定位记录；阶段完成不自动推进 Change 状态。

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| NDM-000 | NFR-COMPAT-001 | Reserved roots、独立 `vault-ffi` ABI probe、命令分组、Spec/ADR/Change 入口 | CT-COMPAT-001 | Done |
| NDM-010 | NFR-COMPAT-001, NFR-PRIV-001 | 冻结 ABI ownership/error/panic/zeroization contract | CT-NATIVE-ABI-001, CT-NATIVE-MEMORY-001 | Done |
| NDM-020 | REQ-VAULT-001, NFR-REL-001 | macOS create/unlock/status/lock 端到端切片及错误、重复、MainActor 响应、最终锁清理 | CT-NATIVE-VAULT-001, CT-NATIVE-RESPONSIVENESS-001, AT-NATIVE-MACOS-001 | Done |
| NDM-030 | NFR-PRIV-001 | 安全 summary/detail list；protected value 不进入普通 DTO/UI state | CT-PRIV-001, CT-NATIVE-MEMORY-001, AT-NATIVE-MACOS-002 | Done |
| NDM-040 | REQ-SEC-002 | privileged copy/reveal、clipboard expiry、secure storage、biometric 和 lifecycle | CT-SEC-002, CT-NATIVE-PRIVILEGED-001, CT-NATIVE-QUICK-UNLOCK-001, CT-NATIVE-CLIPBOARD-001, AT-SEC-001, AT-NATIVE-MACOS-003 | In Progress |
| NDM-050 | REQ-BROWSER-001、REQ-BROWSER-002、REQ-AUTOFILL-001、REQ-AUTOFILL-002、REQ-PASSKEY-001、REQ-IMPORT-001 及 RPC CRUD 对应 Requirement | Native broker/host、pair/revoke、独立授权、全部 104 RPC v2 route；自动化 parity 已完成，packaged/browser AT 待执行 | CT-BROWSER-001, CT-BROWSER-002, CT-NATIVE-BROWSER-001, 相关 Autofill/Passkey/Import CT, AT-BROWSER-001 | In Progress |
| NDM-060 | NFR-COMPAT-001 | 第二平台达到相同功能和安全切片；平台差异有显式 adapter/AT | CT-COMPAT-001，加目标平台 Test ID | Pending |
| NDM-070 | 全部关联 Requirement | 签名安装包、upgrade/rollback、文件锁、性能基线和 release candidate 证据 | 适用 CT/AT 集合 | Pending |
| NDM-080 | 全部关联 Requirement | 单独决策是否切换默认客户端；Electron 删除必须另建 removal Change | 全部适用 Gate | Pending |

## 里程碑门禁

### M0 — 基线可维护

- Reserved roots、`vault-ffi` probe、命令和文档入口存在。
- Electron 与 Rust 现有自动化保持通过。
- 完成状态：Done；证据见 `EVID-NDM-000`。

### M1 — 首个切片可以实施

- `OPEN-002` 已关闭，Change 已通过 Accepted 门禁并进入 Implementing。
- ABI contract、生成/绑定方式和 Native Test ID 已冻结。
- 完整 Xcode、macOS app build/ad-hoc sign 和平台验收环境可用（已满足）。

### M2 — 首个平台核心闭环

- Create/unlock/status/lock 在真实原生 UI、FFI 和加密文件之间端到端工作。
- Wrong password、重复 lock、IO failure、panic containment 和 secret destroy 有证据。
- Electron reference tests 无回归。
- 完成状态：Done；自动化与平台验收证据见 `EVID-NDM-004` 至 `EVID-NDM-009`。

### M3 — 首个平台功能与 Browser parity

- 当前 Required desktop workflow 按切片完成，不以 UI mock 计数。
- Browser native messaging、独立 authorization、final-lock cleanup 达到 parity。
- 打包、签名、安装、升级和卸载在目标 OS 验收。

### M4 — 双平台 Release Candidate

- macOS 与 Windows 分别完成所有适用 Gate；`OPEN-001` 已关闭。
- 跨进程锁、旧 Vault、backup/restore、rollback compensation 已验证。
- Release record 可以引用完整 CT/AT、build 和签名证据。

### M5 — 默认客户端切换评审

- 切换默认客户端必须另建 Accepted Change，定义升级、并存、回滚、数据目录
  和浏览器 host 迁移。
- 删除 Electron 必须是更晚的独立 removal Change，且只能在已发布 native
  版本具备可验证回滚路径后进行。

## 验收与证据

| Evidence ID | 日期 | 范围 | 证据 | 结果 |
| --- | --- | --- | --- | --- |
| EVID-NDM-000 | 2026-07-22 | Phase 0 baseline | `pnpm docs:check`；Rust core/FFI fmt、check、25 tests；Electron typecheck、34 files/170 tests；Browser parity 2 files/6 tests | Pass |
| EVID-NDM-001 | 2026-07-22 | Platform decision/environment | 用户确认 macOS first；本机 x86_64 macOS 14.8.7、Swift 6.0.3；`xcodebuild` 报告仅 Command Line Tools、缺少完整 Xcode | Decision accepted；environment blocked |
| EVID-NDM-002 | 2026-07-22 | macOS toolchain | `xcodebuild -version` = Xcode 16.2 / 16C5032a；developer directory = `/Applications/Xcode.app/Contents/Developer`；first-launch status exit 0；macOS 15.2 SDK；SwiftUI typecheck exit 0；`codesign` 可定位 | Pass；`NDM-ENV-001` closed |
| EVID-NDM-003 | 2026-07-22 | ABI v1 contract；macOS 14.8.7 x86_64；Swift 6.0.3 | `pnpm docs:check` = 28 Markdown/5 YAML；`cargo fmt --all -- --check`、`cargo check -p vaultmesh-core -p vaultmesh-ffi` 通过；`cargo test -p vaultmesh-core -p vaultmesh-ffi` = core 24 + FFI 8 passed；`pnpm native:macos:contract-test` 由 `swiftc` 导入 `vaultmesh.h`、链接实际 Rust dylib并执行 version/mismatch/buffer/invalid-argument probe | Pass；`CT-NATIVE-ABI-001`、`CT-NATIVE-MEMORY-001`；`NDM-DEC-001` closed |
| EVID-NDM-004 | 2026-07-22 | macOS lifecycle automated slice；macOS 14.8.7 x86_64；Xcode 16.2 / Swift 6.0.3 | `cargo test -p vaultmesh-ffi` = 11 passed，覆盖 create/status/repeated lock/wrong password/unlock/repeated destroy/I/O failure/0600/ABI mismatch；FFI `clippy --no-deps -D warnings` 通过；`pnpm native:macos:contract-test` static-link lifecycle probe 通过；Debug 与 Release `pnpm native:macos:build*` 均 `BUILD SUCCEEDED` 且 strict ad-hoc `codesign --verify` 通过；Release entitlements 只有 App Sandbox + user-selected read/write，未注入 `get-task-allow`；Debug app 经 LaunchServices 启动并正常退出；core 24 tests、Electron typecheck、34 files/170 tests、Browser parity 2 files/6 tests 通过 | Automated Pass；`CT-NATIVE-VAULT-001` Pass；`AT-NATIVE-MACOS-001` 仍 Not Run |
| EVID-NDM-005 | 2026-07-22 | macOS 默认单 Vault lifecycle；macOS 14.8.7 x86_64；Xcode 16.2 / Swift 6.0.3 | 默认 UI 已移除 `NSOpenPanel`、`NSSavePanel`、路径显示和“打开其他 Vault”；启动只检测 App Sandbox Application Support 默认文件并分流 create/unlock；FFI duplicate create 返回 `VAULTMESH_STATUS_VAULT_EXISTS`，Rust 与 Swift lifecycle contract 均验证原文件仍可用原密码解锁；`cargo test -p vaultmesh-ffi` = 11 passed，FFI `clippy --no-deps -D warnings`、static-link contract、Debug/Release build、strict ad-hoc `codesign --verify` 通过；Release entitlement 仅 App Sandbox；Debug app 经 LaunchServices 启动并正常退出；`docs:check` = 29 Markdown/5 YAML，core 24 tests、Electron typecheck、34 files/170 tests、Browser parity 2 files/6 tests 通过 | Automated Pass；`CT-NATIVE-VAULT-001` Pass；`AT-NATIVE-MACOS-001` 仍 Not Run |
| EVID-NDM-006 | 2026-07-22 | macOS lifecycle 单内容窗口；macOS 14.8.7 x86_64；Xcode 16.2 / Swift 6.0.3 | 移除 `NavigationSplitView`、sidebar list 与两个占位导航项；默认窗口由 820×560 收敛为 620×480；源码扫描确认没有 sidebar/navigation placeholder；Debug 与 Release build、ad-hoc 签名验证通过；Debug app 经 LaunchServices 启动并正常退出；Electron typecheck、34 files/170 tests、Browser parity 2 files/6 tests 通过 | Automated Pass；无侧边栏的实际视觉与交互仍由 `AT-NATIVE-MACOS-001` 验收 |
| EVID-NDM-007 | 2026-07-22 | macOS lifecycle MainActor 响应性；macOS 14.8.7 x86_64；Xcode 16.2 / Swift 6.0.3 | blocking FFI 与 opaque handle 移入专用串行 `VaultWorker`；controller 只在 MainActor 发布 creating/unlocking/locking 和最终状态；UI 使用原生 indeterminate progress 并拒绝重复提交；scene inactive 可使 pending unlock 结果失效并在 worker 队列后锁定；Debug 只优化 Argon2/Blake2 implementation、KDF 仍为 64 MiB/3 iterations，三次 KDF lifecycle 从 4.80s 降至 0.28s；`CT-NATIVE-RESPONSIVENESS-001` 验证 MainActor submission <50ms、heartbeat <100ms、最终 unlock 和 pending-unlock lock；Rust core 24 + FFI 11 tests、FFI clippy、Swift static-link contract、Debug/Release Xcode build、strict codesign、Debug LaunchServices smoke、Electron typecheck、34 files/170 tests、Browser parity 2 files/6 tests、29 Markdown/5 YAML docs check 全部通过 | Automated Pass；`CT-NATIVE-RESPONSIVENESS-001` Pass；实际窗口操作丝滑度仍由 `AT-NATIVE-MACOS-001` 验收 |
| EVID-NDM-008 | 2026-07-22 | macOS lifecycle responsive layout；macOS 14.8.7 x86_64；Xcode 16.2 / Swift 6.0.3 | lifecycle 内容拆分为最大 520 pt 的 content column；全窗口 `GeometryReader` + vertical `ScrollView` + 对称 flexible spacing 保持水平/垂直居中，32 pt 安全边距在小窗口中保留可访问滚动；冗余的 Native Preview 容器/文件路径和“本机默认保险库”说明已从界面移除；Swift static-link lifecycle/responsiveness contract、Debug/Release Xcode build、strict codesign、Debug LaunchServices smoke、Electron typecheck、34 files/170 tests、Browser parity 2 files/6 tests、29 Markdown/5 YAML docs check 通过 | Automated Pass；实际放大/缩小窗口的视觉位置仍由 `AT-NATIVE-MACOS-001` 验收 |
| EVID-NDM-009 | 2026-07-22 | `NDM-020` macOS interactive lifecycle acceptance；当前验收主机 macOS 14.8.7 x86_64；VaultMesh Native Preview Debug build | 用户确认已完成 `AT-NATIVE-MACOS-001` 清单，覆盖无侧边栏/无路径选择的默认单 Vault 流程、窗口缩放居中与滚动、创建、错误/正确密码解锁、操作响应性、重复提交拒绝、scene inactive 自动锁定、重启后默认 Vault 检测及敏感信息不展示 | Pass；`AT-NATIVE-MACOS-001` Pass；`NDM-020` Done；M2 Done |
| EVID-NDM-010 | 2026-07-22 | `NDM-030` safe item metadata automated slice；macOS 14.8.7 x86_64；Xcode 16.2 / Swift 6.0.3 | ABI v1 append-only 增加五类 item kind、safe list/detail JSON schema 和 not-found status；Rust contract 以运行时合成 Vault 为 password、TOTP、login custom field、card number/CVC/PIN、SSH password/public/private key/passphrase、developer secret 放置 sentinel，并验证 list 与每类 detail 均不泄漏；locked/not-found/invalid kind/UUID/ABI/non-empty out-buffer fail closed；Swift static-link contract 解码真实 empty list、destroy buffer 并验证 lock 后 empty output/UI state；core 24 + FFI 13 tests、FFI clippy、Debug/Release Xcode build、strict ad-hoc codesign、Electron typecheck、34 files/170 tests、Browser parity 2 files/6 tests 通过 | Automated Pass；`CT-PRIV-001`、`CT-NATIVE-MEMORY-001` Pass；`AT-NATIVE-MACOS-002` Not Run；`NDM-030` 保持 In Progress |
| EVID-NDM-011 | 2026-07-22 | `NDM-030` macOS safe item metadata interactive acceptance；当前验收主机 macOS 14.8.7 x86_64；VaultMesh Native Preview Debug build | 用户确认 `AT-NATIVE-MACOS-002` 通过；验证解锁后的真实 item list/empty state、详情布局与 protected-field presence、锁定后的 list/detail 清除和返回 lifecycle；验收反馈移除了列表底部冗余“保险库已解锁”提示，并把侧边栏宽度约束为 minimum 260 / ideal 300 / maximum 380 pt；五类非空 response 的 protected-value redaction 继续由 `EVID-NDM-010` 的合成 sentinel ABI contract 证明 | Pass；`AT-NATIVE-MACOS-002` Pass；`NDM-030` Done |
| EVID-NDM-012 | 2026-07-22 | `NDM-040` automated privileged access/platform security slice；macOS 14.8.7 x86_64；Xcode 16.2 / Swift 6.0.3 | ABI v1 append-only 增加 field-scoped protected-value、quick-key export/unlock、re-auth/value-unavailable status；Rust runtime synthetic contract 覆盖 login/TOTP/card/SSH/secret、re-prompt、wrong password、invalid combination、lock、32-byte quick-key round trip 和 failure output；Swift static-link probe 验证真实 FFI key buffer ownership，并以 isolated named AppKit pasteboard 验证 expiry、external replacement preservation、普通 deactivation 保留到期值、显式 lock cleanup；Keychain adapter 使用 data-protection Keychain、`biometryCurrentSet` 和 device-only accessibility；scene inactive 锁定 Vault/reveal，sleep、screen sleep、session resign 与 termination 额外清理 clipboard；`cargo fmt/check`、FFI clippy `-D warnings`、core 24 + FFI 15 tests、Swift contract、Debug/Release Xcode build、strict ad-hoc codesign、Electron typecheck、34 files/170 tests、Browser parity 2 files/6 tests、31 Markdown/5 YAML docs check 全部通过 | Automated Pass；`CT-NATIVE-PRIVILEGED-001`、`CT-NATIVE-QUICK-UNLOCK-001`、`CT-NATIVE-CLIPBOARD-001` Pass；`AT-NATIVE-MACOS-003` Not Run；`NDM-040` 保持 In Progress |
| EVID-NDM-013 | 2026-07-22 | `NDM-040` macOS platform acceptance deferral；当前验收主机 macOS 14.8.7 x86_64 | 用户确认当前 Native Preview Vault 没有用于交互验收的合成数据，且当前系统不支持 Touch ID，因此未执行 protected-value、真实剪贴板、Touch ID/Keychain 与 lifecycle 平台清单；后续须在具备合成数据和 Touch ID 的测试 Mac 上从 `AT-NATIVE-MACOS-003` 继续 | Deferred；没有产生 Pass 证据；`AT-NATIVE-MACOS-003` 保持 Not Run；`NDM-040` 保持 In Progress |
| EVID-NDM-014 | 2026-07-22 | `NDM-050` Native browser transport/authorization increment；macOS 14.8.7 x86_64；Xcode 16.2 / Swift 6.0.3 | Native Preview 使用独立 browser `VaultWorker`、Keychain pairing namespace、`0600` Unix socket 和 `com.vaultmesh.preview.browser` development host；native host 改用 authenticated base64url payload envelope，Electron 保持 legacy envelope 兼容；使用注入的合成 pairing secret 执行 Node host→socket→Swift broker 跨进程 contract，覆盖空/畸形/过大消息、错误 HMAC、RPC mismatch、expiry、replay、desktop/browser 双向独立 lock、system lock 取消 pending unlock、confirmation/revoke 与旧 secret 失效；真实 Keychain→host 读取和浏览器安装留给 `AT-BROWSER-001`；`pnpm native:macos:browser-contract` 验证已实现 route 与共享 policy 一致；Native host 10 tests、Swift static-link contract、Debug/Release Xcode build 与 strict ad-hoc codesign、Electron 34 files/171 tests、Extension 22 files/141 tests/typecheck/production build、Electron parity 2 files/6 tests、Electron typecheck 与 docs check 通过 | Partial Pass；authorization/transport 子切片通过；`pnpm verify:native-browser-parity` 明确失败，当前 8/104 routes、剩余 96；`CT-NATIVE-BROWSER-001` Fail；`AT-BROWSER-001` Not Run；`NDM-050` 保持 In Progress |
| EVID-NDM-015 | 2026-07-22 | `NDM-050` Native browser safe metadata increment；macOS 14.8.7 x86_64；Xcode 16.2 / Swift 6.0.3 | Native broker 通过独立 browser `VaultWorker` 和现有 safe metadata FFI 实现 `vault.workspace`、五类 list 及 card/identity/SSH/secret detail；identity 子项在普通 metadata DTO 中保留 UUID、preferred 与结构化地址，secret summary 只追加非秘密 kind，列表过滤内部 Email OTP 并复现 Passkey login scope/fallback matching；login custom-field value、卡号、CVC/PIN、SSH key/password 和 secret value 仍不进入普通 response；Swift contract 覆盖 RPC shape、locked/empty/not-found、workspace、Passkey mapping，Rust runtime fixture 覆盖五类非空数据和 protected sentinel redaction；Rust fmt/check、FFI clippy `-D warnings`、core 24 + FFI 15 tests、Native contract、Debug/Release Xcode build和 strict ad-hoc codesign、Electron 34 files/171 tests、Extension 22 files/141 tests/typecheck/build、Native host 10 tests、Electron parity 2 files/6 tests通过 | Partial Pass；`pnpm native:macos:browser-contract` 为 18/104；严格 `pnpm verify:native-browser-parity` 以剩余 86 routes 失败；`CT-NATIVE-BROWSER-001` Fail；`AT-BROWSER-001` Not Run；`NDM-050` 保持 In Progress |
| EVID-NDM-016 | 2026-07-22 | `NDM-050` Native Browser RPC v2 complete automated slice；macOS 14.8.7 x86_64；Xcode 16.2 / Swift 6.0.3 | `vault-ffi` 追加 operation-oriented Browser Core transaction，覆盖 lifecycle audit、五类 CRUD/trash/history、password health、atomic import/SSH batch，并在 schema/core/persistence 失败时恢复旧加密文件与旧 session；Swift broker 完成独立 Touch ID/PIN/security settings、clipboard、backup/restore、CSPRNG password、限界 CSV/Bitwarden import、无 symlink SSH scan、ES256 Passkey、origin/document/handle-bound autofill 与一次性 confirmation；import/SSH pending secret 主动到期并在 lock/revoke/stop 清除；login `items.detail` 明确改为 fresh-gesture page-disclosure，普通 metadata/copy/fill 路径仍不泄露 protected value；严格 parity 同时检查共享 operation/policy、Swift dispatch 与 Rust FFI route，结果 104/104；Rust browser contract 验证 camelCase/default/schema rejection、原子持久化/回滚、重开和受控 custom field；Swift contract 验证完整 registry、policy、独立授权、安全设置、生成器、CRUD/candidates/fill binding/audit；`cargo fmt/check/test` 与 FFI clippy `-D warnings` 通过（core 24 + FFI 19 tests），Electron typecheck + 34 files/171 tests，Extension typecheck + 22 files/141 tests + production build，Native host 10 tests，Electron parity 2 files/6 tests，Native contract 与 32 Markdown/5 YAML docs check 通过；Debug/Release Xcode 均 `BUILD SUCCEEDED` 且 strict ad-hoc `codesign --verify --deep --strict` 通过 | Automated Pass；`CT-NATIVE-BROWSER-001` Pass；104/104 route implementation complete；真实 Chromium host install/Keychain pairing/page workflows 的 `AT-BROWSER-001` Not Run，因此 `NDM-050` 保持 In Progress |
| EVID-NDM-017 | 2026-07-22 | `BUG-2026-003` Native Preview ad-hoc pairing startup；macOS 14.8.7 x86_64 | 修复 ad-hoc Data Protection Keychain `-34018` 后，又定位并修复 Application Support broker socket 超过 macOS `sun_path` 上限的二次失败；Debug 使用 app container owner-only `0600` development credential，socket 移到同一 container 的 84-byte 短路径；真实菜单 enable 后标记为 1、credential 为 `-rw-------`、socket 为 `srw-------`，安装后的 `com.vaultmesh.preview.browser` Host 使用 locator 完成 `vault.status` 跨进程 RPC；Native Host 12 tests、Swift contract、104/104 parity、Debug/Release build 与 strict codesign、33 Markdown/6 YAML docs check 通过 | Pass；`BUG-2026-003` Verified；完整 Chromium page workflow 的 `AT-BROWSER-001` 仍 Not Run |

### AT-NATIVE-MACOS-001 交互验收清单

使用隔离的 macOS 测试账号或全新的 Native Preview 容器和非真实密码执行；不得复制
Electron 正在使用的 Vault 到 Native Preview 默认目录：

1. 执行 `pnpm native:macos:build && pnpm native:macos:launch`，确认应用名为
   “VaultMesh Native Preview”，能够显示无侧边栏的单内容 lifecycle 界面，且没有
   路径选择/打开按钮；逐步放大窗口，确认表单宽度有上限且始终水平、垂直居中，
   缩小窗口时内容仍可通过滚动访问。
2. 在没有默认 Vault 的隔离测试环境中输入临时密码并创建，确认没有出现 Save
   Panel，UI 显示已解锁。
3. 点击锁定；先用错误密码解锁，确认仍为锁定且显示通用认证失败；再用正确密码
   解锁，确认操作期间显示进行中状态，窗口仍可移动/重绘且不能重复提交，完成后
   恢复已解锁状态。
4. 在已解锁状态切换到其他应用再返回，确认 scene inactive 已触发自动锁定。
5. 退出并重新启动 preview，确认自动检测默认 Vault 并直接显示锁定状态；使用正确
   密码解锁，随后锁定并退出。
6. 确认操作期间日志和 UI 没有显示密码、Vault Key、envelope bytes 或 core debug
   error；仅在确认使用隔离测试容器后清理该容器，不得删除现有 Native Preview 或
   Electron 用户数据。

本清单已于 2026-07-22 由用户确认完成，结果记录为 `EVID-NDM-009`；自动化、build
或启动冒烟仍不能替代后续切片各自要求的交互验收。

### AT-NATIVE-MACOS-002 安全 item metadata 交互验收清单

使用隔离的 macOS 测试账号或 Native Preview 测试容器和非真实凭证执行；不得把
Electron 正在使用的 Vault 放入 Native Preview 默认目录：

1. 执行 `pnpm native:macos:build && pnpm native:macos:launch`，创建或解锁隔离的
   默认 Vault；确认解锁后进入原生 item list/detail 界面。全新空 Vault 必须显示明确
   empty state，不得出现静态演示项目。
2. 若隔离测试 Vault 含有合成 item，逐类选择 login、card、identity、SSH 和 secret，
   确认标题、普通 metadata、收藏/re-prompt 和 protected-field presence 可读，窗口缩放
   与列表选择正常；不得为验收复制真实 Vault 或真实凭证。
3. 确认 UI 不显示 password、TOTP seed、login custom-field value、完整卡号/CVC/PIN、
   SSH password/public/private key/passphrase 或 developer secret value；支付卡只能显示
   mask，SSH 只能显示算法/指纹，protected section 只能显示“已保存”状态。
4. 在详情加载或显示期间执行锁定并切换到其他应用，确认 list/detail 立即消失且返回
   locked lifecycle；再次解锁后只能从新的 FFI response 重建列表，不恢复旧 detail。
5. 确认日志、错误文案和 UI 没有 Rust debug/error、原始 JSON、Vault bytes 或上述
   protected value；退出应用，确认没有恢复上次 detail selection 或 decrypted record。

本清单已于 2026-07-22 由用户确认通过，结果记录为 `EVID-NDM-011`；五类非空
response 的 protected-value redaction 由 `EVID-NDM-010` 的自动化 sentinel contract
覆盖，交互验收不复制真实 Electron Vault 或真实凭证。

### AT-NATIVE-MACOS-003 平台安全交互验收清单

使用具备 Touch ID 的测试 Mac、Native Preview 隔离容器和合成凭证执行；不得复制真实
Electron Vault、真实密码、私钥、Token 或卡片信息：

1. 执行 `pnpm native:macos:build && pnpm native:macos:launch`，用主密码解锁隔离 Vault；
   在 toolbar 启用 Touch ID，确认系统显示 VaultMesh 的 Touch ID 提示，成功后显示已启用。
2. 锁定并点击“使用 Touch ID 解锁”；先取消一次，确认仍保持 locked 且没有 item state；
   再成功验证，确认进入真实 item list。再次锁定/解锁必须再次要求 Touch ID，不能复用上次
   authorization。
3. 对合成 login/card/SSH/secret 的受保护字段执行复制；需要 re-prompt 的 item 必须先要求
   当前主密码，错误密码不得复制。复制后在临时文本窗口确认内容正确，等待 30 秒后确认
   VaultMesh 写入的 clipboard 被清除。
4. 切到临时文本窗口粘贴合成值；Native Preview 必须锁定并清除 reveal/item state，但已经
   授权的 clipboard 必须保留到 30 秒 expiry，确保可以完成这次粘贴。再次复制后立即用其他
   应用复制固定非秘密文本；等待超过 30 秒，确认 VaultMesh 没有清除较新的外部 clipboard。
   再次复制后点击应用内显式锁定，确认未被替换的值立即清除。
5. 对合成值执行显示，确认 15 秒后自动隐藏；再次显示后切换应用、锁定或选择其他 item，
   确认内容立即消失。不得截图、录屏或把显示值写入测试记录。
6. 在已解锁和已复制合成值时分别触发 display sleep、system sleep 或用户 session lock；
   返回后确认 Vault 已锁定、reveal/list/detail 已清除、未替换 clipboard 已清除，Touch ID
   quick unlock 仍要求新的系统验证。
7. 解锁后关闭 Touch ID，锁定并重启应用；确认 Keychain credential 已删除，不能继续使用
   quick unlock。重新启用后若更改 Touch ID enrollment，旧凭据必须失效并要求主密码重建。
8. 确认 UI、Console 和应用日志没有主密码、Vault Key、Keychain data、protected value、
   Rust debug/error、raw JSON 或 Vault bytes。

本清单当前为 Not Run；`EVID-NDM-013` 记录当前主机无 Touch ID 且无合成测试数据，用户选择
延期到具备条件的测试 Mac 复测。自动化 contract、Xcode build 或 LaunchServices smoke 不能
替代真实 Touch ID、Keychain、clipboard、sleep 和 session-lock 验收。

### AT-BROWSER-001 Native Preview 浏览器交互验收清单

使用隔离 Chromium profile、固定 development extension ID、Native Preview 测试容器和合成
Vault 数据执行；不得覆盖 Electron 的 `com.vaultmesh.browser` registration，也不得使用真实凭证：

1. 从已签名/隔离安装的 Native Preview bundle 安装 `com.vaultmesh.preview.browser` host，确认
   manifest 固定 ID、helper 路径和 app bundle 一致；启动 Chromium 后 popup 可配对，关闭 popup
   再打开仍由 background port 连接，卸载后 host 不可用。
2. 分别验证 desktop 与 browser create/unlock/lock 独立；错误主密码、错误/过期 PIN、取消 Touch ID、
   sleep/session lock、应用退出和 pairing revoke 均不得保留 browser authorization；旧 pairing
   secret 和 replay request 必须立即失败。
3. 在 popup 使用合成数据逐类完成 login/card/identity/SSH/secret CRUD、trash/history、copy、密码
   健康、生成器、主密码轮换和加密 backup/restore；取消 dialog、无效输入和失败写盘不得产生部分变更。
4. 执行 CSV/Bitwarden import 与 `~/.ssh` scan 的 preview/commit/cancel/expiry；preview 不得包含密码、
   卡号、私钥或本地路径，重复/过大/symlink 文件必须拒绝或跳过，lock/revoke 后旧 session 必须失效。
5. 在 login/OTP/card/identity/secret/SSH 合成页面验证候选和显式填充；确认 request/tab/top origin、
   frame origin、document ID、handle 与 expiry 绑定，导航/过期/重复 assignment 被拒绝，禁止自动 submit；
   page-load 只允许符合 policy 的空 login/OTP 字段，card 必须重新验证当前主密码。
6. 验证 login `items.detail` 只有 fresh gesture 可读取 custom fields，popup 关闭、锁定或导航后内容消失；
   extension storage、Console、日志和 crash state 不得出现 custom-field value 或其他 protected value。
7. 在 Chromium 127+ 合成 RP 完成 ES256 Passkey create/get；确认每次显示 RP/origin/account 原生确认，
   origin/RP mismatch、excluded/allow descriptor、取消和 lock 均 fail closed，Vault/response/日志之外没有
   private key，conditional mediation、largeBlob/PRF 保持不可用。
8. 退出应用、撤销配对并卸载 host，确认 background reconnect 返回不可用，pending fill/import/SSH/
   Passkey、clipboard 和临时 response 已清除；随后恢复 Electron development host，确认其 registration
   与数据未被 Native Preview 覆盖。

本清单当前为 Not Run；`EVID-NDM-016` 只证明 104/104 自动化实现、Debug/Release ad-hoc 签名和
contract，不替代真实 Chromium、Keychain、AppKit dialog、页面导航与 packaged host 安装行为。

后续证据必须记录执行日期、OS/architecture、命令或 CI、package/build 标识和
结果。未在目标 OS 执行的平台行为保持 Not Run，不能用 cross-compile 替代。

## 安全与数据生命周期

- 主密码、Vault Key 和 decrypted session 继续由 core/FFI 有界持有；UI 只接收
  当前操作必需且符合 Requirement 的结果。
- 跨语言 secret response 必须使用可清零 buffer，不使用不可控生命周期的
  常驻 UI string；调用方取消、失败、锁定和退出均执行 destroy。
- Platform credential store 只包装随机 Vault Key 或 device-local pairing secret，
  不替代 Vault，也不保存主密码。
- Native crash/log/analytics 默认不得收集秘密；引入任何 crash reporting 或
  telemetry 必须另建安全 Change。
- 最后一个 desktop/browser authorization 被撤销后，core、邮件连接/候选、
  import/SSH session、pending fill 和其他敏感临时状态必须清除。

## 兼容与迁移

- Vault format/payload：当前无变化，原生客户端必须读写与 Electron 相同格式。
- Native ABI：保持 v1 fail-closed；新增操作必须有双端 version/ownership test。
- Browser RPC：保持 v2；native broker 未达到 parity 前继续由 Electron 提供。
- Settings/quick unlock：Native preview 使用独立目录和凭证命名空间，不静默
  复用 Electron wrapper。
- Upgrade/downgrade：默认客户端切换前必须定义数据目录、browser host、启动项、
  installer ownership 和回滚补偿；本 Change 不批准该切换。

## 维护规则

- 任何任务开始前更新状态为 In Progress，并关联实际 Work/Requirement/Test。
- 行为切片应建立较小的子 Work Package，并在证据中回链本计划；本计划不替代
  每个切片的验收和安全说明。
- 任务只有在自动化与适用平台验收均有证据后才能标记 Done。
- 每次状态变化同步 `change.yaml`、本任务表、主规格和
  `../../docs/08-traceability.md`；不得只更新百分比或口头进度。
- 进入 Implementing 前必须完成 NDM-010，确认 ABI contract 与生成/绑定方式，
  并让 `CT-NATIVE-ABI-001`、`CT-NATIVE-MEMORY-001` 具备可执行测试定位。
