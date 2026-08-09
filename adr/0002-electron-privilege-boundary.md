# ADR-0002：Electron Main 作为桌面特权边界

- 状态：Accepted
- 日期：2026-07-22

## 决策

React renderer 保持 sandbox 且无 Node/filesystem 权限；preload 暴露固定 typed API；Electron main 验证 sender/schema 并拥有 Vault session、clipboard、dialog、biometric、SSH、email 和 browser broker。`electron-bridge` 在 main 一侧调用 Rust core 并原子持久化。

## 原因

- UI 依赖和 DOM 内容不应拥有 OS/Vault 能力。
- 固定 IPC surface 可以分类、测试和拒绝非预期调用。
- Clipboard、dialog 和平台 secure storage 需要 Electron/OS 上下文，但不属于密码学 core。

## 后果

- 新 IPC 必须跨 shared contract、preload、main handler 和 test 完整实现。
- Renderer 需要 secret preview 时只能在有界授权流程短暂接收，不能写 store/snapshot。
- BrowserWindow、navigation、webview、fuse 和 packaging policy 属于 release Gate。

## 被拒方案

- 打开 `nodeIntegration` 或 generic `ipcRenderer.invoke`：权限面不可审计。
- Renderer 直接加载 N-API：绕过 lifecycle、authorization 和 sender policy。
- 把所有平台操作放入 Rust：会把 UI/OS policy 混入可移植 core。
