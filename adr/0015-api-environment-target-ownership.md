# ADR-0015：ApiEnvironment 拥有结构化 Agent HTTP target/config

- 状态：Accepted
- 日期：2026-08-04
- 修订：2026-08-04，移除 Environment 级 Agent enable；全部 live Environment 进入安全目录，动作 authority 只由独立 unlock 与 Action Lease 授予
- 关联 Work：`CHG-2026-026-structured-api-profiles`
- 替代范围：`ADR-0011` 中新建结构化环境的 HTTP target/config ownership；direct `access-token` Secret 路径暂保留为不迁移授权的兼容路径
- 关闭 OPEN：无

## 背景

`ADR-0011` 让一个 `access-token` Secret 同时拥有 credential value 与 Agent HTTP origin/base path。该模型适合无配置
的 direct action，但不能表达同一服务的 Production/Staging/Local、Basic/API Key、固定非秘密 Header、protected
Header 或用户选择的 OpenAPI 地址。让 Agent 提交 target、Header 或 auth strategy 会使不可信调用方成为权限范围作者；
把 credential value 复制进环境又会产生第二秘密所有者。

Service Hub 已由 `ADR-0014` 提供稳定 Service ID、非级联删除与 format-3 encrypted metadata。VaultMesh 需要在该
Service 下增加用户手动管理的结构化环境，并在不执行请求的阶段先完成持久化、桌面编辑和安全 discovery。

## 决策

`ApiEnvironment` 是结构化 Agent HTTP 的唯一 target/config owner，拥有 canonical HTTP(S) origin、可选 base path、
环境分类、固定 Header、auth binding、revision 与 policy digest。Login/Secret 继续是 credential value
及 lifecycle 的唯一 owner；Environment 只保存 typed opaque item/field reference 与 Secret expected kind，不保存 value、
派生 credential 或 snapshot。

Environment CRUD、credential picker 和 Header 编辑只存在于 desktop typed API。所有 Service/reference/lifecycle 均 live 的
Environment 都进入 Agent 安全目录，不设置 Environment 级 Agent enable。Agent discovery 使用独立 allowlist DTO，只返回
opaque `environmentRef`/`accountRef`、Service + Environment label、environment kind、
`http` semantic capability 和用户手动保存的可选 `openapiUrl`。不得返回 origin、base path、auth method、Header、
credential reference、username、scope 或 notes。`openapiUrl` 不由 VaultMesh 下载、解析、认证或用于 target/permission。
目录可见性只允许 Agent 引用环境，不授予任何动作 authority；每个动作仍需独立 Agent unlock，并按风险经过 Action Lease
和适用的逐次确认。

Environment target/auth/Header/credential/service 或所引用 credential lifecycle 改变时，core 必须提升不可变
revision 并重算 policy digest；目录 revision 必须包含该不可见 digest，使旧 cursor fail closed。未来 ActionPlan、
confirmation、connection/persistent permission 和 child resource 必须绑定 exact environment ID、revision、target/policy
digest、capability 与 method/path predicate，任一漂移回到 Ask 或拒绝。Service/credential delete、trash、restore、purge、
Secret kind drift、revoked 或 needs-review 都不得静默改绑或恢复旧 authority。

记录作为 default-empty collection 保存在 encrypted format-3 payload，并覆盖 trash/history、原子 mutation、backup/restore
与重启。已存在的发布前 `agentEnabled` 字段不再拥有语义，reader 忽略该字段且当前 writer 在下一次写入时移除；此前为
`false` 的 live Environment 也会进入安全目录，但不会继承或获得动作 permission。旧 development writer 不受支持；若丢失 Environment，live revalidation 会使对应 Agent account/permission 不可用，
不能把 Vault 外旧规则解释为仍有效，因此不提升 envelope version、不提供 downgrade 或自动迁移。

本 Work 只交付配置与 discovery，不让 `vaultmesh_http_request` 执行 ApiEnvironment。执行由
`CHG-2026-028-agent-api-environment-execution` 接入。`ADR-0011` 的 direct access-token Secret HTTP 在该执行 Work 完成前
保留为显式兼容路径；不会自动生成 Environment、复制 Secret 或迁移任何 connection/persistent permission。用户新建
Environment 后首次执行必须重新 Ask。后续移除 direct 路径需要独立 Work 和发布/回滚证据。

Agent 永远不能创建、修改、启停或建议写入 Environment，也不能提交 Header、auth strategy、credential selector、
完整 URL、origin、base path、wildcard、redirect/TLS policy、risk 或显示文案。

## 原因

- target/config 与 credential value 分离后，一个凭据可被显式绑定，但秘密仍只有原 item 一个 owner。
- 用户而非 Agent 编写环境与 Header，防止工具参数扩大 credential destination 或权限范围。
- revision + digest + live reference validation 能在 metadata 未投影给 Agent 的情况下使 cursor 和未来 authority fail closed。
- format-3 encrypted payload保留 backup/restore 与原子提交语义；旧 writer 丢字段只会撤销能力，不会扩大能力。
- 暂留 direct Secret 路径避免在执行实现尚未交付时伪造迁移或破坏已存在开发流程。

## 后果

- Core、desktop typed API/UI 与 Agent catalog 增加 ApiEnvironment schema；Browser RPC/extension 不变化。
- `openapiUrl` 是 Agent 可见的非秘密例外，UI 必须明确提示；它不参与 target identity。
- Environment 编辑器不提供 Agent enable/disable；发现后的首次动作与无匹配 lease 的后续动作必须回到 Ask。
- OAuth refresh、JWT signing、mTLS、Cookie、脚本、redirect/proxy/TLS override 和实际网络执行不在本 Work。
- macOS/Windows packaged AT 必须分别在目标 OS 验证编辑、引用、锁定清理、全部 live Environment 的真实 MCP discovery
  与动作仍需独立授权。

## 被拒方案

- 继续让每个 Secret 同时拥有所有环境/认证/Header：不能表达多个 target/config，且把凭据与环境生命周期耦合。
- Agent 提交完整 URL、Header 或 auth strategy：让不可信调用方成为 target 与权限作者。
- 把 Token/API Key/password 复制到 Environment：产生第二 secret owner 与不同步 snapshot。
- 从 Secret website/notes/custom field 自动生成 Environment：无法安全推断 auth/header，且会让非用户编写配置进入目录。
- 保留 Environment 级 Agent enable：它与动作级 Action Lease 形成第二套易漂移的授权状态；目录安全投影本身不使用秘密，
  不能代替或绕过真正的动作授权。
- 在本 Work 同时切换 HTTP 执行：会把配置、发现、权限迁移和网络 adapter 合并成不可独立验证的边界变化。

## 验证

`CT-API-PROFILE-001`、`CT-AGENT-ACCOUNT-001`、`CT-AGENT-DISCOVERY-002`、`CT-AGENT-SECRET-001`、
`CT-AGENT-AUTHZ-002`、`CT-AGENT-LIFECYCLE-001`、`CT-RECOVERY-001`、`CT-REL-001`、`CT-COMPAT-001`、
`CT-PRIV-001` 与 `AT-API-PROFILE-001` 覆盖结构、恶意输入、原子回滚、引用漂移、目录游标、秘密省略、
backup/restore 和目标平台 UI/MCP 验收。
