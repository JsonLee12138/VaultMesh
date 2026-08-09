# 重建 Public 仓库分支历史

## 问题或目标

用户明确要求从 GitHub 普通分支引用中移除曾加入 AGPL 许可证的提交历史。目标是在保留当前 PolyForm Noncommercial 工作树、不可变 Work 封存记录和产品行为的前提下，以新根提交重建 `main`，并删除仍包含原 AGPL 提交链的远端分支。

## 预期行为

- 重写前必须创建并验证包含全部本地 refs 的可恢复 Git bundle。
- 新 `main` 必须以当前 `PolyForm-Noncommercial-1.0.0` 工作树为唯一根快照，不再以 AGPL 发布提交为祖先。
- 必须使用绑定旧远端 SHA 的 `--force-with-lease` 更新 `main`，不得使用无租约保护的强推。
- 远端 `codex/open-source-license` 与 `codex/finalize-open-source-work` 必须删除；其他不包含 AGPL 提交链的分支不在删除范围。
- 当前许可证、历史权利的条件性说明和既有封存记录继续保留；历史重写不得被描述为撤销既有授权或删除外部副本。

## 非目标

不删除产品代码、不可变封存 Work、Draft Release、构建资产或不含 AGPL 链的分支；不保证移除 GitHub PR 隐藏 refs、缓存、Actions 记录、第三方 clone、镜像或存档；不改变当前 PolyForm 许可、商业授权、产品范围、Vault 格式、加密、API、RPC、IPC 或 ABI。

## 影响范围

影响 Git 提交图、`main`、两个历史远端分支和所有基于旧 SHA 的本地 clone。运行时产品、desktop、extension、native host、core、bridge、Vault format、RPC/IPC/ABI、email/SSH/Passkey、依赖、二进制内容及 Draft Release 资产不变。

## 实现约束

- 恢复 bundle 必须写到仓库目录之外并通过 `git bundle verify`。
- 新根提交必须从已验证且无无关修改的当前索引树生成；强推目标必须是精确的 `refs/heads/main`。
- 删除前后分别通过 GitHub API、`git ls-remote` 和 `git rev-list` 核对精确 refs。
- GitHub 报告 fork 数为 0、无开放 PR、`main` 无分支保护；这些事实降低协调风险，但不证明不存在外部 clone 或缓存。
- 旧 PR 页面和 GitHub 缓存可能继续通过 SHA 访问；需要平台级清理时必须另行联系 GitHub Support。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| `HISTORY-01` | N/A | 仓库外完整 bundle 创建并验证 | `git bundle verify` | In Progress |
| `HISTORY-02` | N/A | 当前树成为新根，旧 SHA 不再可达 | `CT-HISTORY-001` | Pending |
| `HISTORY-03` | N/A | 两个含 AGPL 链的远端分支删除 | `git ls-remote` | Pending |
| `HISTORY-04` | N/A | 远端核验、证据和 Work 封存 | `pnpm docs:check` | Pending |

## 验收与证据

- `git bundle verify <backup>` 必须成功并报告完整历史。
- `node --test scripts/repository-history-policy.test.mjs`
- `pnpm scripts:test`
- `pnpm docs:check`
- `git ls-remote --heads --tags origin` 不得包含两个删除目标；`main` 必须指向新提交链。
- GitHub 元数据必须保持 `visibility: PUBLIC`、默认分支 `main`、fork 数 0、当前 PolyForm 根许可证存在。

## 安全与数据生命周期

不读取或新增 secret，不改变任何 secret owner、DTO、日志、clipboard、crash 或 backup 行为。bundle 是完整仓库恢复副本，保存在本机仓库外，不提交、不上传；其中仍含被移除历史，用户可以在确认无需恢复后自行删除。

## 兼容与迁移

旧 clone 必须重新 clone，或 fetch 新 `main` 后显式 reset/rebase；旧 commit SHA、比较链接和基于旧主线的分支不会自动迁移。Draft Release 及其历史 target SHA/资产不在本次重写范围。外部已有副本与可能已经取得的许可权利不受 Git 引用删除影响。

## Bug 根因（仅 type=bug）

N/A（`type: governance`）。
