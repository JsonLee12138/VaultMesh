# Native Preview ad-hoc 配对凭据回退

## 问题或目标

最小复现：在 macOS 14.8.7 x86_64 上以仓库的 ad-hoc Debug build 启动 Native Preview，
点击“浏览器扩展 → 启用配对”。

- Expected：生成随机 pairing key，启动 `0600` broker socket，并显示“浏览器扩展配对已启用”。
- Actual：没有 socket 或 Keychain item，配对标记保持 false；`secd` 返回 `-34018`，说明 ad-hoc
  包没有 application identifier/keychain access group entitlement，Data Protection Keychain 拒绝写入。

## 预期行为

- 符合 `REQ-BROWSER-001`：ad-hoc development host 必须能在用户显式启用后配对，revoke 立即失效。
- Debug development pairing key 必须是 32-byte CSPRNG，只能持久化在 Native Preview container
  的 owner-only `0600` 文件中；launcher 只持有定位路径，不包含 secret。
- Broker Unix socket 必须位于 Native Preview container 的短路径，完整 UTF-8 路径不得超过 macOS
  `sockaddr_un.sun_path` 上限，并保持 `0600`。
- 正式签名 package 仍必须使用 app/helper 共享的 OS credential entitlement，不得静默回退到
  development 文件。

## 非目标

- 不改变 Browser RPC v2、HMAC envelope、Vault format、默认 Electron host 或 release signing Gate。
- 不把 development credential 文件用于 Developer ID/notarized package。

## 影响范围

macOS Native Preview pairing service、development host launcher、native-host pairing key loader、
contract tests 和 Native browser 文档。Core、FFI、Vault format、item data、autofill assignment、
Passkey、email 与 SSH 格式无变化。

## 实现约束

- Development file 必须拒绝 symlink/non-regular file、非当前 uid、非 `0600` 权限、过大或非规范
  Base64URL key；读取后使用现有可清零 Buffer。
- Enable 原子写入并设置 `0600`；revoke 删除文件、清除内存并停止 broker。
- Keychain 和 development file 路径不能同时把 secret 写入日志、launcher、manifest 或 RPC。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| BUG-003-REPRO | REQ-BROWSER-001 | `secd -34018` 与缺失 socket 的可定位证据 | AT-BROWSER-001 | Done |
| BUG-003-DEV-CREDENTIAL | REQ-BROWSER-001 | Debug container `0600` pairing file 与 revoke cleanup | CT-NATIVE-BROWSER-001 | Done |
| BUG-003-HOST | REQ-BROWSER-001 | Host 严格读取 owner-only file，launcher 不含 secret | CT-NATIVE-BROWSER-001 | Done |
| BUG-003-SOCKET | REQ-BROWSER-001 | Container short socket path 与 host locator 一致 | CT-NATIVE-BROWSER-001 | Done |
| BUG-003-VERIFY | REQ-BROWSER-001 | Native contract/build、host tests、人工 Enable Pairing | CT-NATIVE-BROWSER-001 | Done |

## 验收与证据

- 修复前：2026-07-22 18:00:43，`secd` 对 Native Preview PID 24514 的 delete/add 均返回
  `NSOSStatusErrorDomain -34018`；`browser-pairing-enabled-v1=0`，Keychain item 和 broker socket 不存在。
- 修复后：2026-07-22 在相同主机重建并重新启动 Debug app；真实点击菜单后
  `browser-pairing-enabled-v1=1`，credential 为当前 uid 所有的 `-rw-------` 43-byte canonical
  Base64URL，broker socket 为 `srw-------`，短路径为 84 bytes。development launcher 只包含 socket
  与 credential locator；Native Host 读取真实 credential 后完成一次 `vault.status` RPC，返回
  `vaultmesh.rpc-result ok`，未输出 secret。
- 回归：Native Host 12 tests、Swift static-link contract、104/104 route parity、Debug/Release Xcode
  build 与 strict ad-hoc codesign、33 Markdown/6 YAML docs check 通过；完整 Chromium page workflows
  仍属于 `AT-BROWSER-001`，本 Bug 不把它标记为 Pass。

## 安全与数据生命周期

Secret 由 app CSPRNG 生成，只进入 app memory、Native Preview container 的 development credential
文件与 native-host HMAC Buffer。文件为 `0600`，revoke 删除，Buffer 使用后清零；不进入 extension
storage、manifest、launcher content、日志、analytics、crash data 或 Vault。

## 兼容与迁移

无 Vault/RPC/ABI 格式变化。Debug rollback 会恢复无法配对的 ad-hoc Keychain 路径；release package
仍受 Developer ID/shared credential entitlement 和 `AT-BROWSER-001` 阻塞。

## Bug 根因（仅 type=bug）

`MacBrowserPairingService` 无条件设置 `kSecUseDataProtectionKeychain=true`，但仓库 build script 使用
ad-hoc signing，产物只有 App Sandbox entitlement。此前 contract 注入合成 pairing secret，未执行真实
app Keychain write，也未从实际 development launcher 读取，因此没有捕获 `-34018`。回归测试将同时
覆盖 development credential 的权限/格式拒绝、launcher locator 与 secret redaction。修复 Keychain
阻塞后，人工复测又暴露原 Application Support broker socket 路径超过 macOS Unix-domain socket
`sun_path` 上限；控制器按失败回滚删除刚生成的凭据，使 UI 仍表现为未配对。短 socket locator 也必须
由 app 与 development host 共同验证。
