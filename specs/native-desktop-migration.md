# Native desktop migration spec（Historical）

本规格只保留 Rejected Native Preview 的历史 contract/迁移证据。对应源码已由
`CHG-2026-008` 移除，不再是当前实现或命令入口。

执行计划与证据：
`../changes/CHG-2026-002-native-desktop-migration/change.md`（Implementing）。
`OPEN-002` 已关闭：macOS first，Windows second；第一切片是
create/unlock/status/lock。

Electron 保持 production/reference client。Native presentation layer 是 Future 增量迁移，不是当前并行产品。

```text
                         vault-core
                        /          \
         electron-bridge            vault-ffi
                |                   /        \
         Electron desktop    SwiftUI/AppKit  WinUI 3
          (implemented)         (future)      (future)
```

## 当前状态

- `crates/vault-ffi` 已实现 ABI v1 version negotiation、稳定 status、统一 panic
  containment 和可清零 Rust-owned buffer destroy；C header 与 macOS Swift contract
  probe 已通过。
- `apps/macos/VaultMeshNative.xcodeproj` 已实现 SwiftUI/AppKit lifecycle preview，
  通过 static `vaultmesh-ffi` 调用 create/unlock/status/lock；`apps/windows` 仍是
  reserved root。
- `pnpm browser:dev` 和 native messaging 依赖 Electron broker。
- Migration 期间 `apps/desktop`、`crates/electron-bridge` 必须持续工作。
- macOS 是第一平台，Windows 在 macOS 核心闭环后推进。
- 当前 macOS 主机已验证 Xcode 16.2（16C5032a）、macOS 15.2 SDK、SwiftUI
  typecheck 和 `codesign`；Developer ID/notarization 仍由发布 Gate 验收。
- `NDM-DEC-001` 已关闭；`NDM-020` 的 macOS create/unlock/status/lock 与
  `NDM-030` safe list/detail 自动化及平台验收已通过；`NDM-040` privileged
  access/platform security 自动化已通过，真实 Touch ID/Keychain 平台验收待执行；
  `NDM-050` Native browser broker/host、独立授权及 RPC v2 自动化 parity 已达到
  104/104 routes；真实 Chromium host 安装、Keychain pairing 和端到端页面行为仍待
  `AT-BROWSER-001`，因此任务保持 In Progress。
- `CHG-2026-003-native-macos-desktop-workflows` 已进入 Implementing，补齐三目的地
  native shell、类型筛选、五类创建、导入、安全中心和设置；该切片通过前仍不得把
  Browser route parity 表述为 native desktop UI parity。

## 迁移顺序

1. 定义 ABI ownership、allocation、error、panic 和 zeroization，并添加两平台 cross-language contract test。
2. 以 create/unlock/status/lock 为首个垂直切片。
3. 添加不含 protected value 的 list/detail metadata。
4. 添加 platform-owned clipboard policy 的 privileged copy/reveal。
5. 添加 lifecycle、secure storage、biometric 和 dialog。
6. Port browser brokerage/native-host installation 并达到 protocol parity。
7. 通过 feature/security/packaging/upgrade/rollback Gate 后才允许替换默认 desktop client。

解锁后的 native desktop 在开始 UI parity 切片后必须只显示已接通真实 operation 的
保险库、安全中心和设置目的地。搜索/类型筛选可以只作用于 safe summary；创建、导入、
健康、恢复和设置必须调用实际 core/platform owner，不能以展示卡片或禁用按钮计数。

Feature 只有在 native test 覆盖 ownership、final-lock cleanup、error path 和 secret destruction 后才算 migrated。UI mock 或单个 ABI function 不等于 parity。

阶段、任务状态、里程碑门禁和执行证据只在关联 Change 中维护，本规格只拥有
稳定迁移行为与边界，避免形成第二份计划。

## ABI 与平台规则

- Native client 只通过 `vault-ffi`，不能使用 `electron-bridge`。
- ABI 暴露 operation-oriented function，不暴露 Rust layout/internal pointer。每个 allocation 和 secret-bearing response 有 matching destroy operation；Rust panic 不得跨 boundary unwind。
- ABI v1 使用固定宽度 status code、borrowed input view、Rust-owned output buffer 和
  opaque handle。除 version probe 外 operation 必须校验 ABI version；Rust-owned
  buffer 必须由 matching destroy 显式清零并使用同一 allocator 释放。
