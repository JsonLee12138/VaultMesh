# 删除并重建同名 GitHub 仓库

## 问题或目标

普通分支历史已经从 PolyForm 新根重建，但旧 GitHub 仓库仍通过 PR 隐藏 refs 和 SHA 页面保留此前提交。用户明确确认删除 `atlantis-mk/VaultMesh` 并创建同名 Public 新仓库，同时要求备份两个 Draft Release、但不把它们重新上传。

## 预期行为

- 删除前必须在仓库外备份两个 Draft Release 的完整元数据和全部资产，并记录 SHA-256 清单。
- 已验证的完整 Git bundle 必须继续保留在仓库外，删除操作不得触碰该恢复文件。
- 删除目标必须精确为 `atlantis-mk/VaultMesh`；创建的新仓库必须使用相同 owner/name、Public 可见性和默认分支 `main`。
- 新仓库只接收当前 PolyForm `main`；不得推送旧分支、旧 tag、旧 bundle 或 Draft Release。
- 必须恢复 source-available/noncommercial 描述与 topics，并启用 secret scanning、push protection 和 private vulnerability reporting。
- 删除与重建不得被描述为撤销外部副本或许可权；GitHub 可能在恢复期内保留已删除仓库的后台数据。

## 非目标

不重新上传 Draft Release 或旧构建资产，不迁移旧 PR、Issue、Actions 日志、缓存、仓库 ID、Release、Star、Watcher、Webhook 或 Deployment，不删除外部 clone、镜像、存档或本地恢复 bundle，不改变产品代码、当前 PolyForm 许可、商业授权、Vault 格式、加密、API、RPC、IPC 或 ABI。

## 影响范围

影响 GitHub 仓库身份、PR/Actions/Release 历史、仓库安全设置和公开元数据。当前检查显示 fork、issue、star、watcher、webhook、deployment 均为 0；旧仓库有 6 个 merged PR、两个含资产的 Draft Release 和多条 Actions 运行记录。运行时产品及二进制内容不变。

## 实现约束

- 备份目录必须在仓库外，不得提交或上传；每个下载资产必须与 GitHub API 的名称和大小对应，并生成本地 SHA-256。
- 只有资产、元数据、完整 bundle 和当前工作树均验证成功后才允许调用删除 API。
- 删除后必须确认旧仓库返回 404，再创建同名空仓库；若名称暂不可复用，停止并报告，不得改用其他仓库名。
- 新仓库创建后必须先推送 `main`，再恢复元数据和安全设置，并通过 GitHub API 读取最终状态。
- GitHub CLI 需要 `delete_repo` 权限；若当前 token 缺少该 scope，必须暂停并要求用户完成 GitHub 授权，不得绕过。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| `RECREATE-01` | N/A | 两个 Draft Release 元数据、资产与 SHA-256 本地备份 | `CT-REPOSITORY-001` | Complete |
| `RECREATE-02` | N/A | 旧仓库删除、同名 Public 仓库创建 | `CT-REPOSITORY-001` | Complete |
| `RECREATE-03` | N/A | 只推送当前 PolyForm main 并恢复安全/展示设置 | `CT-REPOSITORY-001` | Complete |
| `RECREATE-04` | N/A | 远端核验、证据与 Work 封存 | `pnpm docs:check` | Complete |

## 验收与证据

- 本地备份必须包含两份 Release 元数据、所有远端资产和 SHA-256 清单；Draft Release 不得出现在新仓库。
- `gh repo view` 与 REST API 必须证明新仓库为 Public、默认分支为 `main`，created/repository ID 与旧仓库不同。
- `git ls-remote --heads --tags origin` 必须只显示预期的新 `main`（收尾 PR 临时分支在合并后删除），且不得存在旧 tag。
- `CT-HISTORY-001`、`pnpm scripts:test`、`pnpm docs:check` 必须通过。
- GitHub API 必须证明 secret scanning、push protection、private vulnerability reporting 已启用，description/topics 正确，Release/Issue/旧 PR 数量为 0。

实施中证据（`2026-08-09`）：

- `/Users/atlan/Documents/VaultMesh-github-backup-20260809/` 保存旧仓库元数据、两份 Draft Release 元数据和 12 个资产，总大小约 67 MiB；`SHA256SUMS` 与 GitHub API digest 逐项一致，`verify-backup.mjs` 通过。资产未上传到新仓库。
- `/Users/atlan/Documents/VaultMesh-history-before-rewrite-20260809.bundle` 再次通过 `git bundle verify`，报告 36 refs 与完整历史；恢复 bundle 未上传。
- 删除前旧仓库 ID 为 `1311999841`（`R_kgDOTjOHYQ`）；删除后 REST API 返回 404。新同名仓库 ID 为 `1328458129`（`R_kgDOTy6pkQ`），创建时间为 `2026-08-09T05:14:31Z`，证明是独立 repository identity。
- 新仓库为 `PUBLIC`，默认分支 `main`；首次推送后 `git ls-remote --heads --tags origin` 只显示 `main`，无 tag。根许可证和 package metadata 保持 `PolyForm-Noncommercial-1.0.0`。
- 新仓库 Release、PR、Issue 均为空；旧 PR `#2` API 返回 404，旧 merge SHA `210a7c1` API 返回 422 `No commit found`。新仓库首次 `Document governance` Actions run `31296273120` 通过。
- description 为 `Source-available, noncommercial local-first password manager built with Rust, Tauri 2, and Chromium MV3`；topics 恢复为 `browser-extension`、`local-first`、`noncommercial`、`password-manager`、`rust`、`source-available`、`tauri`；Issues 启用，Discussions/Wiki 关闭。
- GitHub API 证明 secret scanning、push protection、private vulnerability reporting 均已启用；Dependabot security updates、non-provider patterns 与 validity checks 继续保持旧仓库的 disabled 状态。
- `CT-HISTORY-001`：3/3 通过；`pnpm scripts:test`：76/76 通过；`pnpm docs:check`：通过（95 Markdown、53 YAML、49 requirements、120 test IDs、16 ADRs、40 routed Changes、27 archived Changes）；`cargo metadata --no-deps --format-version 1`：通过。

## 安全与数据生命周期

不读取产品 secret。Draft Release 资产、元数据、完整 Git bundle 和校验清单只保存在本机仓库外；它们可能包含旧构建和历史，因此不得进入新仓库。新仓库没有继承旧 repository-scoped secret；本次不创建部署凭据。

## 兼容与迁移

旧 clone 的 remote URL 不变，但 GitHub repository ID、PR/Actions/Release 链接和服务端 refs 全部重新开始。旧 clone 仍保留其本地历史，必须自行重新 clone 或清理。旧 Draft Release 仅能从本地备份恢复，且本 Work 明确不重新上传。

## Bug 根因（仅 type=bug）

N/A（`type: governance`）。
