# 发布 Chrome 与 Firefox 浏览器扩展 ZIP

## 问题或目标

Review Draft 当前只有桌面安装包，浏览器扩展没有可下载的安装 ZIP；现有产品范围和 Native Messaging 注册也只覆盖 Chromium。需要从同一 Review source SHA 生成 Chrome/Chromium 与 Firefox 扩展包，并让 Firefox 包能够通过已安装桌面端连接受认证的 Rust Native Host。

## 预期行为

- `REQ-BROWSER-004`：Chrome/Chromium 必须继续生成固定 ID 的 MV3 ZIP；Firefox 必须生成固定 Gecko ID 的 MV2 ZIP。两个包使用同一产品版本、协议与瞬态秘密边界。
- Firefox manifest 必须省略 Chromium-only `minimum_chrome_version`、manifest key 与 `webAuthenticationProxy` permission；Passkey proxy 仍只属于 Chromium。
- macOS/Windows 桌面安装必须分别提供 Chrome `allowed_origins` 和 Firefox `allowed_extensions` manifest。Host 必须在读取配对 secret 前验证浏览器传入的固定身份与 Firefox manifest 路径。
- Review workflow 必须从同一 source SHA 构建两个 ZIP，校验 manifest/browser/version/ZIP 完整性，并在桌面 R2 发布成功后把两个 ZIP与四个桌面安装包一起上传到 GitHub Draft Prerelease。Draft 仍不创建 Git Tag、不计为正式发布。
- 既有 `0.0.3-review` immutable Review 资产不得覆盖；包含双浏览器扩展的下一次完整 Review build 使用严格递增的 `0.0.4-review`。

## 非目标

- 不自动提交 Chrome Web Store、Firefox Add-ons 或 Edge Add-ons 商店审核。
- 不为 Firefox 实现 Chromium `webAuthenticationProxy` Passkey 能力。
- 不增加 Safari、移动端或浏览器内 Vault owner。
- 不把 Draft Prerelease 公开为正式 Release。

## 影响范围

影响 WXT manifest/ZIP、Chrome/Firefox Native Messaging identity、macOS/Windows Host 安装注册、Review GitHub Actions 与 Draft 资产。Vault format、Browser RPC v2 操作集合、Native ABI、secret owner 和桌面 updater manifest 不变。

## 实现约束

- Chrome key 与 Firefox Gecko ID 都必须在构建前固定并验证；Review Draft 必须显式选择仓库固定的 `sideload-review` 公共身份，不需要商店凭证；商店或正式公开发布不得复用该 sideload 身份。
- 浏览器特定 manifest 必须由同一个 WXT配置按目标生成，不维护两份功能源码。
- Firefox Host 启动只接受官方参数形态：完整 manifest path 与精确 Gecko ID；Chrome 继续只接受精确 `chrome-extension://<id>/` origin。未知、缺失、路径漂移或混合参数必须 fail closed。
- Firefox manifest 与 Chrome manifest 分开落盘，卸载必须同时清除；现有 Chrome/Edge 注册保持兼容。
- GitHub Draft 上传可安全重跑但不得覆盖同名不同内容资产；同版本重复 R2 发布继续 fail closed。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| `EXTREL-001` | `REQ-BROWSER-004` | Scope、Requirement、ADR、Browser Spec、Gate 与 Traceability 接受 Firefox 分发边界 | `CT-BROWSER-PACKAGE-001` | Done |
| `EXTREL-002` | `REQ-BROWSER-004` | WXT 生成版本一致且权限正确的 Chrome/Firefox ZIP | `CT-BROWSER-PACKAGE-001` | Done |
| `EXTREL-003` | `REQ-BROWSER-004` | macOS/Windows 双 manifest 注册与 Native Host 双身份 fail-closed | `CT-BROWSER-PACKAGE-001`, `AT-BROWSER-001`, `AT-BROWSER-FIREFOX-001` | Implementing |
| `EXTREL-004` | `REQ-BROWSER-004` | Review workflow 上传同 source SHA 的六个 Draft 安装资产 | `CT-BROWSER-PACKAGE-001` | Done |
| `EXTREL-005` | `REQ-BROWSER-004` | 目标 OS 上安装 ZIP、pair/revoke、RPC mismatch、重启与卸载验收 | `AT-BROWSER-001`, `AT-BROWSER-FIREFOX-001` | Pending |

