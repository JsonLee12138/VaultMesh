# ADR-0004：原生客户端增量迁移

- 状态：Superseded by `ADR-0005`
- 日期：2026-07-22
- 关联：`OPEN-002`（2026-07-22 Closed：macOS first，Windows second）

## 决策

Electron 继续作为可运行参考客户端。未来 SwiftUI/AppKit 和 WinUI 3 通过独立 `vault-ffi` 逐个垂直切片迁移；达到 feature/security/protocol/packaging parity 前不删除 Electron，也不复用 `electron-bridge`。

原生客户端的 Vault 文件读取和原子持久化由 `vault-ffi` 拥有。platform adapter
计算应用独立 Application Support 下的默认 Vault path；默认 create/unlock 流程不
提供任意路径或“打开其他 Vault”，create 也不得覆盖现有文件。系统文件面板只用于
后续显式 import/restore/backup。`vault-core` 仍唯一拥有 encryption、format、
session 和 mutation rollback；Electron 的文件持久化继续由 `electron-bridge` 拥有。

## 原因

- 一次性重写会同时改变 UI、ABI、平台安全、browser broker 和发布链路，无法隔离回归。
- `vault-core` 已提供可复用安全边界，独立 FFI 可以设计清晰 ownership。
- Electron 可作为行为和 parity 参考，保持当前产品可运行。

## 后果

- 两类 desktop client 可能在一段时间共存，必须使用不同 app ID/user-data/installer target。
- 未实现 cross-process lock 前不得同时写同一 Vault。
- 每个 native slice 需要跨语言 contract test 和 secret destruction path。
- 两个 bridge 分别拥有所属进程的文件提交，保持相同 commit-before-publish 规则，
  但 `vault-ffi` 不依赖或链接 `electron-bridge`。
- 默认单 Vault 路径隔离 Native Preview 与 Electron，降低跨进程锁完成前误选同一
  文件的风险；显式迁移文件仍受后续 `NDM-DEC-002` 约束。
- macOS 先实现 create/unlock/status/lock 垂直切片；Windows 在 macOS 核心闭环后推进。

## 被拒方案

- 原地把 Electron 替换为 native：缺少可回滚参考实现。
- Native client 使用 N-API bridge：ABI 和 runtime 不适合 Swift/WinUI。
- 先搭完整 UI 空壳再接 core：产生无法端到端验证的大型半成品。
