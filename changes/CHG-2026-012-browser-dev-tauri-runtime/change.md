# browser:dev 编排 Tauri 开发运行时

## 问题或目标

`pnpm browser:dev` 当前启动 `/Applications/VaultMesh.app`，不是仓库的 Tauri 开发命令。开发者必须先打包安装才能验证 desktop/Host/extension 的当前源码，且 Tauri renderer 不具备开发热更新语义。

## 预期行为

- `REQ-BROWSER-001`：`pnpm browser:dev` 必须启动 `pnpm tauri:dev` 与 `pnpm extension:dev`。
- 启动 Tauri 前必须构建当前 debug Rust native host；Broker 就绪后以固定 extension ID 注册并完成 Host 往返探测。
- 任一开发进程退出、启动失败或收到 Ctrl+C 时，根命令必须结束另一个子进程并返回对应非零状态。

## 非目标

不改变 `tauri:local:package`、release bundle、Vault format、Browser RPC v2、配对授权策略或产品平台范围。

## 影响范围

根开发 orchestrator、Tauri dev/Native Host 启动脚本、Node contract test、Browser Spec 与测试计划。无 Vault、core format、extension storage、RPC schema 或 ABI 变化。

## 实现约束

固定 development key 与专用 Chromium profile 继续复用。脚本只清理开发进程和 device-bound browser pairing metadata，不读取 Vault 或 secret；debug Host 必须来自当前 workspace `target/debug`。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| BDT-010 | REQ-BROWSER-001 | Tauri dev + debug Host 启动与 Broker readiness | CT-BROWSER-001 | Done |
| BDT-020 | REQ-BROWSER-001 | Tauri/WXT 并发生命周期和 Ctrl+C 清理 | CT-BROWSER-001 | Done |
| BDT-030 | REQ-BROWSER-001 | 实际启动与文档/追踪证据 | CT-BROWSER-001 | Done |

## 验收与证据

`pnpm scripts:test` 必须覆盖命令顺序、共享 identity/environment、Host probe 和双进程清理。macOS 实际执行 `pnpm browser:dev` 必须显示 Tauri dev server、debug Rust app、WXT 和 debug Host 均就绪。

实施证据：

- `pnpm scripts:test` 4/4 通过。
- 实际 `pnpm browser:dev` 输出 `pnpm --filter @vaultmesh/tauri-desktop tauri dev`、Vite
  `http://127.0.0.1:1420`、`target/debug/vaultmesh-tauri-desktop`、
  `target/debug/vaultmesh-native-host`，随后启动 WXT 并打开专用 Chrome。
- 实际 Ctrl+C 后，Tauri debug desktop、WXT、专用 Chrome 与 debug Host 进程扫描均无残留。

## 安全与数据生命周期

开发脚本不输出主密码、Vault Key、protected field 或 pairing secret。Keychain pairing 仍由 Tauri runtime 创建；停止命令清理进程，不清理 Vault。

## 兼容与迁移

无数据迁移。`tauri:local:launch` 与 `tauri:local:package` 保持独立，用于已安装包验证；`browser:dev` 只表示源码开发运行时。
