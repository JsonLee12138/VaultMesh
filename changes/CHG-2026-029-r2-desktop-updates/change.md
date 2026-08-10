# 通过 Cloudflare R2 分发 Tauri 测试更新

## 问题或目标

VaultMesh 需要一个不购买 Apple/Windows 代码签名证书、适合小规模 macOS/Windows 测试的免费分发通道。GitHub Actions 必须在目标 OS/architecture 构建，Cloudflare R2 必须托管初始安装包、不可变版本产物和 Tauri 静态更新清单，已安装客户端必须能够发现并安装后续更新。

## 预期行为

- `REQ-UPDATE-001`：release build 在启动后和有界周期内从固定 HTTPS test channel 检查更高 SemVer；发现更新时由原生对话框让用户选择立即更新或稍后处理。
- macOS/Windows release build 在原生 VaultMesh 应用菜单提供“检查更新…”；主动检查与后台检查互斥，并对无更新和检查失败显示明确反馈。
- 用户确认后，Rust runtime 必须先锁定 Vault、撤销 Agent/Browser 临时 authority 并清理敏感临时资源，再下载和安装通过内置 public key 验证的更新。取消、网络失败、无更新或签名失败不得退出当前应用或发布成功状态。
- Windows x86_64、macOS aarch64 和 macOS x86_64 必须分别在标准 GitHub-hosted 原生目标 Runner 生成 Tauri v2 updater artifact；发布 workflow 不依赖 self-hosted 或自定义 Runner 标签。无 Apple/Windows 发布证书的测试产物可以显示 Gatekeeper/SmartScreen 警告，但 Tauri 更新签名不可关闭。
- 发布必须先写入版本化不可变对象，校验三平台清单完整性后最后替换 `channels/test/latest.json`。R2 写凭据和 updater private key 只存在 CI secret；public URL、bucket name 与 updater public key 可以作为 CI variable。
- 所有生成可分发 desktop package 的 Test/Review 与 experimental workflow 必须从 CI Secret 注入 Gmail Desktop OAuth Client ID 与 Provider 为该 Client 签发的 Client Secret，并在缺失、格式无效、Provider 不存在或 credential pair 不匹配时于编译前失败。
- 标准 GitHub-hosted Windows target Runner 可以用独立 workflow 在同一个 Windows job 内生成作为 updater 的 Windows NSIS artifact 和额外 MSI 手动安装包，并直接上传到 immutable experimental prefix，不通过其他 Runner 或 GitHub artifact 中转；该路径不得修改 test channel，也不得作为 Windows AT 证据。
- 标准 GitHub-hosted macOS target Runner 可以用独立 workflow 在同一个与目标架构匹配的 macOS job 内生成 updater archive 和 DMG，并直接上传到 immutable experimental prefix，不通过其他 Runner 或 GitHub artifact 中转；该路径不得修改 test channel，也不得作为 macOS AT 证据。

## 非目标

- 不完成 Apple notarization、Apple Developer ID、Windows Authenticode、Microsoft Store、Mac App Store 或正式公开发布 Gate。
- 不建立 VaultMesh 账号、更新服务端、遥测、强制静默更新、客户端 R2 写权限或私有下载鉴权。
- 不允许 updater downgrade，不把 `r2.dev` development URL 宣称为正式生产 CDN。

## 影响范围

影响 Tauri Rust runtime、desktop package config、GitHub Actions、R2 对象布局、发布测试与 supply-chain Gate。Vault format、Browser RPC、Native ABI、用户 Vault 数据和 extension storage 无变化。

## 实现约束

