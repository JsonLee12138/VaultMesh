# 面向 AI 的规格、变更与版本治理

## 问题或目标

原文档已经精简为 AI 可读的架构、安全、格式和专题规范，但缺少稳定 Requirement/Test ID、一次变化的增量记录、ADR 原因、Traceability 和 Release 兼容证据。目标是引入一条可以随功能和版本演进而维护的闭环，同时避免复制代码中的 API/Schema 清单。

## 预期行为

- `AGENTS.md` 定义读取顺序、权威级别、禁止行为和 Change/Release 状态机。
- `docs/` 拥有当前产品、范围、Requirement、架构、数据、安全、测试和追踪。
- `specs/` 拥有 browser、email OTP 和 native migration 的跨模块细节。
- `adr/` 记录 Rust core、Electron boundary、browser trust 和 native migration 的原因。
- `changes/_template/` 与 `releases/_template.md` 可以直接用于后续功能、Bug 和版本。
- 本次变化不修改产品行为、Vault format、RPC、ABI 或代码。

## 非目标

- 不为现有每个函数创建 Requirement。
- 不宣称尚未运行的测试为 Pass。
- 不建立面向人员汇报、会议或工时的文档。
- 不复制 Mibo Player 的媒体业务规格。

## 影响范围

- 重构所有 VaultMesh Markdown 文档及 AI 阅读入口。
- 新增 Requirement/Test/ADR/OPEN ID 和 Traceability。
- 新增 Change、ADR、Release 模板。
- 删除被新主规格和 Spec 替代的旧文件路径。
- 产品代码、安全边界和运行时行为无变化。

## 实现约束

- 同一规则只能有一个主规格所有者。
- Code 保留完整 API/Schema 枚举；文档只记录行为、原因和实现定位。
- Traceability 初始状态必须反映实际已执行证据；不以代码存在代替 Pass。
- YAML、相对引用、Requirement/Test 集合和命令必须可机械校验。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| GOV-001 | N/A | 规格索引、范围、Requirement 和治理 | DOC-GATE-001 | Done |
| GOV-002 | N/A | Architecture/Data/Security 主规格和专项 Specs | DOC-GATE-001 | Done |
| GOV-003 | N/A | ADR、Change、Release 模板 | DOC-GATE-001 | Done |
| GOV-004 | N/A | Traceability 与证据状态 | DOC-GATE-001 | Done |

## 验收与证据

- `DOC-GATE-001`：`pnpm docs:check` 对 24 份 Markdown、2 份 YAML、23 个 Requirement、39 个 Test ID 和 4 个 ADR 检查通过。
- Rust：fmt/check 通过；core/FFI 共 25 tests 通过。
- Electron：typecheck 通过；34 files / 170 tests 通过。
- Browser extension：typecheck、production build 通过；21 files / 132 tests 通过。
- Native host：6 tests 通过。
- Browser parity：2 files / 6 tests 通过。
- Platform/package AT 未执行，在 Traceability 中保持 Not Run；本治理 Change 不对应产品 Release，因此状态为 Verified 而不是 Released。

## 安全与数据生命周期

只重组既有安全规则，不引入新的 secret、process、persistence 或 telemetry 路径。安全规则由 `docs/06-security-privacy.md` 唯一拥有。

## 兼容与迁移

文档路径发生替换，产品格式和运行时无迁移。未来 AI 从 `docs/00-spec-index.md` 读取新路径；Git 历史保留被替代文档的来源。