- Native item list/detail 必须由 `vault-ffi` 从 core 的安全 summary/detail 构造
  独立、带 schema version 的 DTO；普通 response 只允许 metadata 与 protected-field
  presence，不得包含密码、TOTP seed、login custom-field value、完整卡号/CVC/PIN、
  SSH key material/passphrase 或 developer secret value。锁定、取消、失败和 teardown
  必须使 SwiftUI/WinUI state 中的 DTO 失效并销毁原始 response buffer。
- Native privileged value access 必须是独立的 field-scoped ABI operation，并继续在 core
  内执行 item kind、field availability 和 master-password re-prompt；protected value 只通过
  matching-destroy 的可清零 buffer 返回。普通 list/detail DTO 不得因该 operation 扩大。
- Native Browser mutation 必须通过 operation-oriented FFI 进入 core，并在原子写盘成功后
  才发布新 session；输入/schema 错误、core 失败或持久化失败必须恢复旧文件和旧内存状态。
  Browser login `items.detail` 的 custom fields 是共享 policy 明确分类的 fresh-gesture
  `pageDisclosure`，不得被当作普通 safe metadata DTO 或持久化到 extension/UI state。
- macOS copy 必须由 AppKit clipboard adapter 执行，默认 30 秒后仅在 clipboard 仍由
  VaultMesh 写入时清除；普通 app deactivation 必须锁定 Vault UI 但保留已授权 clipboard
  到原 expiry，使用户可以粘贴到目标应用。显式锁定、system sleep/session lock 和
  application termination 必须立即尝试清除未被用户替换的值。Reveal 必须有界自动隐藏，
  并在锁定、选择变化和 teardown 时清除临时 secret state。
- macOS Touch ID quick unlock 只可以把 FFI 导出的 32-byte 随机 Vault Key 存入当前
  Native Preview bundle 隔离的 Keychain item，并使用当前生物识别集合约束访问；不得保存
  主密码、明文文件路径或 Vault payload。取消、失败、凭据失效和错误长度必须 fail closed
  并清零临时 key bytes；主密码成功解锁后才可以启用。
- Native adapter 不得记录或向 UI 暴露 Rust error/debug string；平台文案只能从
  稳定 status code 映射。详细实现契约由关联 Change 的 `design.md` 记录。
- macOS lifecycle slice 的 create 必须在原子文件提交成功后才发布 unlocked opaque
  handle；unlock 只读取有界加密文件。status 只返回 locked/unlocked，lock 与 handle
  destroy 必须幂等清除 core session。
- 原生 Vault 文件持久化由 `vault-ffi` 持有。macOS 默认流程只使用独立 App Sandbox
  的 Application Support Vault：首次启动创建，后续启动自动检测并进入解锁；不得
  暴露路径选择或“打开其他 Vault”。显式 import/restore/backup 属于后续独立流程。
- 首个 macOS lifecycle preview 只有一个已实现目的地，必须使用单内容窗口；在存在
  至少两个真实可导航目的地前不得显示空壳侧边栏或占位导航项。
- Lifecycle 表单必须使用有界最大内容宽度，并在窗口可用空间内水平、垂直居中；
  放大窗口不得拉伸表单或使其停留在左上区域，空间不足时必须保留边距并允许滚动。
- SwiftUI/AppKit 只计算 platform-owned 默认 path 并传给 FFI，不读取、修改或持久化
  envelope bytes；create 必须拒绝覆盖已存在的默认 Vault。
- macOS 的 create/unlock 等密码派生和文件 I/O 必须在单一串行后台执行边界运行，
  不得阻塞 MainActor；opaque handle 的 create/status/lock/destroy 必须保持在同一执行
  边界。UI 必须在操作期间显示进行中状态并拒绝重复提交。
- `vault-core` 继续唯一拥有 encryption/format/session。
- Keychain/LocalAuthentication 和 DPAPI/Windows Hello 是 platform adapter，不进入 Vault format。
- SwiftUI/WinUI view/restoration state 禁止持久化 decrypted record。
- Build/sign/final validation 在目标 OS 执行。

## 共存约束

```sh
pnpm electron:dev
pnpm electron:build
pnpm electron:test
pnpm ffi:build
pnpm ffi:test
pnpm native:macos:contract-test
pnpm native:macos:build
pnpm native:macos:launch
```

Native preview 必须使用不同 app name、bundle/package ID、user-data directory、browser-host ID 和 installer target。在 cross-process file locking 被实现和验证前，不得与 Electron 同时写同一 Vault。
