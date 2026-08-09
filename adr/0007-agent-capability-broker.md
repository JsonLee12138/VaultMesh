# ADR-0007：Agent 只获得能力，不获得凭据

- 状态：Accepted
- 日期：2026-07-25
- 修订：2026-07-27（短时 connection session 透明轮换；独立 MCP Vault unlock lease；App 重启后 shim 安全重连与动作重放边界；移除 MCP session 状态/锁定工具；`ADR-0010` 增加显式 client-shared unlock scope）；2026-08-05（移除未发布 credential lifecycle Agent 工具）
- 关联 Work：`CHG-2026-020-agent-capability-broker`
- Superseded in part by：`ADR-0008`（直接动作授权）、`ADR-0011`（direct Secret HTTP）、`ADR-0012`（移除 Agent Profile 与 format 2）；credential lifecycle 切片由 `CHG-2026-020` 移除
- 关闭 OPEN：无

## 背景

Codex、OpenCode 等本地 Agent 需要执行 SSH 运维、访问受认证的 HTTP/网页、调用依赖凭据的
以及完成 OTP、Passkey 等操作。把密码、Token、Cookie、私钥或一次性验证码通过 MCP
response、环境变量、命令参数、临时文件或可读取的浏览器 DOM 交给 Agent，会把 Agent 及其上下文、
日志、插件和子进程全部扩大为秘密所有者，也无法满足 VaultMesh 的秘密最小化边界。

同时，单纯提供通用 shell、通用 curl 或通用浏览器控制，并在内部注入秘密，会形成 confused deputy：
Agent 可以改变目标、重定向、参数或输出路径，让合法凭据被发送到未授权位置或被回显。当前 Browser
RPC 的授权也不能直接复用于 Agent，因为扩展身份、页面绑定、用户手势和生命周期与本地 Agent
任务不同。

## 决策

VaultMesh 必须新增由 Tauri Rust privileged runtime 拥有的 Agent Capability Broker。MCP adapter
只是可替换的非秘密 transport shim，不得打开 Vault、缓存 Vault response、持有 Vault credential、解释
授权策略或直接执行特权操作。所有本地 MCP client 使用同一 stdio/IPC 流程，并通过
`--client <client-key>` 提供稳定、自定义的 integration key；Codex/OpenCode 不构成产品枚举或白名单。
MCP 标准不认证该 key，所以它只表示用户明确批准的本地集成，而不是经过验证的软件品牌。Broker 必须把
PID、parent PID、进程创建时间、路径、binary hash 和 `clientInfo` 等连接证据与持久 identity
分开；它们只用于当前连接校验，不写入 pairing record。持久 pairing proof 绑定规范化 client key、当前 OS 用户与
protocol epoch 并由 OS credential storage 保护；proof 不得进入配置、环境或仓库。撤销删除 proof并要求重配。

首个版本必须只支持当前用户会话中的本地 Agent：任意兼容 client 通过 stdio 启动 MCP adapter，
adapter 再连接 owner-only Unix domain socket 或 Windows named pipe。不得在首个版本开放监听 TCP 的
MCP endpoint、云端 Agent 接入、端口映射或远程 bearer-token 管理面。

Broker 必须使用独立于 Desktop 与 Browser 的 Agent authorization。授权单位是：

```text
AgentClient × ConnectionSession × AccountRef × Capability × Target × CanonicalRequest × Expiry
```

首次未配对连接必须显示独立、置顶、content-protected 的系统配对窗口而不打开主窗口。配对只批准本地
integration identity，不要求或创建 Vault authorization。配对窗口使用独立最小 capability，只能读取 safe
状态和裁决当前 pairing，不能调用
主 renderer 的通用 typed dispatcher。配对只裁决窗口显示的自报 integration key，不声称识别客户端产品；
SSH、HTTP、managed web 等能力仍在实际调用时裁决。短生命周期 MCP 探测进程退出后，broker
只在内存中有界保留待配对 key，
同一身份重连只刷新该申请；无当前连接时批准必须先成功持久化 OS-protected pairing proof，使下一次连接直接
继续。拒绝或关闭窗口终止同一身份的当前连接；设置页只负责查看和撤销已经配对的客户端。批准或拒绝的
command response 返回后立即关闭窗口。