- Renderer 不获得 updater plugin capability；endpoint、检查、确认、生命周期清理和安装均由 Rust desktop runtime 拥有。
- 更新配置只进入 release build；普通 debug/local build 不访问远程 updater channel。
- 客户端只接受 HTTPS endpoint、内置 public key 和更高 SemVer。错误消息不得包含 endpoint credential、签名材料或本地路径。
- 版本产物路径必须不可变；`latest.json` 使用禁止缓存/重新验证语义，版本产物使用长期 immutable cache。发布清单必须在上传前验证签名非空、platform key 唯一且三平台齐全。
- macOS 使用 ad-hoc 签名只服务于小规模测试；用户仍可能需要手动通过 Gatekeeper。Windows 未签名安装包仍可能触发 SmartScreen。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| `UPD-001` | `REQ-UPDATE-001` | Rust-owned check/confirm/cleanup/install lifecycle | `CT-UPDATE-001` | Done |
| `UPD-002` | `REQ-UPDATE-001` | 三平台 CI updater artifacts 与 R2 原子发布 | `CT-UPDATE-001` | Done |
| `UPD-003` | `REQ-UPDATE-001` | 真实旧版本到新版本测试更新 | `AT-UPDATE-MACOS-001`, `AT-UPDATE-WINDOWS-001` | Pending |
| `UPD-004` | `REQ-UPDATE-001` | macOS 原生主动检查入口与互斥/反馈行为 | `CT-UPDATE-001`, `AT-UPDATE-MACOS-001` | Implemented；release AT Pending |
| `UPD-005` | `REQ-UPDATE-001` | Windows 原生主动检查入口与互斥/反馈行为 | `CT-UPDATE-001`, `AT-UPDATE-WINDOWS-001` | Implemented；release AT Pending |
| `UPD-006` | `REQ-UPDATE-001` | Windows target NSIS updater、MSI 手动安装包与 R2 experimental direct links | `CT-UPDATE-001` | Implemented；single-runner build/R2 public verification Pass；Windows AT Pending |
| `UPD-007` | `REQ-UPDATE-001` | Windows 覆盖安装前注销并停止仍占用安装目录的 Browser Native Host | `CT-UPDATE-001`, `AT-UPDATE-WINDOWS-001` | Implemented；Windows package retest Pending |
| `UPD-008` | `REQ-UPDATE-001` | macOS target updater archive、DMG 与 R2 experimental direct links | `CT-UPDATE-001` | Implemented；single-runner build/R2 public verification Pass；macOS AT Pending |
| `UPD-009` | `REQ-UPDATE-001` | Intel macOS Runner 交叉构建 ARM64 updater archive、DMG 与明确标记的 R2 experimental direct links | `CT-UPDATE-001` | Historical evidence only；由 `UPD-010` 原生 hosted ARM64 路径替代 |
| `UPD-010` | `REQ-UPDATE-001` | 标准 GitHub-hosted macOS ARM64、macOS Intel、Windows x64 原生构建与 Ubuntu 发布；全部发布 workflow 无自定义 Runner 标签 | `CT-UPDATE-001` | Implemented；workflow contract Pass；目标平台真实 package run Pending |
| `UPD-011` | `REQ-UPDATE-001` | 三平台 Cargo cache 与同 run 失败任务/artifact 恢复，避免单平台失败后重建成功平台 | `CT-UPDATE-001` | Implemented；workflow contract Pass；hosted cache-hit/失败重跑证据 Pending |
| `UPD-012` | `REQ-UPDATE-001`, `REQ-EMAIL-001` | Test/Review 与 experimental desktop package 的 Gmail Desktop OAuth credential pair 注入、Provider preflight 和编译前 fail-closed 门禁 | `CT-UPDATE-001`, `CT-EMAIL-001` | Implementing；`.5` live Provider AT 与 Desktop Client 截图证明 workflow 缺少配套 Client Secret；Provider-side fail-closed regression、repository Secret 配置与本地门禁 Pass，hosted rebuild Pending |

## 验收与证据

