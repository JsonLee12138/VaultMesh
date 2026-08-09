# 采用 PolyForm Noncommercial 与独立商业许可

## 问题或目标

VaultMesh 目前按 `AGPL-3.0-or-later` 公开。项目所有者决定自重新许可提交起改为 `PolyForm-Noncommercial-1.0.0`，允许非商业使用，并由 `atlantis-mk <atlanxg@gmail.com>` 单独提供商业授权。该许可属于 source-available，不得继续称为 OSI 开源。

## 预期行为

- 根 `LICENSE`、Rust 与 pnpm 元数据必须一致使用 SPDX 标识 `PolyForm-Noncommercial-1.0.0`。
- README 和许可说明必须准确写明非商业许可、商业授权入口、第三方材料边界，以及本项目不再属于 OSI 开源软件。
- 商业使用必须取得 `atlantis-mk <atlanxg@gmail.com>` 另行签署的书面协议；公开仓库中的商业许可说明本身不授予商业权利。
- 重新许可前已公开并由接收者按 `AGPL-3.0-or-later` 取得的版本继续适用原授权，不得宣称撤销或追溯限制。
- 商业授权仅覆盖授权方拥有或有权再许可的权利；第三方依赖、材料和未另行授权商业再许可的贡献继续适用各自条款。

## 非目标

不把 PolyForm 描述为开源许可证，不撤销历史 AGPL 权利，不发布二进制、Release 或 Git Tag，不改变商标授权、产品范围、依赖、Vault 格式、加密、公共 API、RPC、IPC、ABI 或正式发布 Gate。本 Work 不制定价格、服务等级、担保、适用法律或完整商业合同模板。

## 影响范围

影响仓库许可治理、根目录说明、贡献流程、Rust/pnpm 包元数据和 GitHub 展示信息。desktop、extension、native host、core、bridge、Vault format、RPC/IPC/ABI、email/SSH/Passkey、安全边界、运行时性能、生产依赖及正式发布 Gate 无行为变化。

## 实现约束

- `LICENSE` 必须使用 PolyForm 官方发布的 Noncommercial 1.0.0 标准文本，不得改写。
- `LICENSING.md` 必须包含 `Required Notice:` 行，并明确当前许可、历史授权、第三方材料及商业授权边界。
- 历史 AGPL 标准文本必须作为只读许可证据保留，但不得被元数据误认为当前许可证。
- 未另行签署贡献协议的第三方贡献不得被宣称可由项目所有者商业再许可。
- 远端仓库保持 Public；移除 `agpl`/`open-source` 等可能误导的展示元数据，改用 source-available/noncommercial 表述。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| `LICENSE-01` | N/A | PolyForm 标准正文、历史 AGPL 文本与许可边界说明 | `CT-LICENSE-001` | Complete |
| `LICENSE-02` | N/A | Rust/pnpm SPDX 与 README/贡献规则一致 | `CT-LICENSE-001` | Complete |
| `LICENSE-03` | N/A | GitHub 描述与 topics 不再误称 OSI 开源 | GitHub metadata | Complete |
| `LICENSE-04` | N/A | 规格、测试定位、证据和封存完成 | `pnpm docs:check` | Complete |

## 验收与证据

- `node --test scripts/open-source-metadata.test.mjs scripts/source-license-metadata.test.mjs`
- `pnpm scripts:test`
- `pnpm docs:check`
- `cargo metadata --no-deps --format-version 1`
- GitHub 默认分支根 `LICENSE` 和仓库描述/topics 必须与 source-available 非商业许可一致。
- 本变更不适用产品 happy path、取消、重复、锁定、过期或目标 OS package AT；失败路径是元数据、标准文本或权利边界不一致时不得完成 Work。

实施中证据（`2026-08-09`）：

- `node --test scripts/open-source-metadata.test.mjs scripts/source-license-metadata.test.mjs`：7/7 通过。
- `pnpm scripts:test`：73/73 通过。
- `pnpm docs:check`：通过（93 Markdown、51 YAML、49 requirements、120 test IDs、16 ADRs、38 routed Changes、25 archived Changes）。
- `cargo metadata --no-deps --format-version 1`：通过，workspace license 为 `PolyForm-Noncommercial-1.0.0`。
- PR `#4` 已于 `2026-08-09` 合并到 `main`，merge commit 为 `d97b7992e16cc8f2409c248abcfbf3278a3fc84b`；GitHub `docs-check` 通过。
- GitHub 最终元数据显示 `visibility: PUBLIC`，描述包含 `Source-available, noncommercial`，topics 包含 `source-available` 与 `noncommercial` 且不再包含 `agpl`。GitHub license classifier 显示 `Other`，默认分支根 `LICENSE` 与项目 SPDX 元数据均为 `PolyForm-Noncommercial-1.0.0`。

## 安全与数据生命周期

不新增或读取 secret，不改变任何 secret owner、process、DTO、持久化、日志、clipboard、crash 或 backup 行为。仓库已经 Public，本次不扩大秘密暴露面。

## 兼容与迁移

Vault format/payload、RPC/IPC/ABI、settings、pairing、upgrade、downgrade 和 rollback 均无变化。许可切换对新版本生效；已经按 AGPL 获得历史版本的接收者可以继续依其不可撤销授权使用和分发该历史版本。商业客户只能获得授权方拥有或被授权再许可部分的商业权利。

## Bug 根因（仅 type=bug）

N/A（`type: governance`）。
