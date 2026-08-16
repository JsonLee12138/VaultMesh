# 以 0.0.1-review 建立独立 Review 发布基线

## 问题或目标

当前源码版本为 `0.1.0`，已发布的 R2 test channel 最高版本属于 `0.1.1-test.*`。本次需要把下一轮人工评审安装包重置为 `0.0.1-review`，同时不得通过覆盖旧清单或关闭 SemVer 检查让现有测试客户端降级。

## 预期行为

- `REQ-UPDATE-002`：`0.0.1-review` 是 fresh-install 基线；当前 workspace、Tauri desktop、Chromium/Firefox extension 与 Rust package 必须统一为 `0.0.9-review`，并由 `.1 → .2 → .3 → .4 → .5 → .6 → .7 → .8 → .9` 严格递增。
- Review build 必须使用独立的 `channels/review/latest.json`；首次发布允许该通道没有现有清单，但后续版本仍必须严格递增。
- Review desktop build 必须从 GitHub repository Secret 注入 Gmail Desktop OAuth Client ID 与 Provider 为该 Client 签发的 Client Secret；缺失、格式无效、Provider 不存在或 credential pair 不匹配时必须在编译前失败，不得继续发布功能残缺的安装包。既有缺失 ID 的 `.4` 和缺失 Client Secret 的 `.5` immutable 版本不得覆盖，只能通过更高 Review 版本补发。
- Gmail 必须只请求 `gmail.readonly`，在 authorization-code exchange 后验证 Provider 实际授予该 scope，并通过 Gmail Profile 获取邮箱地址；不得把只授予 `openid`/`email` 身份 scope 的部分授权保存为可用 Gmail 账户。
- 小规模验收可以先发布只含已验证目标平台的阶段性 Review manifest；同一 current version 可以在 immutable artifact 就绪后只追加一个缺失平台，同时保持全部既有字段不变。该路径不计为完整三平台 Review 发布或平台 AT。
- 现有 `channels/test/latest.json` 和其中的 `0.1.1-test.*` 安装不得被覆盖、删除或降级。已有测试安装加入 Review 必须明确执行手动重装。
- Review artifact 继续使用标准 GitHub-hosted macOS ARM64、macOS Intel、Windows x64 三目标原生构建、Tauri updater 签名、版本对象不可变和 latest-last 发布；全部发布 workflow 不依赖 self-hosted 或自定义 Runner 标签。Review 不等于正式 Stable 发布。
- 完整 Review workflow 必须为 Windows 同时生成 NSIS 与 MSI；Chrome/Firefox extension ZIP 必须先写入同版本不可变 R2 路径并通过公网内容校验。R2 完整发布成功后必须创建或恢复同 source SHA 的 GitHub Draft Prerelease，只上传两个 DMG、Windows NSIS/MSI 与两个 extension ZIP。Draft 不得创建 Git Tag，也不得冒充正式发布或平台 AT。双浏览器打包与 Host 边界由 `CHG-2026-036` 推进。

## 非目标

- 不把 `0.0.1-review` 声明为正式公开 Stable 版本。
- 不完成 Apple notarization、Windows Authenticode、商店审核或关闭 `OPEN-001`、`OPEN-003`。
- 不修改 Vault format、Browser RPC、Native ABI、settings、pairing 或用户 Vault 数据。

## 影响范围

影响 workspace 版本元数据、Tauri/extension 打包版本、R2 Review channel 和发布脚本测试。Vault 加密与格式、RPC/IPC/ABI、Agent/Browser authority 和 secret 生命周期无变化。

## 实现约束