- 自动化必须拒绝非法版本、HTTP endpoint、缺失/空签名、未知/重复 platform、缺少任一目标平台、非版本化 artifact URL 和把 secret 写入生成文件。
- macOS aarch64/x86_64 与 Windows x86_64 package/updater artifact 必须分别在标准 GitHub-hosted `macos-15`、`macos-15-intel`、`windows-2025` 原生 Runner 生成，发布 job 使用标准 Ubuntu Runner；全部发布 workflow 必须拒绝 `self-hosted` 或自定义 Runner 标签。平台 AT 不得由本机交叉编译或 config-only 测试替代。
- 平台 AT 必须从旧版安装开始，覆盖无更新、用户取消、成功更新、篡改 artifact/签名拒绝、网络失败、Vault unlocked 时确认更新后的 lock/cleanup，以及 Windows installer exit/macOS restart。
- macOS AT 必须从原生应用菜单触发主动检查，覆盖无更新、检查失败、发现更新，以及与后台自动检查重叠时不产生重复检查或对话框。
- Windows AT 必须从原生“帮助”菜单触发主动检查，覆盖无更新、检查失败、发现更新，以及与后台自动检查重叠时不产生重复检查或对话框。
- Windows experimental package 必须在单个 Windows target Runner job 内生成并直接发布，验证 PE x86_64、NSIS updater/installer、MSI 手动安装包、updater signature、immutable digest 与 R2 回读一致性，并证明发布前后的 `channels/test/latest.json` 字节不变；不得通过其他 Runner 或 GitHub artifact 中转，且它不替代 Windows AT。
- macOS experimental package 必须在单个、与目标架构匹配的 macOS target Runner job 内生成并直接发布，验证主程序与特权 sidecar 的 Mach-O 目标架构及 macOS 12.0 deployment target、`.app` code signature、DMG 可读性、updater signature、immutable digest 与 R2 回读一致性，并证明发布前后的 `channels/test/latest.json` 字节不变；不得通过其他 Runner 或 GitHub artifact 中转，且它不替代 macOS AT。
- macOS experimental package 必须根据目标选择标准 GitHub-hosted ARM64 或 Intel Runner，并在同一原生架构 job 内验证主程序与全部特权 sidecar 的 Mach-O architecture、macOS 12.0 deployment target、`.app` code signature、DMG 可读性、updater signature、immutable digest 与 R2 回读一致性；不得通过其他 Runner 或 GitHub artifact 中转，且它不替代 macOS AT。

自动化证据（2026-08-05 至 2026-08-06）：

- 2026-08-10 live Provider correction：`0.0.5-review` 的 Gmail authorization-code exchange 返回 HTTP 400；Google Console 截图及与安装包 Client ID 前缀的非输出布尔比对确认其类型为 Desktop。无 Client Secret 的 token-endpoint probe 返回 `client_secret is missing`，加入未跟踪本机配套 secret 后进入预期 malformed-code 分支，证明 workflow 只注入 Client ID 是根因。共用构建门禁和四个 package workflow 改为注入并预检 credential pair，使用固定无效授权码且不接触账号或 token；拒绝未知/已删除/不匹配凭据、网络失败和无效响应。本机真实 credential pair Provider gate、Email OTP tests 12/12、完整 Tauri Rust lib 221 pass/1 ignored、lib Clippy、scripts 98/98、Tauri typecheck、docs check 与 diff check Pass；GitHub Actions repository 中两个 credential Secret 名称均已确认存在且未读取其值。更高 immutable package run Pending。
- 2026-08-10 Gmail OAuth package 配置修复：仓库级 `VAULTMESH_GOOGLE_OAUTH_CLIENT_ID` GitHub Secret 已从未跟踪本机环境安全配置；四个生成可分发 desktop package 的 workflow 显式注入该值，并共用可执行门禁拒绝缺失、空值、示例占位、错误 Provider 和带空白的值。OAuth/workflow 定向 tests 22/22、完整 `pnpm scripts:test` 90/90、四个 workflow YAML parse、`pnpm docs:check` 与 `git diff --check` Pass；既有缺失编译期值的 immutable artifact 不覆盖，需以更高版本重建。
- 2026-08-10 发布流水线迁移：`r2-test-update.yml` 与 `r2-review-release.yml` 固定使用 `macos-15` ARM64、`macos-15-intel` x86_64、`windows-2025` x64 和 `ubuntu-24.04` publisher，并在 build job 中断言 Node host platform/architecture 与目标一致；历史 resume、staged 和 experimental workflow 也全部迁到标准 GitHub-hosted Runner，仓库工作流不再包含 `self-hosted`。全部 workflow YAML parse Pass；`pnpm scripts:test`：78/78 Pass；目标平台真实 package run Pending。
- 2026-08-10 构建性能/恢复基线：完整 `0.0.4-review` run `31369895049` 中 ARM64、Windows、Intel 构建分别耗时约 9m41s、21m18s、29m11s；Actions cache 清单只有 pnpm 依赖缓存，没有 Cargo cache。Test/Review 完整 workflow 增加按 runner OS/arch/target/Cargo manifests 隔离的 Cargo dependency/release-object cache，并让 publisher 在矩阵失败时明确失败；同 run 使用“Re-run failed jobs”时只需重跑失败 matrix child 与 publisher，已上传成功 artifact 继续复用。`pnpm scripts:test` 83/83、workflow YAML parse、`pnpm docs:check` 与 `git diff --check` Pass；首次 hosted cache-hit/失败恢复运行证据 Pending。

