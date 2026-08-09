# Vault 数据模型与格式

`crates/vault-core/src/format.rs` 和 `crates/vault-core/src/model.rs` 是实现定位；本文件拥有格式兼容意图。对应 `REQ-VAULT-*`、`REQ-ITEM-*`、`REQ-RECOVERY-001`、`NFR-COMPAT-001`。

## Envelope format 3

```text
VaultEnvelope v3
  header
    format_version = 3
    salt[16]
    kdf = Argon2id(memory_kib=65536, iterations=3, parallelism=1, output=32)
    wrapped_vault_key_nonce[24]
    wrapped_vault_key_ciphertext[48]
  payload_nonce[24]
  payload_ciphertext[n + 16]
```

Format 3 是当前唯一 Vault envelope。它可以持久化 `agent_connector_definitions` 与 Agent audit，且 version 3
进入 wrapping-key 与 payload 两层 AAD。所有 Reader 只接受 format 3；其他版本必须在 KDF 前拒绝。

随机 32-byte `vault_key` 使用 XChaCha20-Poly1305 加密 payload。主密码经 Argon2id 派生独立 wrapping key，并使用独立 nonce 包装 `vault_key`。Format version、salt 和固定 KDF 参数是两次加密的 AAD。解析必须在运行 Argon2 前拒绝非 format 3、非固定 KDF 参数或非法固定长度。

更换主密码为同一 `vault_key` 生成新 salt、wrapping nonce/key。Header 是 payload AAD，因此 payload 在同一原子提交中重新加密。Backup 是完整加密 envelope，不是 plaintext export。

## Payload 所有权

`VaultPayload` 包含：

- login item、trash、bounded revision history；
- payment card、card trash/history；
- SSH credential、SSH trash/history；
- identity、identity trash/history；
- developer/service `secrets`；
- default-empty `services`、`service_trash`、bounded `service_history` 与 service aggregation decisions；Service 只保存
  非秘密组织 metadata 和 typed opaque item reference，不保存或复制源 item 的受保护值与 target authority；
- default-empty `api_environments`、`api_environment_trash` 与 bounded `api_environment_history`；Environment 保存
  Service ID、canonical origin/base path、可选 openapiUrl、typed auth/Header binding、opaque credential reference、
  revision 与 policy digest，不保存 credential value、派生 snapshot 或独立 Agent enable 状态；
- default-empty `agent_connector_definitions`，只保存 managed-web recipe 与 SSH tunnel 无法从 exact Vault item
  推导的内部 adapter 约束；不保存账号、client permission 或 Agent 可见 definition ID；
- bounded `agent_audit_events`（最多 500 条），只包含安全的 client/account/tool/target class/risk/decision/
  result/count metadata，不包含参数、正文、header、credential、command/output 或本地路径；
- bounded unlock 和 browser-fill audit metadata。

新增 collection/field 必须评估旧 writer 丢字段风险并明确是否提升 format；不得因为 serde default 就绕过
格式所有权。缺失 `password_changed_at` 表示 unknown，不是 old。Renderer DTO 不是 on-disk schema。

由 `vaultmesh_ssh_host_setup` 生成的专属密钥仍是普通、用户可见的 SSH key item。该 item 的可选
`managed_ssh_host` 字段在 ciphertext 内保存 account ID、alias、host、port、username 与 Host Key 指纹，作为
OpenSSH alias 绑定的唯一所有者；renderer-safe summary/detail 只可以投影 `managedSshAlias`，不得投影 account
ID、host、port、username 或 Host Key，本地不得另存
`manifest.json`。公私钥仍使用 SSH item 的既有 protected 字段，桌面 runtime 只能在有界特权流程中读取并物化
到 owner-only OpenSSH 文件。

这是发布前 format-3 development payload 的可选增量：缺失字段表示普通非托管 SSH item；旧 writer 不受支持。
若不受支持的旧 writer 丢弃该字段，后续 setup 因无法解析加密所有者而拒绝复用或覆盖本地 identity，不会扩大
Agent 或远端权限，因此本次不提升 envelope version。当前 writer 的加密 round-trip、原子回滚和重启恢复必须
由 `CT-AGENT-SSH-001` 覆盖。

内部 ConnectorDefinition 的 credential reference、生产 target 和 adapter policy 是 encrypted payload；Agent/MCP
metadata 只从对应 Vault item 派生 opaque account ID、用户标签、kind、capability 与 environment，不暴露 definition
存在性、来源或 ID。Client pairing proof 使用
OS-protected storage；active task lease、confirmation、session、continuation 和 child resource 只存在于内存。
未配置 Vault item 的 Agent discovery candidate 不持久化，只在 Vault 已解锁时从 Login、SSH account 与
developer/service secret 派生 opaque item ID、kind、label 和类型化 tool；cursor 与 pending authorization 只存在于
broker 内存，不能包含 username、target、notes 或 secret。
Agent audit、ConnectorDefinition 与 ApiEnvironment 始终写入 format 3；不存在降级或旧 writer 兼容路径。

Service collections 是发布前 format-3 development payload 的 additive 增量。旧 writer 不受支持；丢失 Service
只移除导航组织，不扩大凭据、target 或 permission，因此不提升 envelope version。关系允许多对多并携带 item kind +
UUID；Core 必须在所有 mutation 与 renderer-safe projection 时验证。Service 删除/rollback 不删除源 item，当前 writer
必须覆盖加密 round-trip、backup/restore、原子回滚和重启恢复。兼容理由见 ADR-0014。

