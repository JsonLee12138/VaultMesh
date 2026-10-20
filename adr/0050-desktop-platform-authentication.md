# ADR-0050：主窗口平台认证适配器

- 状态：Accepted
- 日期：2026-10-20
- 关联 Work：`CHG-2026-076-desktop-embedded-authentication`
- 关闭 OPEN：无

## 背景

主窗口需要无独立弹窗的认证与密码并行入口，现有同步 60 秒认证共享于多个 surface。

## 决策

Rust desktop coordinator 必须通过平台适配器管理认证会话。macOS 必须以 LAAuthenticationView 关联 LAContext 并在 AppKit 主线程挂载到主窗口；Windows 首版必须明确返回暂不支持，不关闭 OPEN-001。共享接口不得要求特定生物识别类型或所有平台具有嵌入 UI。主窗口无固定认证等待超时，生命周期取消由 coordinator 拥有；MCP 不迁移到本次会话。

原生对象不得进入 renderer；凭据只在认证成功并初验会话后短时读取，发布 Vault 授权前必须再次验证窗口、会话与 Vault。等待认证时不得持有凭据服务锁。取消与解锁提交必须串行仲裁。

## 原因

保留平台差异，避免 macOS API 泄漏到 React 或未来 Windows 实现；保持独立授权与秘密所有权。

## 后果

需要原生视图布局、焦点/隐藏/锁定清理及真机认证验收；首版不发布 Windows Hello 支持。

## 被拒方案

- 循环弹出 evaluatePolicy：打断密码输入。
- 共用无限阻塞函数：影响 MCP 时限，并长期占用凭据锁。
- 用 DOM 图标替代系统认证视图：不能嵌入真实系统认证。

## 验证

CT-DESKTOP-AUTH-001、CT-TAURI-DESKTOP-001、AT-DESKTOP-AUTH-001；Apple 官方 API：https://developer.apple.com/documentation/localauthenticationembeddedui/laauthenticationview 。
