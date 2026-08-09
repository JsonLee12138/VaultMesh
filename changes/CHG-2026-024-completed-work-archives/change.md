# 完成态 Work 文档不可变封存

## 问题或目标

现有治理保留 `Verified`、`Released` 和 `Rejected` Work，但允许后续直接修改其 YAML、正文或补充文件，导致已经完成的任务证据可以被回写。目标是为完成态 Work 增加最后一次封存操作，并让本地与 CI 门禁拒绝后续修改、删除、增补或重新计算既有封存记录。

## 预期行为

- `Verified`、`Released` 和 `Rejected` 是完成态；Work 到达完成态后必须运行 `pnpm work:archive -- <WORK-ID>`。
- 封存清单记录 Work 当时的状态、时间、完整文件集合和逐文件 SHA-256；封存不移动目录，既有路由路径继续有效。
- 已封存 Work 的文件集合、内容和既有清单条目不可修改；更正或补充必须创建新的 Work，并在当前主规格、Traceability 或 Release 中引用新 Work。
- 发布事实由 Release record 与 Git Tag 唯一拥有。新 Work 到 `Verified` 后即封存，后续 Release 只引用它，不再把其状态改写为 `Released`；`Released` 仅作为兼容既有记录的完成态保留。
- `pnpm docs:check` 必须拒绝未封存的完成态 Work、摘要不匹配、文件增删、状态漂移，以及相对基线被删除或重写的封存条目。

## 非目标

- 不冻结 `docs/`、`specs/`、`adr/`、Traceability 或 Release record；它们按各自治理继续演进。
- 不把只读权限位、目录移动或重复版本树作为不可变保证。
- 不修改产品行为、Requirement、Vault format、RPC、IPC、ABI 或发布范围。

## 影响范围

- 治理：调整 Work 完成与发布关系，增加封存清单和更正路径。
- 工具：增加封存命令、摘要/文件集校验和 Git 基线追加约束。
- CI：以目标分支或 push 前提交作为封存基线执行文档门禁。
- 产品代码、安全数据流、依赖、平台打包和发布 Gate：无。

## 实现约束

- `changes/archive.json` 是封存状态的唯一机器可读所有者；Work 文档不增加可被再次改写的 archive 字段。
- 封存条目一经进入受保护基线，只能追加新 Work，不能删除、替换或重新计算旧条目。
- 本地默认相对 `HEAD` 检查未提交改动；CI 必须通过 `VAULTMESH_ARCHIVE_BASE_REF` 指定可信基线，防止同一提交同时篡改正文和摘要。
- 完成态历史 Work 通过一次性迁移生成初始封存条目；不回写其既有文档。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| GOV-ARCHIVE-001 | N/A | 封存清单格式与完成/发布语义 | DOC-ARCHIVE-001 | Done |
| GOV-ARCHIVE-002 | N/A | `work:archive` 命令与 SHA-256 文件集记录 | DOC-ARCHIVE-001 | Done |
| GOV-ARCHIVE-003 | N/A | `docs:check` 内容、完整性和追加式基线校验 | DOC-ARCHIVE-001 | Done |
| GOV-ARCHIVE-004 | N/A | 既有完成态 Work 初始封存迁移 | DOC-ARCHIVE-001 | Done |

## 验收与证据

- `DOC-ARCHIVE-001` 已覆盖成功封存、未完成状态拒绝、重复封存拒绝、封存后内容变化拒绝、基线首次引入兼容，以及 CI 基线下旧条目不可重写。
- `node --check scripts/work-archive-lib.mjs`、`node --check scripts/archive-work.mjs`、`node --check scripts/docs-check.mjs`：通过。
- `pnpm scripts:test`：18/18 通过，其中 4 项为封存与 Git 基线回归。
- `pnpm docs:check`：通过；81 Markdown、42 YAML、44 Requirements、105 Test IDs、13 ADRs、29 routed Changes、23 archived Changes。
- 一次性迁移已为 22 个历史完成态 Work 建立封存记录；本 Work 完成后成为第 23 个封存记录，历史原文和 YAML 均未回写。
- `.github/workflows/document-governance.yml` 在 PR 使用目标提交、在 main push 使用 push 前提交作为 `VAULTMESH_ARCHIVE_BASE_REF`。
- 产品、平台、打包与安全 AT 均为 N/A。

## 安全与数据生命周期

清单只保存 Work ID、状态、时间、仓库相对路径和 SHA-256，不保存产品数据或 secret。封存工具只读取 `changes/<WORK-ID>/`，不会读取 Vault、凭据或工作区外文件；符号链接会被拒绝。

## 兼容与迁移

新增版本 1 的 `changes/archive.json`。既有 Work 路径、YAML schema、Requirement/Test、产品格式、RPC/IPC/ABI 和 settings 不变；所有现有 `Verified`、`Released`、`Rejected` Work 在本变更完成时生成初始封存记录。

## Bug 根因（仅 type=bug）

N/A（本 Work 为 governance）。