ApiEnvironment 是 authority-bearing encrypted additive collection，但 discovery、future ActionPlan 和 permission 必须
live revalidate exact Environment ID、Service、credential kind/lifecycle、revision 与 policy digest。旧 development writer
丢失 Environment 时，对应账号消失，Vault 外旧规则不得继续执行，因此只会撤销而不会扩大 authority；format 3 不提升，
不提供 downgrade 或自动迁移。Delete/restore、Service/credential lifecycle 和配置漂移提升 revision；相同规范化输入
重复保存幂等。Backup/restore 保留 exact Service/Environment/credential relationship、revision 与 digest。
兼容和 ownership 见 ADR-0015。

旧 Agent 账号配置、其权限规则与 format-2 compatibility 不属于当前数据模型，也不存在读取或投影路径。
当前设备的 persistent Agent authorization 使用独立本地加密规则库：随机 256-bit key 由
Keychain/Credential Manager 保护，owner-only 文件只保存 AEAD ciphertext，AAD 绑定 Agent protocol epoch、Vault
canonical-path namespace 与当前 OS 用户。规则只包含 client key、opaque account、target digest、capability、typed
predicate、lifetime/effect、policy revision 与时间，不包含 secret、请求/响应正文或 active lease。文件/key 损坏、
缺失或 Vault 移动统一回到 Ask；connection lease 与 pending challenge 只在 broker 内存。Permission challenge 最长
保留到其 connection session 结束；30 秒只是当前工具调用等待时限，不是持久授权或 permission pending 的生命周期。

## 受保护数据

- Login password、TOTP seed、2FA recovery codes 和 protected custom field 保持在 ciphertext 内；
  recovery codes 在安全 summary/detail 中只暴露存在性，值只经逐次主密码验证的特权操作读取。
- Card full number、security code 和 PIN 不进入 list/detail。
- SSH password、private key 和 passphrase 不进入 summary/detail；algorithm/fingerprint 可以展示。
- managed SSH host binding 只有 alias 可以进入 summary/detail，用于信息卡片、只读编辑字段、搜索和 MCP 完成
  结果；account ID、target 与 Host Key 不得进入 renderer DTO。
- Developer/service secret value 只允许 replace 或 privileged copy。
- `access-token` Secret 可以作为 Agent authenticated HTTP/lifecycle account；`website` 固定 canonical HTTP(S)
  origin 与可选 base path。Lifecycle state 为 `active/revoked/needs-review`，其中 revoked/needs-review 不进入 Agent
  discovery 或 secret use；rollback/restore 失败必须原子写 needs-review，不能只存在于内存或日志。
- Identity、deleted item 和 pre-edit revision 与活动 item 使用同一 authenticated payload。
- Service name、说明、标签、地址、关系来源和纠错决定位于 ciphertext；summary/detail 只投影站点数量、item kind count
  与可导航的 typed opaque reference，不投影 username、SSH host 或任何 protected value。
- ApiEnvironment origin/base path、auth、Header 与 credential selector 位于 ciphertext。Desktop detail 可以投影
  ordinary literal 和不可展开 typed reference 供用户编辑，但不得投影 credential value；Agent 只获得 opaque ref、批准的
  label/kind/http capability 与可选 openapiUrl，不能获得其他 Environment 字段。
- Audit 只可包含 coarse time、origin、item kind/ID/title、field count；禁止 field name/value 和 device identifier。

## Passkey 表示

软件 Passkey 复用 kind 为 `authenticator-key` 的 protected `SecretItem`，scope 为 `vaultmesh:passkey:v1`。Protected value 保存 RP ID、credential/user handle、P-256 private JWK、counter 和时间戳。

关联 login 的 credential 增加 `login:<uuid>` scope；创建或导入优先使用经 desktop 按当前 RP/origin
重新验证的默认 Login，缺失时可以唯一用户名匹配。未关联 credential 在 UI 中表示为 Passkey-only
login，不得进入普通 Secret/密钥分类。Summary 只包含安全 RP/account metadata、Passkey 标记和
Login/credential opaque ID；WebAuthn response 不包含 private JWK。

## 迁移规则

- Format 改动必须有新版本或明确的向后兼容理由、migration、malformed-input test、旧 Fixture 和 deterministic vector。
- 仅增加 defaulted payload field 不自动提升 envelope version。
- Service 导航 metadata 按 ADR-0014 保留在 format 3；旧开发 writer 不受支持，且丢字段不得被解释为权限或 target。
- 会使旧 writer 丢失 `access-token` Secret 的 revoked/needs-review fail-closed 状态属于 authority expansion，必须
  使用明确的新 format/feature compatibility 与旧 writer refusal；不得以 defaulted field 为由留在旧格式。
- 当前代码不能保留的未知 version/feature 禁止被 mutation。
- 当前版本只创建、写入和读取 format 3；其他所有版本在 KDF 前拒绝。
- Core、FFI、Tauri、renderer、Agent、Browser、quick unlock 和 restore 不提供旧格式 reader、迁移、降级或
  专用备份 API。
- 禁用 Agent 功能只撤销 lease 并保留 format-3 encrypted ConnectorDefinition。
- 加密或文件提交失败必须保留旧文件和旧 unlocked state。
- 不可逆迁移必须在 Change 和 Release 中写明最低可回滚版本或补偿限制。
