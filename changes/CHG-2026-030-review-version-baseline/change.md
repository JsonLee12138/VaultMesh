# 以 0.0.1-review 建立独立 Review 发布基线

## 问题或目标

当前源码版本为 `0.1.0`，已发布的 R2 test channel 最高版本属于 `0.1.1-test.*`。本次需要把下一轮人工评审安装包重置为 `0.0.1-review`，同时不得通过覆盖旧清单或关闭 SemVer 检查让现有测试客户端降级。

## 预期行为

- `REQ-UPDATE-002`：`0.0.1-review` 是 fresh-install 基线；当前 workspace、Tauri desktop、Chromium extension 与 Rust package 必须统一为 `0.0.3-review`，并由 `.1 → .2 → .3` 严格递增。
- Review build 必须使用独立的 `channels/review/latest.json`；首次发布允许该通道没有现有清单，但后续版本仍必须严格递增。
- 小规模验收可以先发布只含已验证目标平台的阶段性 Review manifest；同一 current version 可以在 immutable artifact 就绪后只追加一个缺失平台，同时保持全部既有字段不变。该路径不计为完整三平台 Review 发布或平台 AT。
- 现有 `channels/test/latest.json` 和其中的 `0.1.1-test.*` 安装不得被覆盖、删除或降级。已有测试安装加入 Review 必须明确执行手动重装。
- Review artifact 继续使用标准 GitHub-hosted macOS ARM64、macOS Intel、Windows x64 三目标原生构建、Tauri updater 签名、版本对象不可变和 latest-last 发布；全部发布 workflow 不依赖 self-hosted 或自定义 Runner 标签。Review 不等于正式 Stable 发布。
- 完整 Review workflow 必须为 Windows 同时生成 NSIS 与 MSI；R2 完整发布成功后必须创建或恢复同 source SHA 的 GitHub Draft Prerelease，只上传两个 DMG 与 Windows NSIS/MSI installers。Draft 不得创建 Git Tag，也不得冒充正式发布或平台 AT。

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
| `REV-011` | `REQ-UPDATE-002` | R2 成功后创建无 Git Tag 的 GitHub Draft Prerelease，并上传双 macOS DMG 与 Windows NSIS/MSI | `CT-UPDATE-REVIEW-001` | Implementing；Draft 已有三资产，`.3` MSI build/upload Pending |
| `REV-003` | `REQ-UPDATE-002` | macOS/Windows Review fresh-install 与后续升级验收 | `AT-UPDATE-REVIEW-MACOS-001`, `AT-UPDATE-REVIEW-WINDOWS-001` | Pending |

## 验收与证据

- 自动化证明当前所有产品 manifest 与 workspace package version 都是 `0.0.3-review`，历史 `.1` 仍作为安装基线保留，`.2` 保留为已发布的中间 Review 更新。
- 自动化证明 Review workflow 只读写 `channels/review/latest.json`，使用标准 GitHub-hosted 原生架构 Runner 执行三平台、签名、immutable 和 latest-last 校验，且全部发布 workflow 不包含 `self-hosted` 或自定义 Runner 标签。
- 平台验收从全新安装开始；已有 `0.1.x` 测试安装必须验证不会收到 `0.0.1-review` 自动降级，并按指引手动重装。

自动化证据（2026-08-07）：

- 2026-08-10 完整 Review workflow 固定使用 `macos-15` ARM64、`macos-15-intel` x86_64、`windows-2025` x64 与 `ubuntu-24.04` publisher，并新增 host platform/architecture fail-closed 断言；阶段性 Review publisher 和 experimental package 也迁到标准 GitHub-hosted Runner。全部 workflow YAML parse Pass；`pnpm scripts:test`：78/78 Pass；完整三目标 GitHub Actions run Pending。
- `0.0.3-review` 触发前本地 gate：五个 pnpm/Tauri manifest 与四个 Rust workspace package 版本一致；`cargo check -p vaultmesh-core -p vaultmesh-ffi -p vaultmesh-agent-mcp -p vaultmesh-tauri-desktop`、`cargo test -p vaultmesh-tauri-desktop --lib`（220 pass、1 ignored）、`pnpm scripts:test`（78/78）、`pnpm tauri:typecheck`、`pnpm docs:check`、workflow YAML parse 与 `git diff --check` Pass。GitHub Actions 三目标 package/R2 latest-last publication Pending。
- GitHub Actions run `31351302181`：Fail closed；标准 hosted `macos-15` ARM64 与 `macos-15-intel` x86_64 均完成 signed updater、DMG、artifact normalize/upload，`windows-2025` x64 在编译 Windows 托盘主题模块时发现私有子模块函数的 re-export 可见性错误。publisher job 被依赖门禁跳过，未上传 R2 immutable objects、未修改 Review channel。修复把两个平台函数提升为 `pub(crate)` 并收窄非 Windows 的 `Image` import；修复后本地 `cargo test -p vaultmesh-tauri-desktop --lib`（220 pass、1 ignored）、workspace `cargo check`、`pnpm scripts:test`（78/78）、`pnpm docs:check` 与 `git diff --check` Pass，完整 hosted 复跑 Pending。
- GitHub Actions run `31352257713`（source `4592da1`）：Pass；标准 hosted macOS ARM64、Windows x64、macOS Intel 分别在 10m01s、22m37s、25m33s 完成原生 signed updater 与 Review installer 构建、normalize 和 artifact upload，Windows 实际编译通过托盘主题 cfg 分支并生成 NSIS `setup.exe`。Ubuntu publisher 在三者全部成功后才上传 immutable version objects，并最后写入、readback 校验 `channels/review/latest.json`。
- 独立公网校验：Review manifest 为 `0.0.3-review`，平台键恰为 `darwin-aarch64`、`darwin-x86_64`、`windows-x86_64`；三个 updater URL、Apple Silicon DMG、Intel DMG 与 Windows NSIS installer 均返回 HTTP 200。完整 workflow 未声明 MSI，因此该 run 不产生 MSI；这不改变当前三平台 Review 发布契约。
- GitHub Draft Prerelease 自动化只在 build 与 R2 publisher 全部成功后运行，要求 `contents: write` 仅属于该 job；它验证两个 DMG 与 Windows NSIS/MSI、Draft/prerelease/source SHA 状态与远端 Tag 不存在，并以不覆盖既有资产的方式支持失败 job 重跑。公开 Prerelease 仍受 GATE-6、Work 封存、Release record 与 Git Tag 门禁约束。
- GitHub Draft Prerelease `untagged-53638acaa8f1260a1fbf`：target commit 为 `4592da1`，Apple Silicon DMG、Intel DMG 与 Windows x64 NSIS 三个资产均为 `uploaded`；MSI 正在通过同 source 的原生 Windows experimental workflow 补建。API 状态为 Draft + Prerelease，远端 `v0.0.3-review` Git Tag 不存在。该 Draft 只供维护者人工验收，不计为公开或正式发布。

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
