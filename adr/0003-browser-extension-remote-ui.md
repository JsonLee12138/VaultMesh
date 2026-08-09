# ADR-0003：浏览器扩展是远程 UI，不是 Vault Client

- 状态：Accepted
- 日期：2026-07-22
- 修订：2026-07-23，默认 broker owner 切换到 Tauri Rust runtime；2026-07-24，邮箱 OTP 候选改为显式打开后的全局短时候选

## 决策

Chromium MV3 extension 通过固定 ID、Rust native host 和 authenticated RPC v2 调用正在运行的
Tauri Rust broker。Extension 不打开 Vault、不持有 Vault Key、不持久化 Vault response；native
host 只转发。Desktop 与 extension 使用独立 authorization。

邮箱 OTP 是独立 browser authorization 内的全局短时候选，不按当前网站与发件域名过滤。只有用户
显式打开插件 popup 或 OTP 字段页内列表后才披露，选择后仍由 Rust 按 candidate ID、expiry 和当前
origin/tab/frame/document/handle 重新验证并生成单次 assignment；不得自动选择、自动填入或提交表单。

## 原因

- 避免在 browser storage/runtime 复制加密 Vault 和解锁状态。
- File dialog、clipboard、biometric、SSH/email 和 Passkey signing 可以留在受控 desktop process。
- 独立 authorization/revoke 降低浏览器被长期授权的风险。
- 事务邮件的发件域名经常与业务网站不同，域名过滤会使真实验证码不可用；显式选择和短时生命周期
  是邮箱候选的主要披露边界。

## 后果

- Desktop app 必须运行，extension 才有完整能力。
- RPC 必须 versioned、authenticated、bounded、expiring、replay-protected，并有 capability policy。
- Autofill assignment 必须绑定页面文档，Passkey private key 只留在 encrypted core/main signing path。
- Browser release 必须同时验证 extension ID、native-host install/uninstall 和 desktop protocol parity。
- 任意已获独立授权的 HTTP(S) 页面在用户打开验证码候选 UI 后都可能看到最近未过期验证码，这是
  为跨域事务邮件可用性接受的风险；Provider credential、邮件正文、收件地址和 subject 仍不得进入 Browser RPC。

## 被拒方案

- Extension 直接读写 Vault：扩大秘密持久化面并产生双写/锁定问题。
- 在 native host 中解密：transport helper 变成第二 Vault client。
- Desktop unlock 自动授权 extension：破坏表面隔离和 revoke 语义。
- 按发件域名与网站 origin 过滤邮箱 OTP：事务邮件域名不稳定，导致合法候选在验证码页面不可用。
