# ADR-0006：移除 Electron 与已停止的原生客户端源码

- 状态：Accepted
- 日期：2026-07-23
- 修订：`ADR-0005` 的 source-removal 顺序

## 决策

VaultMesh 仓库只保留 Tauri 2 作为 macOS/Windows 桌面产品 shell。React renderer、typed
API/contracts、Browser RPC policy 和产品图标迁入 Tauri owner 后，删除 Electron main/preload、
Forge、N-API bridge、desktop CLI、SwiftUI/AppKit Native Preview、WinUI reserved root 及其专属
构建入口。

用户明确接受在完整 Windows、真实 Chromium、签名和 upgrade/rollback AT 之前移除 reference
source。该决定只改变源码回退能力，不豁免上述发布 Gate，也不授权删除旧 Electron 加密数据、
迁移 receipt 或系统 credential。

## 原因

- Tauri 已是默认开发、构建、本机安装和 browser-host registration 路径。
- 保留三套不再交付的 presentation/build roots 会继续产生错误依赖、过期测试和安全边界歧义。
- 当前产品 UI 与共享 contract 可以由 Tauri 直接拥有，无需 Electron 目录充当第二所有者。
- 历史行为和迁移证据由 Change/ADR/Git 外部备份保留，不需要可构建的旧客户端源码。

## 后果

- 仓库不再能构建 Electron 或 Native Preview，源码级紧急回退不可用。
- Windows、真实 Chromium、签名、安装、upgrade、uninstall 和 rollback AT 仍为发布阻塞项。
- `vault-ffi` 暂时保留为 Tauri Rust runtime 依赖；未来移除它需要单独 Work Package。
- Electron user-data 迁移和保留策略继续有效；源码删除不得触碰用户数据。

## 被拒方案

- 保留不可构建的 Electron/Native skeleton：仍会形成错误 owner 和维护负担。
- 删除整个 `apps/desktop` 而不迁移 renderer/contracts/assets：会直接破坏 Tauri build。
- 同时删除 Electron user-data：缺少 Release rollback window 与平台验收，可能造成不可恢复数据丢失。