完成 pairing 后，默认每个真实 stdio transport 必须在首个 Vault 调用时进入第三个独立、置顶、content-protected
的 Agent unlock window。该窗口只接受用户输入的主密码或 Agent 专用 PIN/biometric，不与 pairing 或 action
authorization 复用 capability。MCP tool、shim 与 Agent IPC 永远不接收 factor。成功后签发绑定 client、verified
transport generation 与 Vault namespace 的 memory-only unlock lease；desktop、browser 或其他 client 的已解锁
状态不能创建或借用该 lease。`ADR-0010` 允许用户显式切换为同一 pairing identity 的并行 transport 共享
memory-only lease；最后一条真实 transport 断开、显式 Agent lock、pairing revoke、系统锁定/睡眠、退出和
最后 lease 消失清除 Agent-only runtime；内部 connection session 透明轮换不清除有效 unlock lease。

完成 pairing 后，broker 必须为当前 stdio connection 自动创建唯一活动短时 session。session 只负责 TTL、配额、
重放防护、临时权限与资源清理，不得成为用户可管理或 Agent 可创建的第二套授权。短时 session 到期必须先
清除旧 lease、pending、continuation 与子资源，再在同一仍存活、已验证且已配对的 transport 内透明签发新的
基础 session；不得把内部 TTL 解释为 MCP transport 寿命或要求用户重连。Vault 锁定执行相同 authority 清理，
但保留当前 transport identity 并对 Vault 动作返回 typed lock error；解锁后同一连接可以取得新基础 session。
VaultMesh App 重启会销毁 transport 与全部内存 authority，但仍存活的 stdio shim 必须使用原 client key 自动
连接新 broker 并重新 hello，不要求重启 MCP client。新连接只能复用有效 pairing proof 与持久 permission rule，
必须取得新 session 和 unlock lease。IPC frame 未完整送达时可用同一 request ID 重送；完整送达后响应丢失只可
自动重放 R0 幂等操作，其他动作必须返回 `execution-unknown`，不得为追求无感恢复而冒险重复副作用。MCP
不暴露 session 状态查询、Agent lock 或 unlock 工具；这些状态和生命周期只由 VaultMesh 本地软件控制，
锁定期间需要 Vault 的调用返回 typed lock error。
Broker 可以从已解锁 Vault 以 cursor 分页派生 Login、SSH account 与 developer/service secret 的 opaque item
ID、kind 与用户标签，但不得披露 username、target、notes 或 secret。Agent 可以引用 exact Vault item 与
registry 中兼容的 tool，或请求既有类型化 Profile 中的 exact tool/named operation；它不能自报 credential、
target、URL、selector、binary、命令/schema/risk 或摘要来定义能力。没有兼容持久 Profile 时，broker 必须
只从 Vault item 的已有结构化字段和版本化内置规则生成 session-bound、memory-only system Profile；原生 UI
展示重建后的 target/operation/risk/output policy，用户选择仅本次或当前连接允许后直接继续。字段或内置规则
不足必须在 MCP 边界返回稳定错误、`missingFields` 和重试提示；Agent 只能选择公开内置 operation/有界参数，
或提示用户补全 Vault 条目后重试。system Profile 不写盘、不创建 Automatic rule，并在 connection terminal path 清除。

调用规则固定为：Automatic 只允许 R0/R1；R2 最多缓存到当前 connection session 且仍需要 fresh canonical
confirmation；R3/R4 只能逐次 privileged confirmation。任何权限规则都不能绕过 connection session、
profile risk ceiling、canonical request、expiry、confirmation 或 adapter policy。