- Windows 真机覆盖安装 `0.1.1-test.2` 时，NSIS 报告无法写入 `%LOCALAPPDATA%\VaultMesh\vaultmesh-native-host.exe`；现有 hooks 只有 post-install 注册与 pre-uninstall 注销，没有在覆盖复制前阻止 Chromium 重连并停止仍持有旧 EXE 的 Native Host。修复在 `NSIS_HOOK_PREINSTALL` 中先注销 Chrome/Edge Host、再有界终止该 current-user Host，并在安装后恢复注册；Windows 新 package 复测前不得把该 AT 记为 Pass。
- 修复进入 `main@58f4320` 后触发的原生 Windows `0.1.1-test.3` build [30985556390](https://github.com/atlantis-mk/VaultMesh/actions/runs/30985556390) 未获得 runner、没有执行任何 step；GitHub annotation 明确为近期付款失败或 spending limit 不足。该外部门禁解除或接入真实 Windows self-hosted runner 前，不能生成包含本修复的新安装包。
- Windows self-hosted runner `vaultmesh-windows-x64` 与 Linux self-hosted publisher `unraid-windows-cross` 在 [run 31003164715](https://github.com/atlantis-mk/VaultMesh/actions/runs/31003164715) 完成 `0.1.1-test.3`：Windows target 原生 Release/NSIS/updater 签名构建、PE x86_64 校验和 artifact upload 全部 Pass；publisher 将 installer、`.sig` 与 descriptor 上传到 `experimental/windows/v0.1.1-test.3/` 后逐项回读比对，并证明 `channels/test/latest.json` 发布前后字节不变。公网独立验证三对象均为 HTTP 200 与 `public, max-age=31536000, immutable`，installer 为 7,368,118 bytes，descriptor 绑定 `windows-x86_64`/`0.1.1-test.3`，test channel 仍为 `0.1.1-test.2`；该 package 包含 `UPD-007` 修复，但覆盖安装复测前不得把 Windows AT 记为 Pass。
- 单个 Windows self-hosted runner `vaultmesh-windows-x64` 在 [run 31006428632](https://github.com/atlantis-mk/VaultMesh/actions/runs/31006428632) 的唯一 job 内完成 `0.1.1-test.4` 原生 Release/NSIS/updater 签名构建、PE x86_64 校验，并由 Windows 内置 `curl.exe` 通过 AWS SigV4 直接上传 R2 后逐项回读校验 SHA-256；该运行没有其他 Runner job，也没有 GitHub artifact 上传/下载中转，并证明 `channels/test/latest.json` 发布前后字节不变。公网独立验证 installer（7,373,776 bytes）、签名（428 bytes）与 descriptor（282 bytes）均为 HTTP 200，descriptor 绑定 `windows-x86_64`/`0.1.1-test.4`，test channel 仍为 `0.1.1-test.2`；该 package 包含 `UPD-007` 修复，但覆盖安装复测前不得把 Windows AT 记为 Pass。
- 单个 Windows self-hosted runner `vaultmesh-windows-x64` 在 [run 31059321300](https://github.com/atlantis-mk/VaultMesh/actions/runs/31059321300) 的唯一 job 内完成 `0.1.1-test.5` 原生 Release 构建、NSIS updater/installer、MSI 手动安装包、updater 签名、PE x86_64 与 MSI compound-file header 校验，并直接上传 R2 后逐项回读校验；没有其他 Runner job 或 GitHub artifact 中转，发布前后的 test channel 字节一致。公网独立验证 NSIS（7,349,884 bytes，`application/vnd.microsoft.portable-executable`）与 MSI（10,768,384 bytes，`application/x-msi`）均为 HTTP 200 和 `public, max-age=31536000, immutable`，descriptor 同时绑定两个 installer，test channel 仍为 `0.1.1-test.2`。MSI 首次接入暴露并修复 WiX `AppDataFolder` 未声明与 Cargo binary/externalBin 重复造成的 `ICE30`；`node --test scripts/*.test.mjs` 48/48、`pnpm docs:check` 与 `git diff --check` Pass。该证据不替代 Windows 安装/更新 AT。
- 本机 Intel macOS self-hosted runner `vaultmesh-macos-x64` 的首次 [run 31064871166](https://github.com/atlantis-mk/VaultMesh/actions/runs/31064871166) 在 R2 上传前主动取消：检查发现直接 Cargo sidecar build 未继承 Tauri `minimumSystemVersion: 12.0`，Xcode 默认写入 15.2 deployment target。构建脚本改为从 Tauri 主配置读取唯一最低版本并传入全部 Rust 子构建，防止主程序与特权 sidecar 兼容边界分裂。
- 修复后的单个 Intel macOS self-hosted runner 在 [run 31065165737](https://github.com/atlantis-mk/VaultMesh/actions/runs/31065165737) 的唯一 job 内完成 `0.1.1-test.5` 原生 Release、ad-hoc signed `.app`、DMG、updater archive/signature 构建，并由同一 job 直接上传 R2 和逐项回读 SHA-256；主程序、Agent MCP 与 Browser Native Host 均验证为 Mach-O x86_64、`minos 12.0`，`.app` deep/strict code signature 与 DMG imageinfo Pass，没有其他 Runner 或 GitHub artifact 中转，发布前后的 test channel 字节一致。公网独立验证 DMG（17,303,704 bytes，`application/x-apple-diskimage`）、updater archive（16,166,052 bytes，`application/gzip`）、签名（408 bytes）与 descriptor（274 bytes）均为 HTTP 200 和 `public, max-age=31536000, immutable`；descriptor 绑定 `darwin-x86_64`/`0.1.1-test.5`，test channel 仍为 `0.1.1-test.2`。`node --test scripts/*.test.mjs` 51/51、`pnpm docs:check` 与 `git diff --check` Pass。该证据不替代 macOS 安装/更新 AT。
- 同一 Intel macOS self-hosted runner 在 [run 31065947198](https://github.com/atlantis-mk/VaultMesh/actions/runs/31065947198) 的唯一 job 内交叉构建 `0.1.1-test.6` ARM64 Release、ad-hoc signed `.app`、DMG、updater archive/signature，并直接上传 R2 和逐项回读 SHA-256；主程序、Agent MCP 与 Browser Native Host 均验证为 Mach-O arm64、`minos 12.0`，`.app` deep/strict code signature 与 DMG imageinfo Pass，摘要明确标记 cross-built，没有其他 Runner 或 GitHub artifact 中转，发布前后的 test channel 字节一致。公网独立验证 DMG（16,733,211 bytes，`application/x-apple-diskimage`）、updater archive（15,726,820 bytes，`application/gzip`）、签名（408 bytes）与 descriptor（278 bytes）均为 HTTP 200 和 `public, max-age=31536000, immutable`；descriptor 绑定 `darwin-aarch64`/`0.1.1-test.6`，test channel 仍为 `0.1.1-test.2`。`node --test scripts/*.test.mjs` 52/52、`pnpm docs:check` 与 `git diff --check` Pass。该证据只证明交叉构建产物结构与公开分发，不替代 Apple Silicon 原生 package 或 macOS ARM 安装/更新 AT。
- Linux Docker `cargo-xwin` 探索运行 [30981682655](https://github.com/atlantis-mk/VaultMesh/actions/runs/30981682655) 在 vendored OpenSSL 的 VC-WIN64A Perl 路径语义处失败；切换到 WinCNG 的验证运行 [30982484271](https://github.com/atlantis-mk/VaultMesh/actions/runs/30982484271) 证明该 backend 不提供 `userauth_pubkey_memory`，会迫使 Windows 私钥认证使用文件路径并违反既有 no-temporary-identity-file contract。该路径已撤回，不作为 package 或 AT 证据。
- GitHub-hosted 原生 Windows experimental build [30983044096](https://github.com/atlantis-mk/VaultMesh/actions/runs/30983044096) 因私有仓库付款/支出上限门禁未启动任何 step；受约束的 self-hosted publish workflow 随后验证 source run `30970781553` 的 `Build windows-x86_64` 为成功，只下载该未过期原生 artifact，并在 [30983962333](https://github.com/atlantis-mk/VaultMesh/actions/runs/30983962333) 发布/回读 `experimental/windows/v0.1.1-test.2` 三个 immutable objects，发布前后 test channel 字节一致。
- 公网独立验证 experimental Windows NSIS setup EXE（7,332,634 bytes）、签名（428 bytes）与 descriptor（282 bytes）均为 HTTP 200 和 `public, max-age=31536000, immutable`；descriptor 的 platform/version/file 绑定一致，`channels/test/latest.json` 仍为 `0.1.1-test.2`。该证据只证明原生 package 与直链发布，不替代 Windows 安装/更新 AT。
- `cargo test -p vaultmesh-tauri-desktop app_update::tests`：6 pass，覆盖稳定 macOS menu ID/label/位置、Windows“帮助 → 检查更新…”menu contract 与构造器类型检查、主动/自动反馈差异、检查互斥 gate 及显式非秘密 build flag；`VAULTMESH_UPDATER_ENABLED=1 cargo check -p vaultmesh-tauri-desktop --release`、`node --test scripts/build-tauri.test.mjs`、`pnpm tauri:typecheck`、`pnpm docs:check` 与 `git diff --check`：Pass。macOS 交叉检查 Windows target 在业务 crate 前因本机缺少 Windows SDK/MSVC headers 停止，不作为 Windows package/AT 证据。
- 使用隔离 identifier `com.vaultmesh.menu-at` 生成并启动 debug macOS `.app`，未覆盖 `/Applications/VaultMesh.app`；System Events 实际读取原生应用菜单为 `About VaultMesh Menu AT`、分隔线、`检查更新…`、`Services`。无 updater config 的 debug bundle 可启动且不初始化 updater plugin；临时实例和验证文件已退出并移入废纸篓。
- `cargo test -p vaultmesh-tauri-desktop --lib`：218 pass、1 ignored（既有本机 OpenSSH daemon AT）；updater 引入的 TLS feature 已收紧为 `native-tls`，未改变既有 Rustls provider。
- `cargo test -p vaultmesh-agent-mcp`：10 pass；`pnpm --filter @vaultmesh/tauri-desktop test`：29 files / 127 pass；`node --test scripts/*.test.mjs`：37 pass。
- `pnpm tauri:typecheck`、`pnpm docs:check`、`git diff --check`：Pass。
- Intel macOS 使用临时测试 updater key、ad-hoc identity `-` 和 HTTPS fixture endpoint 执行 `node scripts/build-tauri.mjs --target x86_64-apple-darwin --bundles app,dmg --updater-version 0.1.1-test.2`：生成 DMG、`VaultMesh.app.tar.gz` 与 408-byte `.sig`；收集器规范化得到约 16.1 MB updater artifact 和约 17.3 MB DMG。临时 key 未进入仓库。
- GitHub Actions [run 30968331489](https://github.com/atlantis-mk/VaultMesh/actions/runs/30968331489) 在 `main@cf8e6fd` 上完成 `0.1.1-test.1` 首次真实发布：macOS aarch64、macOS x86_64、Windows x86_64 三个目标 runner 的 signed updater artifact、测试安装器、规范化和 artifact upload 全部 Pass；R2 immutable objects、latest-last channel publish 与上传后回读比对全部 Pass。
- 公网独立验证 `channels/test/latest.json` 为 `0.1.1-test.1` 且包含三个唯一 platform；两份 macOS updater archive、两份 DMG 和 Windows NSIS installer 均返回 HTTP 200。`latest.json` 为 `Cache-Control: no-store, max-age=0`，版本对象为 `public, max-age=31536000, immutable`；清单内三个签名分别与公开 `.sig` 对象完全一致。
- GitHub Actions source [run 30970781553](https://github.com/atlantis-mk/VaultMesh/actions/runs/30970781553) 在三个目标 OS/architecture 上成功构建 `0.1.1-test.2`；原 publish job 因 GitHub private-repository Actions billing gate 未启动。经受约束的续传 workflow 只接受该已完成 run 的三个成功 build job，并由一次性 self-hosted macOS runner 在 [run 30974298473](https://github.com/atlantis-mk/VaultMesh/actions/runs/30974298473) 完成 immutable upload、latest-last publish 与上传后回读比对；Runner 完成后自动注销。
- 公网独立验证 `channels/test/latest.json` 已前进至 `0.1.1-test.2`，包含 `darwin-aarch64`、`darwin-x86_64`、`windows-x86_64`；三份 updater artifact、两份 DMG 和 Windows NSIS installer 均返回 HTTP 200，三个清单签名分别与公开 `.sig` 完全一致。`latest.json` 保持 `Cache-Control: no-store, max-age=0`，版本对象保持 `public, max-age=31536000, immutable`。`node --test scripts/*.test.mjs`：42 pass；`pnpm docs:check`：Pass。

R2 bucket、public base URL、updater keypair 和 CI Secrets/Variables 已配置，三平台真实构建、`0.1.1-test.1` baseline publication、`0.1.1-test.2` update publication，以及 Windows `0.1.1-test.3` 双 Runner、`0.1.1-test.4` 单 Windows Runner NSIS、`0.1.1-test.5` 单 Windows Runner NSIS+MSI、单 Intel macOS Runner DMG+updater 和 Intel→ARM64 `0.1.1-test.6` cross-built experimental publication 已完成。测试者已报告 Intel macOS baseline 安装完成，但仍需观察实际发现更新、取消/稍后、旧版→新版安装、离线/篡改拒绝、lock/cleanup 和 restart；ARM64 cross-built package 仍需 Apple Silicon 真机安装反馈且不替代原生 package，Windows `0.1.1-test.4`/`0.1.1-test.5` 仍需覆盖安装复测，其他对应 AT 也待后续目标机执行。因此 Work 保持 Implementing，不声明 Verified。

## 外部配置

在 GitHub repository Variables 配置：`R2_ACCOUNT_ID`、`R2_BUCKET`、`R2_PUBLIC_BASE_URL`（小规模测试可以是 Cloudflare 提供的 HTTPS `r2.dev` base URL）、`TAURI_UPDATER_PUBLIC_KEY`。在 GitHub repository Secrets 配置：`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`、`VAULTMESH_GOOGLE_OAUTH_CLIENT_ID`、`VAULTMESH_GOOGLE_OAUTH_CLIENT_SECRET`。R2 API token 只授予目标 bucket 的 Object Read & Write；bucket 需要显式开启 public development URL 或绑定 custom domain。Gmail Desktop OAuth credential pair 由 build script 编入 public-client binary，不得输出到日志；缺失或 Provider 不接受时 package workflow 必须失败。

Updater keypair 使用 Tauri CLI 一次性生成并离线备份 private key；丢失 private key 或密码后，已安装客户端不能接受由新 key 签名的更新。首次运行 `.github/workflows/r2-test-update.yml` 时输入严格递增的 SemVer 和短 release notes；workflow 会拒绝覆盖内容不同的版本对象，并在三个平台均完整后最后发布 channel manifest。

## 安全与数据生命周期

Updater public key 和公开 endpoint 编入 release app；updater private key、R2 Access Key ID/Secret Access Key 只进入 GitHub Actions secret environment，不写入仓库、artifact、日志或 `latest.json`。客户端下载内容只在 Tauri updater 的有界安装路径中存在并在安装前验签；安装前执行与正常退出相同的 Vault/Agent/Browser/临时资源清理。

## 兼容与迁移

首次必须手动安装包含 updater 配置的新 build；此后同一 test channel 只接受更高 SemVer。无自动 downgrade；需要回滚时发布包含回退代码的更高 patch，或明确指导测试者手动卸载/重装。Vault format、settings、pairing、RPC/IPC/ABI 不迁移。

## Bug 根因（仅 type=bug）

N/A。
