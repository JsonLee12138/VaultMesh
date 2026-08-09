# ADR-0013：Agent 可以显式配置持久 OpenSSH 主机别名

- 状态：Accepted
- 日期：2026-07-29
- 关联 Work：`CHG-2026-020-agent-capability-broker`
- 关闭 OPEN：无

## 背景

现有 Agent SSH 工具只在 Rust broker 内使用 Vault 凭据，并且已经支持把一个既有 SSH key
记录的公钥安装到服务器。用户还需要一次性完成服务器专属密钥生成、公钥安装和本机 OpenSSH
别名配置，使本机终端可以使用 `ssh <alias>` 访问 exact SSH 账号。

直接让 Agent 生成或接收私钥、选择任意密钥路径、拼接 SSH config，或者调用 `ssh-keygen` /
`ssh-copy-id` 会把 secret、目标和持久授权交给不可信 Agent，并可能覆盖用户已有配置。另一方面，
持久 OpenSSH 身份一旦配置完成，就不再受 VaultMesh 的逐命令 Agent Action Lease 控制；同一 OS
用户下能够执行 OpenSSH 的进程可以使用该别名。这是用户明确批准的本机外部客户端能力，不得描述成
仍由 Agent broker 隔离的 SSH exec。

## 决策

新增一个 R3 公共动作 `vaultmesh_ssh_host_setup`。Agent 只提交 exact SSH `accountRef` 和受限
`alias`；host、port、username、Host Key、bootstrap authentication、算法、密钥路径、config
选项和输出策略全部由 Rust broker 决定。每次执行必须在原生授权窗口逐次确认 exact alias、
账号、目标和风险，不提供 connection/persistent Allow。

Rust broker 必须：

1. 只生成 ED25519 专属密钥对，并先通过 Core/Runtime 原子事务把公私钥保存成用户可见的 SSH key
   记录。该记录内的 account ID、alias、target 和 Host Key 绑定只存在于加密 Vault payload，不进入
   renderer-safe summary/detail；唯一例外是只读 alias 可以投影到信息卡片和编辑表单。不得使用本地明文
   sidecar manifest 作为所有者。
2. 不设置空白以外的可控 comment，不通过 MCP/IPC、日志、audit、renderer、argv、环境或临时 Agent
   可读响应返回私钥、公钥原文或本地路径。
3. 从加密 Vault key 记录物化私钥、公钥和 host fragment 到 `~/.ssh/vaultmesh/` 下的 VaultMesh 管理路径；
   Unix 私钥必须为 `0600`、目录为 `0700`，公共 config 为 `0600`。不得覆盖既有文件、跟随 symlink
   或修改非 VaultMesh 管理的同名 Host block。
4. 只在 `~/.ssh/config` 顶部维护一条固定的 VaultMesh `Include`；每个 alias 使用独立 fragment，
   固定 `HostName`、`User`、`Port`、`IdentityFile` 和 `IdentitiesOnly yes`。MCP response 只返回
   alias、`ssh <alias>`、生成的 SSH key `credentialRef`、公共指纹和完成状态，不返回 host、username 或路径。
5. 使用 SSH account 当前可用的 password、key 或 SSH agent 作为 bootstrap authentication，
   继续执行 exact Host Key 校验；把生成的公钥安装到远端 `authorized_keys` 后必须用新私钥验证登录。
6. 在远端安装前完成全部本地冲突和可写性预检，并以已原子落盘的加密 Vault key 记录作为 pending
   identity 的唯一绑定所有者，再 create-new 物化本地 key；不得创建 `manifest.json`。远端失败、取消或
   结果不确定时保留该 Vault key 记录与尚未进入 config 的本地 key，返回 typed incomplete/unknown 且禁止
   自动重放；后续用户显式重试必须复用同一 key，利用远端 `authorized_keys` exact-line 幂等安装与 key-login
   验证安全恢复，不得生成第二把 key。
7. 只有远端确认接受新 key 且 key-login 验证通过后才写入 host fragment 和 managed Include。对已经由
   VaultMesh 管理、且 account/target/Host Key/alias 全部一致的配置执行有界幂等验证；新密钥仍能登录时
   返回 `alreadyConfigured`。升级前测试构建留下的 `manifest.json` 只有在本地 key 与加密 Vault 记录
   完全匹配后才可以删除；不匹配时必须 fail closed。
8. 软件信息卡片必须独立显示 `ssh <alias>`；编辑页必须把 alias 显示为只读字段，并隐藏托管公私钥的普通
   替换/清除控件。普通名称、备注、文件夹和收藏可以编辑，但不得借普通保存改变 alias 或托管 key material。

该动作明确建立持久本机 OpenSSH authority。完成后 `ssh <alias>` 不经过 VaultMesh MCP permission
engine；授权 UI 必须清楚说明当前 OS 用户进程可以使用该身份。撤销或删除该本机身份不在本次动作内，
用户继续通过本机文件与服务器 `authorized_keys` 管理；后续若提供自动撤销，必须作为独立类型化动作
定义补偿与恢复语义。

## 原因

- 保留 Agent “不获得私钥”的边界，同时满足标准 OpenSSH 客户端的配置需求。
- exact account 与 broker-owned target/config 防止 Agent 把新身份安装到其他服务器或写入任意路径。
- 加密 Vault 绑定、独立 fragment、create-new 本地物化和显式幂等恢复减少明文 metadata、覆盖用户配置与
  半完成授权的风险。
- R3 exact-only 明确表示这是持久权限提升，而不是普通低风险 SSH 查询。

## 被拒方案

- 把生成的 private key/public key 返回给 Agent：直接违反秘密最小化。
- 让 Agent 提交 host、username、port、IdentityFile 或完整 config：Agent 会成为 target 与本地
  持久策略作者。
- 调用通用 `ssh-keygen`、`ssh-copy-id` 或 shell 修改 config：argv、prompt、PATH、shell quoting
  和部分失败无法满足固定 adapter 边界。
- 使用 `manifest.json` 保存 alias/account/target 绑定：会在 Vault 外建立第二个明文所有者，并使软件内
  SSH key 记录与本地绑定漂移。
- 把该动作归类为 R1/R2 或允许持久自动批准：会低估长期外部 SSH authority。
- 静默覆盖既有 alias/key/config：可能劫持用户已有 SSH 目标或销毁凭据。

## 验证

`CT-AGENT-SSH-001` 必须覆盖 schema/parity、只读 alias 卡片/编辑表单、加密 Vault key/binding 原子持久化与重启恢复、无 manifest、
alias grammar、create-new、权限、symlink/冲突拒绝、config include/fragment、Host Key/target 漂移、远端安装、
新 key 登录验证、pending identity 幂等恢复、
取消与结果不确定性。`CT-AGENT-SECRET-001` 必须证明 MCP/IPC/error/log/audit 中没有 private key、公钥原文和
本地路径。`AT-AGENT-SSH-001` 必须在 macOS 与 Windows packaged app 上验证真实
`ssh <alias>`、权限、升级保留和手工撤销说明。
