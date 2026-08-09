# ADR-0001：Rust Vault Core

- 状态：Accepted
- 日期：2026-07-22

## 决策

使用 `crates/vault-core` 作为 Vault 加密、文件格式、领域模型、解锁 session、mutation 和 rollback 的唯一实现。Electron 和未来 native client 只通过各自 bridge 调用 operation，不复制业务或密码学规则。

## 原因

- 安全关键逻辑集中、可审计并可在桌面实现之间复用。
- Rust 类型和 zeroization 支持明确的秘密生命周期。
- Core integration test 可以直接覆盖 wrong password、tamper、rollback、compatibility 和 redaction。

## 后果

- TypeScript/Swift/C# DTO 变化必须与 core model/operation 一起演进。
- File format 变化需要 Rust migration 和跨 bridge test。
- Platform clipboard、dialog、biometric 和 lifecycle 不进入 core。

## 被拒方案

- 在 Electron main 实现加密：难以复用到 native client，扩大 TypeScript 安全边界。
- 每个平台独立实现：格式和安全语义会漂移。
- 由 renderer 直接管理 Vault：破坏 sandbox 和 privilege separation。
