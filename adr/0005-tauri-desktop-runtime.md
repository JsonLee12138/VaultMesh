# ADR-0005：Tauri 2 统一桌面运行时

- 状态：Accepted
- 日期：2026-07-22
- 取代：`ADR-0002` 的目标桌面特权边界、`ADR-0004` 的 SwiftUI/WinUI 产品迁移方向
- Source-removal 顺序由 `ADR-0006` 修订

## 决策

VaultMesh 的目标 macOS/Windows 桌面客户端使用 Tauri 2。现有 React/Vite renderer 作为
共享 presentation；Tauri capability、显式 command 和 Rust desktop runtime 取代 Electron
preload/main/N-API 作为目标特权边界。Rust runtime 复用 `vault-core` 和共享 operation，拥有
桌面授权、原子文件持久化、browser broker、clipboard/dialog/quick-unlock、SSH、email 和
其他特权服务。

Electron 在迁移 Gate 完成前保留为 reference client，但不再新增只服务于 Electron 的产品
能力。SwiftUI/AppKit preview 冻结为已验证的 adapter/contract 参考；WinUI presentation
不再实施。最终切换和 Electron source removal 必须分别有可回滚证据。

## 原因

- React renderer 与两平台共享，避免重复实现桌面 workflow。
- `vault-core` 已是 Rust，Tauri 可以消除 N-API 与 Swift/WinUI ABI 在目标产品路径中的重复
  转换和 ownership 成本。
- 单一 Rust broker/service 实现可以同时服务桌面 UI 与 native messaging，并共享 policy、
  mutation 和 cleanup 测试。
- Tauri 使用系统 WebView，避免在产品包内携带 Electron/Chromium runtime。

## 后果

- WKWebView 与 WebView2 必须分别执行 UI、CSP、navigation、clipboard 和 platform AT。
- Electron main 中的 Node-only email/SSH/import/browser 服务必须迁到 Rust；不得用长期 Node
  sidecar 作为完成态。
- Tauri capability 不能替代业务授权；每个 command 仍需输入校验、锁定检查、最小响应和拒绝
  路径测试。
- Touch ID/Keychain 与 DPAPI/Windows Hello 继续是平台 adapter，Windows 决策仍受
  `OPEN-001` 阻塞。
- 开发期 Tauri、Electron 和 Native Preview 必须隔离 app ID、数据目录、host registration
  与写入目标。

## 被拒方案

- 继续 SwiftUI + WinUI 双端产品实现：UI、broker 和平台 workflow 重复，交付收益不足。
- 在 Tauri 中加载 `electron-bridge` N-API：引入无必要的 Node ABI 和双重 runtime boundary。
- 长期使用 Node sidecar 承载 Electron main services：保留部署、资源和特权面成本。
- 立即删除 Electron：缺少 Tauri package、browser registration、upgrade 和 rollback 证据。
