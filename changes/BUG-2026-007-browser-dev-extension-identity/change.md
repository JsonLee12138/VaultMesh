# browser:dev 使用一致的扩展与 Host 开发身份

## 问题或目标

- 最小复现：已安装本地 Tauri App 后执行 `pnpm browser:dev`，等待 WXT 启动并打开扩展 popup。
- Expected：同一命令启动/连接 Tauri broker，注册 Rust native host，并让 WXT 使用 manifest
  `allowed_origins` 对应的固定开发扩展 ID。
- Actual：桌面端和 Host 已启动，但 popup 显示“未连接 VaultMesh 桌面端”。

## 预期行为

- `REQ-BROWSER-001`：`pnpm browser:dev` 必须把同一固定开发 key、由该 key 派生的 extension ID
  和 `com.vaultmesh.browser` Host name 传给 Host 注册及 WXT 进程。
- WXT 必须使用确定的专用 development profile，并在启动前把 Host manifest 注册到该 profile。
- 启动 WXT 前必须完成 Rust Host→Tauri broker 的 `vault.status` 往返探测。
- 显式配置的 extension ID 与 key 派生 ID 不一致时，命令必须在启动 App/扩展前失败。
- 子进程退出或启动失败必须使根命令返回非零，不留下“成功启动”的误导状态。

## 非目标

- 不改变 release extension key、Browser RPC v2、pairing secret、Vault authorization 或用户数据。
- 不把 WXT 开发服务器嵌入 Tauri 进程。
- 不让开发命令自动解锁 desktop/browser authorization。

## 影响范围

- 根 `browser:dev` 命令改为单一 orchestrator script。
- Tauri local launch 接收经过验证的 extension ID 并用它注册 Rust host。
- 新增纯 Node contract test，不需要启动浏览器、读取 Vault 或修改系统注册。
- 实际启动使用专用浏览器 profile；Tauri runtime freshness 由源码与已安装 executable mtime 比较。

## 实现约束

- key 是公开的 development-only manifest key，不是 pairing secret。
- pairing secret、Vault、主密码和 user-data 不进入脚本参数、输出或测试。
- Host manifest 的 `allowed_origins` 和 WXT manifest key 必须来自同一环境对象。
- macOS 实际 App/Host 启动仍由现有窄脚本负责；测试使用依赖注入，不修改系统状态。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| BDI-010 | REQ-BROWSER-001 | 复现 identity/profile propagation | CT-BROWSER-001 | Done |
| BDI-020 | REQ-BROWSER-001 | Tauri browser-dev orchestrator、Host probe 与 fail-fast validation | CT-BROWSER-001 | Done |
| BDI-030 | REQ-BROWSER-001 | 根命令、CI、Spec 和证据同步 | CT-BROWSER-001 | Done |

## 验收与证据

- 默认开发 key、派生 ID、Host name 和 manifest allowed origin 必须严格一致。
- 自定义 key 可以派生自身 ID；显式错误 ID 必须在任何启动 side effect 前拒绝。
- `pnpm scripts:test`、extension typecheck/build、Browser parity、Tauri source ownership 和 docs check
  必须通过。
- 实际 `pnpm browser:dev` 必须让专用 Chrome 以固定 ID 拉起新的 Rust Host；新版
  `vault.workspace` 必须为每条 Login summary 返回 `hasPassword`。

## 安全与数据生命周期

固定 development key 是 Chromium manifest public key，只用于稳定扩展 ID。Host pairing secret
仍由 Tauri/Keychain 拥有，脚本不读取或记录。测试只使用公开 identity metadata。

## 兼容与迁移

无 Vault format、Browser RPC、ABI、settings、pairing 或 user-data 迁移。固定 identity/profile
约束继续有效；`CHG-2026-012` 后续将启动 owner 改为仓库的 Tauri dev runtime。

## Bug 根因

`CHG-2026-008` 将 `browser:dev` 简化为 `tauri:local:launch && extension:dev`，遗漏了三项集成约束：

1. Host 使用 `developmentExtensionId`，WXT 未继承对应 `WXT_CHROME_EXTENSION_KEY`；
2. WXT 创建临时 Chrome profile，但 Host manifest 未注册到该 profile，Chrome 未拉起 Host；
3. 命令无 runtime freshness 检查，旧 `/Applications/VaultMesh.app` 返回缺少 `hasPassword` 的旧
   Login summary，扩展 workspace schema 因而拒绝整份响应。

既有测试分别覆盖 key→ID 和 Host plan，没有覆盖根命令的 identity/profile 传播、真实 Host 往返和
已安装 runtime freshness。

## 实施证据

- 修复前实际 WXT 临时 profile 缺少 `NativeMessagingHosts/com.vaultmesh.browser.json`，Chrome 未创建
  对应 Host 子进程。
- 修复后专用 Chrome profile 包含固定 origin manifest，Chrome 以
  `chrome-extension://dmmjcaemejijgkpginfccokjmbknbgif/` 拉起 Rust Host。
- 旧安装的结构探测为 504/504 Login summary 缺少 `hasPassword`；执行
  `pnpm tauri:local:package` 后为 504/504 包含该布尔字段，Host `vault.workspace` 返回 `ok: true`。
- `pnpm scripts:test` 4/4、`pnpm extension:typecheck`、`pnpm verify:browser-parity`、
  `pnpm verify:tauri-source`、`pnpm docs:check` 均通过。
