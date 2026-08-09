# 以 AGPL-3.0-or-later 开源 VaultMesh 源码

## 问题或目标

Rust workspace 已声明 `AGPL-3.0-or-later`，但仓库缺少许可证正文、开源入口文档和一致的 JavaScript workspace 元数据，GitHub 仓库仍为 Private。目标是把既有许可选择正式落地，并在安全检查通过后公开源码仓库。

## 预期行为

- 仓库根目录必须包含 GNU Affero General Public License v3 正文，并明确允许使用“任何后续版本”。
- Rust 与 JavaScript workspace 必须一致声明 SPDX 标识 `AGPL-3.0-or-later`；`private: true` 继续阻止意外发布 npm 包，但不限制源码许可。
- README 必须说明项目定位、开发入口、许可、贡献和安全披露入口，不得宣称正式二进制发布 Gate 已通过。
- GitHub 仓库只有在当前树和 Git 历史的秘密筛查通过、许可证与开源文档进入默认分支后才可以切换为 Public。
- `docs/02-scope-matrix.md` 必须区分“源码公开”和“正式产品公开发布”，保留 `OPEN-003` 与 Gate 1–6。

## 非目标

不发布安装包、不创建 Release 或 Git Tag，不关闭 `OPEN-003`，不改变品牌/商标授权，不承诺维护 SLA，也不改变 Vault 格式、加密、依赖、公共 API、RPC、IPC 或 ABI。

## 影响范围

影响仓库治理、根目录开源文档、Rust/pnpm 包元数据和 GitHub 可见性。desktop、extension、native host、core、bridge、Vault format、RPC/IPC/ABI、email/SSH/Passkey、运行时性能和生产依赖均无行为变化。正式发布 Gate 保持不变。

## 实现约束

- 许可证正文必须使用 GNU 发布的 AGPLv3 标准文本，不得自行改写条款。
- 项目自有源代码使用 `AGPL-3.0-or-later`；依赖及仓库内明确标注的第三方材料继续受各自许可证约束。
- 版权声明使用中性的 `VaultMesh contributors`，避免把 Git author 名称误当作法律权利人。
- 公开前的秘密筛查不得把疑似秘密值写入 Work、日志摘要或提交信息；只记录命令、检查范围和通过/阻塞结果。
- 远端可见性切换必须发生在许可证提交已进入默认分支之后；若无法安全完成提交或历史筛查，则保持 Private。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| `OSS-01` | N/A | `LICENSE`、README、贡献与安全披露文档 | `CT-OSS-001` | Complete |
| `OSS-02` | N/A | Rust/JavaScript workspace 的 SPDX 与仓库元数据一致 | `CT-OSS-001` | Complete |
| `OSS-03` | N/A | 规格明确源码公开不等于正式产品发布 | `pnpm docs:check` | Complete |
| `OSS-04` | N/A | 当前树和全部 Git 历史秘密筛查无阻塞 | manual scan | Complete |
| `OSS-05` | N/A | 许可提交进入默认分支后 GitHub 仓库为 Public | GitHub metadata | Complete |

## 验收与证据

- `node --test scripts/open-source-metadata.test.mjs`
- `pnpm scripts:test`
- `pnpm docs:check`
- 当前树与全部可达 Git 历史执行凭据/私钥模式筛查，只记录结果。
- GitHub 最终元数据必须显示 `visibility: PUBLIC` 且许可证可识别为 AGPL-3.0。
- 本变更不适用产品 happy path、取消、重复、锁定、过期或目标 OS package AT；失败路径是任一秘密筛查或元数据一致性检查失败时保持仓库 Private。

实施中证据（`2026-08-09`）：

- `node --test scripts/open-source-metadata.test.mjs`：4/4 通过。
- `pnpm scripts:test`：68/68 通过。
- `pnpm docs:check`：通过（92 Markdown、50 YAML、49 requirements、120 test IDs、16 ADRs、37 routed Changes、24 archived Changes）。
- `cargo metadata --no-deps --format-version 1`：通过。
- pnpm CLI 的 `licenses list --prod --json` 清单：生产 JavaScript 依赖只报告 0BSD、Apache-2.0、Apache-2.0 OR MIT、ISC、MIT 与 Unlicense。
- Gitleaks `v8.30.1` 对全部可达 Git 历史启用脱敏扫描；13 个既有 marker-only/test/public-key 误报以精确 fingerprint 核验后，未解释命中为 0。额外强模式检查确认没有完整可解析私钥块，也没有 AWS、GitHub、Slack、Stripe、OpenAI 或 Google 生产凭据形态；GitHub 形态字符串均为长度无效的测试 fixture。
- PR `#2` 已于 `2026-08-09` 合并到 `main`，merge commit 为 `210a7c1befc75c850d5ac82b21ba272c5976b805`；失败的 GitHub Actions job 未启动，annotation 明确指向账户 payment/spending limit，用户授权基于上述本地门禁以管理员权限合并。
- GitHub 最终元数据显示 `visibility: PUBLIC`、默认分支 `main`、许可证 `GNU Affero General Public License v3.0`，根 `LICENSE` 位于默认分支；私密漏洞报告、secret scanning 与 push protection 均已启用。

## 安全与数据生命周期

不新增 secret、不读取 Vault 数据、不改变任何 secret owner 或 DTO。检查过程仅分析版本库内容；疑似秘密值不得复制到文档。GitHub 公开会扩大既有源码和历史的读者范围，因此秘密筛查是可见性切换的硬门禁。

## 兼容与迁移

Vault format/payload、RPC/IPC/ABI、settings、pairing、upgrade、downgrade 和 rollback 均无变化。仓库可见性可以回退为 Private，但已经公开并被第三方取得的 AGPL 版本与副本不可撤回；该不可逆传播属性由明确许可和公开前检查控制。

## Bug 根因（仅 type=bug）

N/A（`type: governance`）。