所有会使用秘密的操作必须由 broker 内部从 `vault-core` 的 active unlocked session 获取
`Zeroizing`/有界 bytes，并直接交给固定 protocol adapter。秘密不得序列化进 MCP/IPC DTO、日志、
audit、renderer state、环境持久化、命令行、临时身份文件或 Agent 可读取的 DOM。

MCP surface 必须是穷举的动作工具，不得提供 `get_password`、`get_api_key`、`get_private_key`、
`get_cookie`、`get_otp`、`export_secret`、通用 `run_shell_with_env` 或等价能力。Reveal、copy、unlock、
backup/restore 和主密码/PIN/biometric 输入只可以请求 VaultMesh 本地 UI，不能把结果返回 Agent。

多账号必须使用本地 opaque `account_ref`。绑定记录必须保存在加密 Vault payload，并同时绑定
credential item、connector kind、目标约束、允许的 capability、风险级别和展示标签；它不是
VaultMesh 云账号，不引入服务端账号、同步或分享。

第一次持久化非空 Agent profile collection 必须把 Vault envelope 从 v1 原子迁移到 v2。迁移要求原生
主密码重新验证，使用同一随机 `vault_key`、新 salt 和 wrapping nonce，把 version 2 同时绑定到 wrapped-key
与 payload AAD；不得只改 header。支持 Agent 的版本读取 v1/v2，但 v1 禁止保存非空 profiles。旧版本必须
因 unknown v2 在 KDF 前 fail closed。只有 profiles 已清空、已完成加密 backup 且再次验证主密码时，才允许
显式 v2→v1 重写；禁用 Agent 或普通保存不得自动降级。

Permission rule 作为 Agent Profile 的 additive encrypted field 保存在 v2，且只绑定 client key、Profile、
tool 与 named operation，不绑定 PID、路径、binary identity 或 workspace。缺失或被旧 v2 writer 丢弃时
必须解释为 Ask，因此兼容写入最多降低自动权限，不能扩大权限；Deny 丢失后也只能回到原生询问，不能
自动执行。现有 Profile 升级时不得生成 Automatic rule。

协议 adapter 必须优先于通用执行器：SSH 使用 Rust SSH session 完成认证后再开 channel；HTTP 在
broker 内注入认证并逐跳验证目标；managed web 使用 VaultMesh 独占的隔离浏览器 profile。任意 shell/PTY 不得收到 credential environment；`sudo`
只允许已配置的最小 sudoers 与 `sudo -n`，不得识别密码提示并自动发送密码。

Passkey 的 Agent 路径必须由 managed-web broker 从批准的固定 selector 动作捕获页面 WebAuthn public
request，并只给 Agent 单次 opaque requestRef；request JSON/challenge 不进入 Agent 边界。Rust Passkey
service 在原生确认后拥有私钥使用和 Vault mutation，并把 public WebAuthn response 直接完成到原页面
Promise。Broker 不提供 credential generate/test/rotate/revoke Agent 工具；凭据管理只由本地 UI 拥有，
普通 HTTP 动作不得通过 Agent 自行拼接成为读取或写入 credential 的等价入口。

VaultMesh 原生授权是最终裁决者。MCP host 自带的 tool approval 只作为附加提示，不得替代 broker
的 policy、fresh confirmation 或拒绝决定。高风险确认必须绑定规范化请求摘要并且短时、单次使用；
任何参数、账号、目标或 body digest 变化都必须使确认失效。

所谓“不披露凭据”必须精确定义为：VaultMesh 不把凭据材料或可逆表示写入 Agent 边界，且只通过
固定 adapter 把它用于已批准目标。远程命令输出、API 数据和网页业务内容可能本身敏感，必须经过
大小、类型、字段和 redaction policy 后才可返回；产品不得声称 Agent 永远看不到任何敏感业务数据。
对于已批准但恶意或被攻陷的远端服务、binary 或操作系统，无法从客户端提供绝对保密保证，必须由
目标绑定、binary identity、最小权限和输出 schema 降低风险，并在产品威胁模型中明确。