## 验收与证据

- 自动化必须解析两个 ZIP 内的 manifest，验证浏览器目标、版本、固定身份、permission 差异、无 source map/秘密文件与 ZIP CRC。
- macOS/Windows CT 必须验证两个 manifest 的位置、唯一允许身份、安装/重复安装/卸载计划；Host 单元测试覆盖 Chrome、Firefox、缺参、伪造 ID、错误 manifest path 与混合参数。
- GitHub Actions 必须证明扩展 job 和桌面 jobs 使用同一 commit，Draft 恰有两个 DMG、NSIS、MSI、Chrome ZIP 与 Firefox ZIP。
- Chrome/Edge 与 Firefox 的真实安装、Native Messaging、pair/revoke、锁定、重启和卸载必须在目标 OS 执行；平台 AT 未完成前 Work 保持 Implementing。

### 当前证据

- `pnpm scripts:test`：82/82 Pass，覆盖 release ZIP、浏览器 identity、macOS/Windows Host 安装计划与 Review 版本约束。
- `pnpm extension:typecheck` 与 `pnpm extension:test`：Pass，39 files / 234 tests。
- `cargo test -p vaultmesh-tauri-desktop browser_host_registration`：2/2 Pass；`cargo test -p vaultmesh-tauri-desktop --bin vaultmesh-native-host`：macOS browser launch identity 1/1 Pass。
- 设置 `VAULTMESH_EXTENSION_DISTRIBUTION=sideload-review`、不提供任何商店凭证运行 `scripts/build-browser-extension-release.mjs`：生成 `VaultMesh_0.0.4-review_chrome-extension.zip` 与 `VaultMesh_0.0.4-review_firefox-extension.zip`（约 491 KiB/490 KiB）；两个 ZIP CRC、路径、秘密文件/source map 排除和浏览器特定 manifest 校验均 Pass。产物位于任务临时目录，未写入仓库。
- Windows target cross-check 在 macOS 上因缺少 Windows SDK headers、Windows link environment 与兼容 OpenSSL Perl 工具链而不可执行；Windows Native Host 编译、MSI/NSIS 注册、真实 Firefox 通信与卸载必须由 `windows-2025` runner 和目标机 AT 证明。
- Review workflow 已声明扩展与三个桌面构建使用同一 source SHA，并把 Chrome/Firefox ZIP 纳入六资产 Draft gate；按用户确认只发布本地 ZIP，workflow 显式选择仓库固定的 `sideload-review` 公共身份，不读取或要求任何浏览器商店凭证。未显式选择 sideload 模式的 release build 继续 fail closed。
- GitHub Actions run `31369895049`（source `ffff2d6419dbd9201d1e65713554d5c6fe3762f8`）：Chrome/Firefox ZIP、macOS ARM64、macOS Intel、Windows NSIS/MSI、R2 immutable/latest 与 GitHub Draft jobs 全部 Success。R2 Review manifest 为 `0.0.4-review`，包含 `darwin-aarch64`、`darwin-x86_64`、`windows-x86_64`。
- GitHub Draft Prerelease `untagged-e0857713c199c221dff8`：六个预期资产均为 `uploaded`，包括 `VaultMesh_0.0.4-review_chrome-extension.zip` 与 `VaultMesh_0.0.4-review_firefox-extension.zip`；远端 `v0.0.4-review` Git Tag 不存在。Draft 只提供本地安装下载，不代表浏览器商店或正式产品发布。

## 安全与数据生命周期

两个扩展都只持有瞬态 UI/RPC状态；不打开 Vault、不持有 Vault Key、不持久化 RPC response 或受保护值。Firefox ID、Chrome public key/ID 与安装 manifest 是公开身份材料；配对 HMAC secret 继续只由桌面运行时和 Native Host在现有 OS credential owner 中读取。

## 兼容与迁移

无 Vault format、Browser RPC、Native ABI 或数据迁移。Chrome/Edge 现有固定 ID 和注册路径不变；新桌面包新增 Firefox manifest/注册。回滚到旧桌面包会失去 Firefox Host 注册，但不得影响 Vault 或 Chromium 扩展。

## Bug 根因（仅 type=bug）

N/A。
