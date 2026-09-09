# 局域网客户端发现与可信配对

## LAN-PAIR-001 范围与生命周期

仅 macOS/Windows VaultMesh Tauri 客户端支持 LAN protocol 1。用户必须从不依赖 Vault 解锁的附近设备 UI 显式开启发现；窗口失焦仍可以按既有策略锁定 Vault，但附近设备页保持可用。服务最多运行十分钟，离开页面、系统会话锁定、睡眠、退出、停止或超时必须关闭 mDNS、listener 和所有 pending/connected session。配对与 Vault、Agent、Browser 授权相互独立，不传输或操作 Vault 数据。

## LAN-PAIR-002 发现与认证

使用 `_vaultmesh-pair._tcp.local.`。TXT 只允许 `v=1`、随机 `i` 和一次性 `n`；未知、不完整、过长或非 v1 记录忽略，SRV hostname 必须为本次发现随机生成而非系统 hostname。TCP listener 使用一个临时双栈端口，连接端点和入站来源必须匹配本机活动网卡的同链路网段。TLS 加密 Hello 才交换持久随机设备 ID 与是否由用户发起配对；该 ID 不进入 mDNS。首次 TLS 1.3 会话的双方设备证书、nonce 和 exporter 必须派生相同六位十进制安全短码；两端均确认、双方交换持久化成功状态且本地凭据库/索引均写入成功前不得建立 peer。已配对 peer 必须 mutual TLS 并按持久设备 ID 固定其证书指纹；任何证书变化、版本错误、帧过长、超时、重复、取消或撤销均拒绝连接。

## LAN-PAIR-003 持久化与 UI

设备私钥、持久设备 ID 和 peer proof 使用平台凭据库；owner-only 索引只保存 opaque peer ID、固定证书指纹、协议版本和用户本地标签。typed desktop API 只投影 opaque ref、状态、可编辑标签和配对短码，绝不投影 IP、port、证书、公钥、固定指纹、nonce 或 LAN frame。