## 原因

- 保持 `vault-core` 与 Tauri Rust runtime 的既有秘密所有权，不把 Agent 变成新的 Vault client。
- 动作级 capability 可以约束账号、目标、命令和生命周期，避免原始 secret API 与通用 shell 的组合攻击。
- 本地 stdio 加 owner-only IPC 适配 Codex/OpenCode，同时不引入 VaultMesh 服务端或远程管理面。
- 独立 Agent authorization 防止 desktop/browser 解锁被错误提升为自动化授权。
- 加密 account profile 支持多账号，又不把凭据引用和生产目标策略放入非秘密 settings。
- 分页 Vault candidate 与 session-bound system Profile 让用户用系统权限式交互替代预配置/手写授权 JSON，
  同时保持 exact typed policy owner；Agent 只能选择“哪个条目、哪类工具、哪个公开内置 operation”，不能
  成为 target/operation 策略作者。

## 后果

- 新功能必须新增 Agent 专项 Spec、Requirement/Test、MCP/IPC schema、policy parity 和平台验收。
- encrypted payload 新增 default-empty agent profile collection；非空 collection 只能存在于 envelope v2。
  这增加一次显式格式迁移、主密码重新验证、旧版 fail-closed 与受控降级 Gate。
- SSH non-PTY、HTTP 与 managed web 可以先形成垂直切片；PTY 必须在基础授权
  和清理证据稳定后单独启用。
- managed web 不能复用 Agent 可控制的浏览器 profile；新增浏览器 runtime/依赖需要单独完成许可、
  更新、sandbox 和目标平台打包审查。
- 每个 adapter 都需要拒绝、取消、重复、锁定、过期、重定向、输出截断和 final-lock cleanup 测试。
- Agent 可以获得远程资源结果，因此审计 UI 必须明确区分“凭据未披露”与“业务结果已返回”。
- 产品 UI 不显示 Profile/Vault format 编辑区；permission request 直接显示 broker 重建的系统策略与裁决按钮。
  既有持久 Profile 只作为加密兼容数据保留，新的候选授权使用 session-bound memory-only system Profile。

## 被拒方案

- MCP 直接读取 Vault secret：把 Agent、日志和模型上下文变成秘密所有者，无法可靠撤回。
- 将秘密注册为 Agent shell 的长期环境变量：同用户进程、子进程、调试输出和 shell history 都可能读取。
- 通用 shell/curl/browser 工具内部注入秘密：目标与参数不可证明，容易产生 confused deputy 和回显。
- 复用 Browser RPC pairing/session：浏览器页面身份与 Agent connection 身份不同，撤销和授权语义会混淆。
- MCP adapter 自己解密或持有 Vault Key：形成第二个 Vault client 和新的持久秘密边界。
- 首版提供远程 HTTP MCP：与当前 local-first、single-device 范围冲突，并新增网络身份与服务端运维面。
- 继续用 format 1 加 encrypted feature marker：已经发布的 v1 writer 不认识 marker，仍可忽略未知字段并
  保存，从而静默删除 Agent profiles；无法证明 old-writer refusal。
- 让 Agent 直接提交 target、selector、command、URL 或 schema 创建 Profile：Agent 会成为策略作者并形成
  confused deputy；动态申请只能引用 exact Vault item/registry tool 或 VaultMesh 已存在且已验证的类型化能力。
  由请求触发、但完全由 broker-owned metadata 与原生 connector builder 定义并经用户确认的 Profile 创建允许。
- 把“永久允许”解释为跳过所有高风险确认：持久授权会放大 R2–R4 mutation/privileged/destructive 权限；
  permission rule 只能决定能力是否可申请，不能替代高风险 canonical confirmation。

## 验证

由 `CHG-2026-020-agent-capability-broker` 在 Accepted 时登记的 `CT-AGENT-*`、
`AT-AGENT-*`、协议恶意输入套件、secret canary 扫描、macOS/Windows packaged E2E 和独立安全审计验证。
