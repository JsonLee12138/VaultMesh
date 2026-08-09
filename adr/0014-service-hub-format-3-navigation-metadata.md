# ADR-0014：网站/服务聚合保留在 format 3 的导航 metadata 中

- 状态：Accepted
- 日期：2026-08-04
- 关联 Work：`CHG-2026-025-website-service-hub`
- 关闭 OPEN：无

## 背景

VaultMesh 需要用一个用户可见的网站/服务记录聚合现有 Login、developer/service Secret、SSH credential
与 Passkey 所属 Login。Service、关系来源和用户纠错决定需要随加密备份保存，因此不能放在 renderer state
或 Vault 外的 settings 中。它们也不能成为 autofill、Passkey、Agent、HTTP 或 SSH 权限的第二所有者。

当前唯一可读写 envelope 是 format 3。新增 encrypted payload collection 会被不理解该字段的旧开发 writer
丢弃，但 VaultMesh 尚未正式发布，旧 writer 已不受支持；同时，丢失 Service 导航 metadata 只会移除组织关系，
不会暴露秘密或扩大任何 target/permission。为本功能提升 envelope version 会与当前“只读写 format 3、无迁移
入口”的兼容基线冲突，并引入没有安全收益的迁移面。

## 决策

Service record、typed item relationship、automatic source、ignored suggestion 与批次纠错 metadata 必须作为
default-empty collection 保存在 format-3 encrypted `VaultPayload` 中。当前 writer 必须完整 round-trip、原子提交、
backup/restore 和重启恢复这些字段；不理解字段的旧开发 writer 明确不受支持，不提供降级、兼容 writer 或迁移 API。

关系允许多对多。每个引用必须同时携带受限 item kind 与 opaque UUID，并由 `vault-core` 在 link、read、restore、
purge、merge、split、move 与 bulk apply 时验证。Service 删除和批次 rollback 只删除 Service/关系，不得删除或改写
源 item。不存在、已清理或 kind 不匹配的引用必须 fail closed 或从 renderer-safe 导航投影中稳定省略，不能指向另一个
item kind。

自动规则 v1 只能把规范化后的 exact HTTP(S) host、Secret website host 或非 IP/非 localhost 的 exact SSH host
作为 high-confidence key；默认移除 `www.` 等价前缀，但不同非默认 port、IP、localhost、共享托管域、跨 host、仅标题
相似和冲突 URI 不得 high-confidence 自动应用。v1 不引入 Public Suffix List 或联网服务。中低置信度只生成待确认建议；
规则版本变化不得静默覆盖已确认关系或 ignored decision。

Service 地址只用于展示、打开和组织建议。任何 autofill、Passkey、Agent、HTTP 或 SSH 操作必须重新读取原 item 的
authoritative target 与 policy；Browser RPC 和扩展协议不新增 Service operation。

## 原因

- encrypted format-3 payload 是跨备份保存本地组织 metadata 的既有唯一所有者。
- 导航关系丢失会降低可用性但不会扩大 authority，因此不满足必须提升 envelope version 的安全条件。
- exact-host v1 能提供确定性、离线、可解释的高置信度批量结果，同时把 PSL 更新、许可和共享域误组风险留在
  显式后续版本决策中。
- typed UUID 引用和 core-owned validation 防止 renderer 拼接关系或产生跨 kind 类型混淆。

## 后果

- format 3 增加 default-empty Service、trash/history 与 aggregation-decision collections；旧开发 writer 不受支持。
- 当前版本不自动合并不同子域。用户可显式 merge/move，未来规则需要新版本标识和重新预览。
- macOS/Windows packaged AT 必须证明 backup/restore、锁定清理和 1000-item 批次交互；Windows AT 只能在目标 OS 完成。

## 被拒方案

- 提升为 format 4：与当前唯一 format-3 reader/writer 基线冲突，且导航 metadata 不构成 authority expansion。
- 用 renderer state、sidecar 或普通 settings 保存关系：破坏 Vault payload 所有权和备份一致性。
- 引入 Public Suffix List 依赖并按 registrable domain 自动 high-confidence：本阶段没有必要承担更新、许可与共享托管域
  误组成本；未来可通过新规则版本评估。
- 让一个 item 只能属于一个 primary Service：无法表达 SSO 与一个凭据服务多个产品入口，且会制造不必要迁移。

## 验证

`CT-SERVICE-001`、`CT-SERVICE-AUTO-001`、`CT-COMPAT-001`、`CT-REL-001`、`CT-PRIV-001` 必须覆盖
format-3 round-trip、恶意引用、deterministic/idempotent plan、catalog drift、原子失败回滚和安全投影；
`AT-SERVICE-001`、`AT-SERVICE-AUTO-001` 必须覆盖 macOS/Windows packaged UI 与 1000-item 批次。