- 版本字符串必须是规范 SemVer，完整保留 `review` prerelease 标识。
- Review 与 test channel 必须独立读取和写入各自的 `latest.json`；不得复制旧 test manifest 作为 Review 当前版本。
- Review 发布仍只允许 HTTPS endpoint、CI secret 中的 updater private key 和 R2 写凭据，并保持版本对象 immutable。
- Gmail Desktop OAuth Client ID 与 Provider 签发的 Client Secret 只从 CI Secret 注入并由 Rust build script 编入 public-client binary；构建前必须先验证 Client ID 属于已接受的 VaultMesh Desktop client，再以无真实账号、无真实授权码的 Provider probe 验证 credential pair 进入 `invalid_grant`，并拒绝其他有效 Google Client、未知、已删除或不匹配的凭据。Desktop Client Secret 不构成鉴权边界；校验与失败信息不得输出 Client ID、Client Secret 或 Provider 响应正文。
- Gmail OAuth 请求不得混合 Sign-In scopes；Token response 缺少 `gmail.readonly` 时必须在账户持久化前 fail closed，且错误不得包含 access/refresh token 或 Provider 响应正文。
- 已有 `0.1.x` 安装不提供自动 downgrade；回到 `0.0.1-review` 只能通过显式手动卸载/重装，并保留 Vault 数据保护与备份指引。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| `REV-001` | `REQ-UPDATE-002` | 全部产品版本元数据统一为 `0.0.1-review` | `CT-UPDATE-REVIEW-001` | Done |
| `REV-002` | `REQ-UPDATE-002` | 独立 Review channel 发布入口及 test channel 不变约束 | `CT-UPDATE-REVIEW-001` | Done |
| `REV-004` | `REQ-UPDATE-002` | 自托管 Intel Mac 生成嵌入 Review endpoint 的 x86_64 fresh-install 基线，只发布 immutable experimental objects 且不创建/修改 channel | `CT-UPDATE-REVIEW-001` | Done |
| `REV-005` | `REQ-UPDATE-002` | 从已验证的 Intel immutable artifact 创建缺失的阶段性 Review manifest，并证明 test channel 不变 | `CT-UPDATE-REVIEW-001` | Done |
| `REV-006` | `REQ-UPDATE-002` | 生成 Intel macOS `0.0.2-review` signed updater/DMG，并把阶段性 Review channel 从 `.1` latest-last 推进到 `.2` | `CT-UPDATE-REVIEW-001` | Done |
| `REV-007` | `REQ-UPDATE-002` | 自托管 Windows x64 Runner 从已冻结的 `.1` 产品 source ref 生成嵌入 Review endpoint 的 NSIS/MSI fresh-install 基线；只覆盖已评审的 Review→MSI 数值版本构建工具并只发布 immutable objects | `CT-UPDATE-REVIEW-001` | Done |
| `REV-008` | `REQ-UPDATE-002` | 同一 Windows x64 Runner 生成 `.2` signed updater/NSIS/MSI，并在保持现有 Intel entry 与 test channel 不变时把 Windows 平台追加到阶段性 Review manifest | `CT-UPDATE-REVIEW-001` | Done |
| `REV-009` | `REQ-UPDATE-002` | 完整 Review workflow 使用标准 GitHub-hosted macOS ARM64、macOS Intel、Windows x64 原生构建与 Ubuntu 发布，并移除全部自定义 Runner 标签 | `CT-UPDATE-REVIEW-001` | Done；host/target 断言与完整 hosted run Pass |
| `REV-010` | `REQ-UPDATE-002` | 统一 `0.0.3-review` 产品版本并触发完整 hosted 三目标 latest-last 发布 | `CT-UPDATE-REVIEW-001`, `AT-UPDATE-REVIEW-MACOS-001`, `AT-UPDATE-REVIEW-WINDOWS-001` | Published；R2 公网校验 Pass；fresh-install/update AT Pending |
| `REV-011` | `REQ-UPDATE-002` | R2 成功后创建无 Git Tag 的 GitHub Draft Prerelease，并上传双 macOS DMG 与 Windows NSIS/MSI | `CT-UPDATE-REVIEW-001` | Done；workflow contract Pass，`.3` Draft 四资产 uploaded |
| `REV-012` | `REQ-UPDATE-002`, `REQ-BROWSER-004` | `.4` 完整 hosted Review build 同 source 生成 Chrome/Firefox ZIP 并建立六资产 Draft | `CT-UPDATE-REVIEW-001`, `CT-BROWSER-PACKAGE-001` | Done；run `31369895049` 与六资产 Draft Pass |
| `REV-013` | `REQ-UPDATE-002` | Review 三平台 Cargo cache 与同 run 失败 build/publish/Draft 恢复 | `CT-UPDATE-REVIEW-001` | Implemented；workflow contract Pass；`.5` hosted cache-miss/save 证据已记录，失败重跑证据 Pending |
| `REV-014` | `REQ-UPDATE-002`, `REQ-EMAIL-001` | 所有 Review/Test 与 experimental desktop package workflow 注入并预检已接受的 Gmail Desktop OAuth credential pair；缺失 ID 的 `.4`、缺失 Client Secret 的 `.5` 与错误有效 Client 的 `.6` 均不覆盖 | `CT-UPDATE-REVIEW-001`, `CT-EMAIL-001` | Implemented；`.5` live Provider AT 证明缺少配套 Client Secret，`.6` live AT 证明 CI 注入了另一组有效 Google Client；已接受 Client 前缀与 Provider pair 双门禁及 `.7` hosted rebuild、本机 DMG 静态绑定验证 Pass，live Provider retest Pending |
| `REV-015` | `REQ-UPDATE-002` | Rust 1.95.0 固定工具链、忽略 workspace-only 版本变化的 dependency-only Cargo cache，以及保存前移除可能含编译期 credential 的 workspace release object | `CT-UPDATE-REVIEW-001` | Implemented；cache-key/security/workflow contract Pass；新 cache hosted hit Pending |
| `REV-016` | `REQ-UPDATE-002`, `REQ-EMAIL-001` | Gmail 单一 `gmail.readonly` consent、实际授予 scope fail-closed 校验与 Gmail Profile 地址读取，并以 `.8` immutable Review 补发 | `CT-UPDATE-REVIEW-001`, `CT-EMAIL-001`, `AT-EMAIL-001` | Implementing；`.8` 三平台 package/R2 publication Pass，GitHub Draft 因 repository Actions token 只读返回 403；live Provider AT Pending |
| `REV-017` | `REQ-UPDATE-002`, `REQ-BROWSER-004` | `.9` 同 source Chrome/Firefox ZIP 进入不可变 R2 路径并提供公开直接下载 | `CT-UPDATE-REVIEW-001`, `CT-BROWSER-PACKAGE-001` | Implementing；workflow contract Pass，hosted publish Pending |
| `REV-003` | `REQ-UPDATE-002` | macOS/Windows Review fresh-install 与后续升级验收 | `AT-UPDATE-REVIEW-MACOS-001`, `AT-UPDATE-REVIEW-WINDOWS-001` | Pending |

