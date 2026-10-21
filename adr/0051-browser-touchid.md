# ADR-0051：Browser 跟随桌面 Touch ID 配置

- 状态：Accepted
- 日期：2026-10-21
- 关联 Work：`CHG-2026-077-browser-touchid`

## 决策

当前 WXT 插件读取 desktop 拥有的 Touch ID 配置与当前 Vault 凭据，由 Rust broker 独立认证后仅发布 Browser 授权。桌面解锁不授权插件。插件不再维护独立生物识别开关，既有 Browser record 不再用于当前插件，保留原文件以允许代码回滚；不得静默将它迁移成 desktop 凭据。实验身份仍使用独立凭据，不继承桌面配置。

Popup 进入锁定页时可自动启动一次系统认证，取消或失败必须显式重试。认证使用异步、单次、有期限且带轮询租约的 Rust 会话，绑定随机 session ID、当前 Vault 和 credential ID；结果只在有效 poll 内重验并提交。Background 必须在 Native Host 断连时丢弃当前认证 ID 并拒绝恢复旧轮询；关闭/隐藏、切换密码/PIN、断连、系统锁定、撤销、凭据改变或期限结束均不得由迟到认证解锁。不得把 OS 对象或密钥传入 Browser RPC；等待认证不得持有凭据锁或 broker 锁。

## 原因与后果

共享的是本机快捷认证配置及凭据所有者，授权仍按 surface 独立。macOS 使用系统 LAContext 弹窗；不改变主窗口嵌入 UI 或 Agent 认证。Windows 继续明确不支持。新增 start/poll/cancel RPC，必须保持路由和 policy parity 并执行真实 Chrome/Firefox 弹窗验收。