## 验收与证据

- 自动化证明当前所有产品 manifest 与 workspace package version 都是 `0.0.9-review`，历史 `.1` 仍作为安装基线保留，`.2`–`.8` 保留为已发布的中间 Review 更新。
- 自动化证明 Review workflow 只读写 `channels/review/latest.json`，使用标准 GitHub-hosted 原生架构 Runner 执行三平台、签名、immutable 和 latest-last 校验，且全部发布 workflow 不包含 `self-hosted` 或自定义 Runner 标签。
- 平台验收从全新安装开始；已有 `0.1.x` 测试安装必须验证不会收到 `0.0.1-review` 自动降级，并按指引手动重装。

自动化证据（2026-08-07）：

- 2026-08-16 回查 `.8` hosted 结果：GitHub Actions run `31413386075` 的 Chrome/Firefox ZIP、macOS ARM64、macOS Intel、Windows x64 与 R2 publisher 全部 Success，公开 Review manifest 已为 `0.0.8-review` 且包含三个 signed platform URL；最后的 GitHub Draft job 因 repository Actions `GITHUB_TOKEN` 对 Releases API 只有只读权限返回 HTTP 403，因此 run 总结为 Failure。该权限限制不回滚已经完成的 R2 immutable/latest-last publication，`.8` Draft 未创建，且本 Work 继续保持 Implementing。
- 2026-08-10 Gmail live Provider 失败与根因：`/Applications/VaultMesh.app` `0.0.5-review` 添加 Gmail 在 authorization-code exchange 返回 HTTP 400。Google Console 截图显示现有 `VaultMesh Desktop` 类型为桌面设备；当时 binary 侧只确认了格式有效的 Google Client ID 与 Provider 接受的 credential pair，没有证明其与截图中的 exact client 相同。向 Google token endpoint 发送无真实账号、无真实 token、无 Client Secret 的无效授权码 probe 返回 `invalid_request`/`client_secret is missing`；加入配套 Client Secret 后进入预期的 `invalid_grant`/malformed-code 分支，证明 `.5` 的直接缺陷是 workflow 没有注入配套 secret，但尚未排除使用了其他有效 Client。四个 package workflow 与构建门禁改为注入并预检 credential pair；Rust OAuth exchange/refresh 只解析标准 `error` code 并映射为可操作的无 secret 错误。本机真实 credential pair Provider gate、Email OTP tests 12/12、完整 Tauri Rust lib 221 pass/1 ignored、lib Clippy、scripts 98/98、Tauri typecheck、docs check 与 diff check Pass；GitHub Actions repository 中两个 credential Secret 名称均已确认存在且未读取其值。`0.0.5-review` immutable artifact 不覆盖。
- 2026-08-10 `.6` Gmail live correction：run `31397283749` 的三平台 credential-pair Provider probe、package、R2 publish 与六资产 Draft 均 Pass，但安装后 Gmail API 返回 HTTP 403。只读核对确认目标 Google 项目已启用 Gmail API、声明 `gmail.readonly` 且测试账号已登记；对 `.6` 与已安装 `.5` binary 仅做非输出布尔比对，二者 Client ID 相同但均不匹配已接受 `VaultMesh Desktop` 截图前缀。根因是原门禁只能证明 ID/Secret 彼此有效，不能拒绝属于其他 Google 项目的有效 credential pair；本地运行时环境变量优先于 build-time 值，因此正确本地变量掩盖了错误 CI 配置。GitHub Secrets 已更新；构建门禁新增已接受 Client 前缀校验，`.6` immutable artifact 不覆盖，`0.0.7-review` rebuild Pending。
- 2026-08-10 `.7` Gmail credential correction：GitHub Actions [run `31402083758`](https://github.com/atlantis-mk/VaultMesh/actions/runs/31402083758)（source `0b64d18`）的三平台已接受 Client 前缀门禁、credential-pair Provider probe、原生 package、R2 latest-last publish 与六资产 Draft 全部 Pass；公开 Review manifest 为 `0.0.7-review`，恰含 `darwin-aarch64`、`darwin-x86_64`、`windows-x86_64` 且三个 HTTPS URL 的签名均非空。Draft `untagged-590266da3cb1aef7631a` 为 Draft + Prerelease、target source 与 run 一致。将 Intel DMG 下载到本机后只读挂载，主程序为 Mach-O x86_64，`.app` deep/strict code signature Pass；对 Mach-O 原始字节只做非输出布尔匹配，确认内嵌已接受 `VaultMesh Desktop` Client 前缀。`strings` 默认只扫描部分 Mach-O 区段，不能作为缺失判据。真实 Gmail 授权与读取 retest Pending，因此 Work 保持 Implementing。
- 2026-08-11 `.7` Gmail granular-consent 根因：安装态 `.7` binary、版本、x86_64 架构、code signature 与已接受 Client 前缀均确认正确，Google Cloud 只读核对同时确认 Gmail API、`gmail.readonly` restricted scope、Testing audience 与测试用户配置正确；但本次 loopback callback 的非秘密 scope 集合只包含三个 Sign-In/身份 scope，`gmail.readonly` 布尔检查为 false，随后 Gmail API 返回 HTTP 403。根因是 OAuth 请求混合 `openid`/`email` 与 Gmail non-Sign-In scope 后触发 granular consent，而 runtime 未检查实际授予 scope。修复把 Gmail 请求收窄为唯一 `gmail.readonly`，Token response 缺少该 scope 时在持久化前返回可操作错误，并用 Gmail `users.getProfile` 的 `emailAddress` 替代 OpenID UserInfo；定向 Email OTP tests 14/14 Pass。`.7` immutable artifact 不覆盖，`.8` hosted rebuild 与 live Provider AT Pending。
- 2026-08-10 Gmail OAuth package 配置修复：确认 `0.0.4-review` workflow 未注入 `VAULTMESH_GOOGLE_OAUTH_CLIENT_ID`，而 Rust 仅通过 `option_env!` 读取编译期值，因此已发布包运行时必然报告未配置。仓库级同名 GitHub Secret 已配置；完整 Review/Test 与 macOS/Windows experimental package workflow 现在显式注入，并共用可执行门禁拒绝缺失、空值、示例占位、错误 Provider 和带空白的值。OAuth/workflow 定向 tests 22/22、完整 `pnpm scripts:test` 90/90、四个 workflow YAML parse、`pnpm docs:check` 与 `git diff --check` Pass；`.4` immutable 资产未覆盖，`.5` hosted rebuild 证据见 run `31384139138`。
- GitHub Actions run `31384139138`（source `8c856ce`）：Pass；Chrome/Firefox extension 29s，macOS ARM64、Intel x86_64、Windows x64 分别 12m03s、23m06s、23m36s，R2 publisher 50s、六资产 Draft 27s，完整 workflow 约 25m00s。三平台 OAuth 门禁均在构建前通过；公开 Review manifest 为 `0.0.5-review`，恰含 `darwin-aarch64`、`darwin-x86_64`、`windows-x86_64`，三个 signed updater URL 支持公网读取且签名非空。下载 ARM64 signed updater 后，仅以布尔匹配确认 desktop Mach-O 内嵌 `*.apps.googleusercontent.com` Client ID，未输出凭证值。Draft `untagged-38f78d8ea26d34082a7c` 为 Draft + Prerelease、target source 与 run 一致，两个 DMG、Windows NSIS/MSI、Chrome/Firefox ZIP 六个资产均为 `uploaded`，远端 `v0.0.5-review` Tag 不存在。
- 同 run Cargo cache 证据：三个原生平台均因新 key 未命中，核心 Rust/Tauri release 阶段分别约 8m44s、17m22s、18m02s；末尾 cache save 在 ARM64 32s、Intel 29s、Windows 29s。pnpm 依赖缓存三平台均命中。后续优化应让 dependency cache key 不随 workspace 版本元数据变化，并评估拆分依赖缓存与 workspace release objects、只在受控分支保存或改用 Rust 专用 cache/sccache；不得以跳过原生目标构建替代发布验收。
- cache v2 优化证据：`.5` 三个平台的完整 target cache 每项约 438–489 MB，`.5 → .6` 仅 workspace 版本推进仍产生新 key；`.6` run `31397283749` 通过 v1 prefix fallback 把 ARM64、Intel、Windows 从 12m03s/23m06s/23m36s 降至 9m16s/21m48s/21m58s，三平台、R2 publish 与六资产 Draft 全部 Pass，但仍为 `.6` 保存新版本 target cache。Review/Test workflow 现固定 Rust 1.95.0，并用忽略 workspace-only SemVer、绑定依赖图/manifests/toolchain 的 v2 key，只缓存 Cargo downloads 与第三方 dependency objects；上传分发 artifact 后清理四个 workspace package 的目标 release object，避免最终包或可能含编译期 OAuth 值的对象进入共享 cache。旧 v1 cache 不作为 fallback，sccache 因同类编译期 credential 风险未启用；本地 contract tests Pass，首次 hosted v2 hit Pending。
- 2026-08-10 完整 Review workflow 固定使用 `macos-15` ARM64、`macos-15-intel` x86_64、`windows-2025` x64 与 `ubuntu-24.04` publisher，并新增 host platform/architecture fail-closed 断言；阶段性 Review publisher 和 experimental package 也迁到标准 GitHub-hosted Runner。全部 workflow YAML parse Pass；`pnpm scripts:test`：78/78 Pass；完整三目标 GitHub Actions run Pending。
- `0.0.3-review` 触发前本地 gate：五个 pnpm/Tauri manifest 与四个 Rust workspace package 版本一致；`cargo check -p vaultmesh-core -p vaultmesh-ffi -p vaultmesh-agent-mcp -p vaultmesh-tauri-desktop`、`cargo test -p vaultmesh-tauri-desktop --lib`（220 pass、1 ignored）、`pnpm scripts:test`（78/78）、`pnpm tauri:typecheck`、`pnpm docs:check`、workflow YAML parse 与 `git diff --check` Pass。GitHub Actions 三目标 package/R2 latest-last publication Pending。
- GitHub Actions run `31351302181`：Fail closed；标准 hosted `macos-15` ARM64 与 `macos-15-intel` x86_64 均完成 signed updater、DMG、artifact normalize/upload，`windows-2025` x64 在编译 Windows 托盘主题模块时发现私有子模块函数的 re-export 可见性错误。publisher job 被依赖门禁跳过，未上传 R2 immutable objects、未修改 Review channel。修复把两个平台函数提升为 `pub(crate)` 并收窄非 Windows 的 `Image` import；修复后本地 `cargo test -p vaultmesh-tauri-desktop --lib`（220 pass、1 ignored）、workspace `cargo check`、`pnpm scripts:test`（78/78）、`pnpm docs:check` 与 `git diff --check` Pass，完整 hosted 复跑 Pending。
- GitHub Actions run `31352257713`（source `4592da1`）：Pass；标准 hosted macOS ARM64、Windows x64、macOS Intel 分别在 10m01s、22m37s、25m33s 完成原生 signed updater 与 Review installer 构建、normalize 和 artifact upload，Windows 实际编译通过托盘主题 cfg 分支并生成 NSIS `setup.exe`。Ubuntu publisher 在三者全部成功后才上传 immutable version objects，并最后写入、readback 校验 `channels/review/latest.json`。
- GitHub Actions run `31369895049`（source `ffff2d6`）：Pass；Chrome/Firefox extension 27s，macOS ARM64、Windows x64 NSIS/MSI、macOS Intel 分别约 9m41s、21m18s、29m11s，完整六资产 Draft 约 30m34s。仓库 Actions cache 只有 pnpm 依赖缓存，证明三平台 Rust/Tauri 仍从零编译。Review workflow 因此增加按 OS/arch/target/Cargo manifests 隔离的 Cargo cache，并让 build、publish、extension 任一失败时下游 job 明确失败而非 skipped，使同 run “Re-run failed jobs”保留成功平台 artifact；`pnpm scripts:test` 83/83、workflow YAML parse、`pnpm docs:check` 与 `git diff --check` Pass，首次 hosted cache-hit/失败恢复运行证据 Pending。
- 独立公网校验：Review manifest 为 `0.0.3-review`，平台键恰为 `darwin-aarch64`、`darwin-x86_64`、`windows-x86_64`；三个 updater URL、Apple Silicon DMG、Intel DMG 与 Windows NSIS installer 均返回 HTTP 200。完整 workflow 未声明 MSI，因此该 run 不产生 MSI；这不改变当前三平台 Review 发布契约。
- GitHub Draft Prerelease 自动化只在 build 与 R2 publisher 全部成功后运行，要求 `contents: write` 仅属于该 job；它验证两个 DMG 与 Windows NSIS/MSI、Draft/prerelease/source SHA 状态与远端 Tag 不存在，并以不覆盖既有资产的方式支持失败 job 重跑。公开 Prerelease 仍受 GATE-6、Work 封存、Release record 与 Git Tag 门禁约束。
- GitHub Draft Prerelease `untagged-53638acaa8f1260a1fbf`：target commit 为 `4592da1`，Apple Silicon DMG、Intel DMG 与 Windows x64 NSIS 三个资产均为 `uploaded`；MSI 正在通过同 source 的原生 Windows experimental workflow 补建。API 状态为 Draft + Prerelease，远端 `v0.0.3-review` Git Tag 不存在。该 Draft 只供维护者人工验收，不计为公开或正式发布。
- GitHub Actions run `31354047769`：Fail closed；冻结 `4592da1` source 已包含 Review→MSI 构建兼容修正，overlay 后为零差异，但旧门禁错误地要求必须恰有 `scripts/build-tauri.mjs` 一个差异。失败发生在依赖安装和构建前，未上传 R2、未修改 Review channel 或 GitHub Draft。门禁改为允许零差异或只允许该单一文件差异，其他路径继续 fail closed；MSI 复跑 Pending。
- GitHub Actions run `31354130960`：Pass；标准 hosted Windows x64 从冻结 `4592da1` source 原生生成 NSIS 与 MSI，在 18m27s 内通过 PE x86_64、MSI compound header、immutable R2 upload/readback 和 Review/test channel 不变校验。MSI 公网对象返回 HTTP 200，并已追加到 `untagged-53638acaa8f1260a1fbf`；Draft 当前两个 DMG、Windows NSIS/MSI 四个资产均为 `uploaded`，仍无远端 Git Tag。

- `cargo check -p vaultmesh-core -p vaultmesh-ffi -p vaultmesh-agent-mcp -p vaultmesh-tauri-desktop`：Pass；四个 workspace package 均以 `0.0.1-review` 编译，`Cargo.lock` 同步更新。
- `pnpm scripts:test`：59/59 Pass；`CT-UPDATE-REVIEW-001` 验证五个产品 manifest 与 Rust workspace 版本一致，证明完整 Review workflow 包含三目标构建、source version fail-closed、独立 Review endpoint 和 latest-last 发布；Intel experimental workflow 可以嵌入 Review endpoint，阶段性 baseline generator/workflow 只接受固定 `0.0.1-review` x86_64 descriptor、只在 Review channel 缺失时创建并保持 test channel 不变。
- `pnpm tauri:typecheck`、`pnpm docs:check`、`git diff --check`：Pass。
- GitHub Actions run `31154957966`：Pass；自托管 `vaultmesh-macos-x64` 原生生成 `0.0.1-review` Intel DMG、signed updater archive/signature 和 descriptor，验证三个产品 Mach-O 为 x86_64、deployment target 为 macOS 12.0、app ad-hoc signature、DMG、R2 immutable upload/readback 与公网对象。发布前后 `channels/review/latest.json` 均为 404，`channels/test/latest.json` 仍为 `0.1.1-test.2`。
- GitHub Actions run `31155879860`：Pass；从上述 immutable artifact 原子创建只含 `darwin-x86_64` 的 `channels/review/latest.json`，R2 authoritative/public readback 一致，公网返回 HTTP 200 与 `Cache-Control: no-store, max-age=0`，signed updater URL 返回 200；test channel 发布前后逐字节一致且仍为 `0.1.1-test.2`。用户可见“无更新”结果仍等待本机复测，不把该 CT 计为 macOS AT。
- `0.0.2-review` 发布前自动化：`pnpm scripts:test` 60/60、`pnpm tauri:typecheck`、`pnpm docs:check`、`git diff --check` Pass；四个 Rust workspace package 以 `.2` 完成 `cargo check`，作为后续 GitHub Actions 的 source gate。
- GitHub Actions run `31156352467`：Pass；自托管 Intel Runner 原生生成并发布 `.2` DMG、signed updater archive/signature 与 descriptor，主程序和两个 sidecar 的 x86_64/macOS 12.0、app ad-hoc signature、DMG、R2 immutable upload/readback 全部通过；发布期间 Review channel 保持 `.1`。
- GitHub Actions run `31156762124`：Pass；确认 `.2` 严格高于 `.1`、R2 public/authoritative current manifest 一致后 latest-last 推进 `channels/review/latest.json`，公网 manifest 与 `.2` signed updater 返回 200，test channel 发布前后逐字节一致且仍为 `0.1.1-test.2`。
- GitHub Actions run `31158552455`：Fail；冻结 `.1` source 的 Rust/Tauri release build 完成后，旧构建工具因 MSI ProductVersion 不接受无数值序号的 `review` prerelease 而 fail closed，未上传 R2 对象、未修改 Review/test channel。该问题由 Review application/updater 版本保持完整 SemVer、MSI ProductVersion 映射为三段数值版本的局部构建修正覆盖。
- GitHub Actions run `31160382848`：Pass；单个自托管 `vaultmesh-windows-x64` job 从冻结 source commit `5888198` 构建 `0.0.1-review` signed updater、NSIS 与 MSI，只叠加上述已评审构建工具修正；Windows x86_64 PE、MSI compound header、R2 immutable upload/readback 与公开对象 HTTP 200 全部通过，Review/test channel 发布前后逐字节一致。
- GitHub Draft Prerelease `draft-v0.0.1-review-windows`：NSIS、MSI、updater signature 与 descriptor 四个 Windows x64 测试资产均为 `uploaded`；保持 Draft 且未创建正式 Git Tag，不计为 Windows fresh-install 或更新 AT。
- GitHub Actions run `31162449516`：Pass；同一自托管 Windows x64 Runner 从当前 `main` 原生生成 `0.0.2-review` signed updater、NSIS 与 MSI，Windows x86_64 PE、MSI compound header、R2 immutable upload/readback 全部通过；在 authoritative/public current manifest 一致后，只追加 `windows-x86_64` 并保持既有 `darwin-x86_64` entry 与顶层字段不变。公网 Review manifest 为 `.2` 且两个 updater URL 均返回 HTTP 200；test channel 发布前后逐字节一致、仍为 `0.1.1-test.2`。
- GitHub Draft Prerelease `draft-v0.0.2-review`：原有四个 Intel 资产和新增的 NSIS、MSI、Windows updater signature/descriptor 共八个测试资产均为 `uploaded`；保持 Draft 且未创建正式 Git Tag，不计为 Windows 更新 AT 或完整三平台 Release。
- 当前自动化回归：`pnpm scripts:test` 64/64、`pnpm tauri:typecheck`、`pnpm docs:check`、`git diff --check` Pass；覆盖 frozen `.1` source、Review→MSI 数值版本映射、Windows immutable publication、same-version 缺失平台追加、既有平台/字段保持及 version drift/重复平台/空签名 fail closed。
- `.github/workflows/r2-review-release.yml` 的完整 hosted 三目标 latest-last 发布已通过；macOS/Windows fresh-install、已有 test 安装不降级与手动重装 AT 尚未执行，因此 Work 保持 Implementing。

## 安全与数据生命周期

Updater public key 和 Review HTTPS endpoint 可以进入 release app；private key 与 R2 写凭据仍只属于 CI secret environment。版本重置不得读取、迁移或记录 Vault secret。

## 兼容与迁移

Vault format 3、Browser RPC 2 和 Native ABI 1 不变。`0.0.1-review` 是新的预发布版本基线，不与旧 test channel 建立 downgrade 路径；现有 `0.1.x` 测试用户需要手动安装 Review 包。

## Bug 根因（仅 type=bug）

N/A。
