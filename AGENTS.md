# VaultMesh AI Coding Constitution

本文件是仓库内 AI 执行实现、重构、测试、文档和发布工作的最高优先级规则。

## 1. 开始工作前

AI 必须先完整读取 `AGENTS.md`，再按以下顺序建立最小任务上下文：

1. 已知 Work ID 时，直接读取对应 `changes/<WORK-ID>/change.yaml` 和 `change.md`；不得先枚举或全文搜索其他 Change。若该 Work 已列入 `changes/archive.json`，只允许读取，不得修改其目录内任何文件。
2. 未知 Work ID 时，读取 `docs/00-spec-index.md`，并且只搜索文件名和 `change.yaml` 元数据以定位候选 Work；只有符合第 1.2 节全部条件的直接修改可以没有 Work Package。
3. 按当前 Change 的 `requirements`、`adrs`、`context_refs` 和 `related_changes` 读取直接关联资料；合并型文档默认只读取匹配标题或稳定 ID 的完整小节。
4. 既有 Change 没有路由字段时，从其 Requirement、ADR 和 Traceability 对应行定位主规格，不得因此扫描全部历史 Change。
5. 创建或推进 Change/ADR/Release、修改治理规则时读取 `docs/09-document-governance.md`；修改范围时读取 `docs/02-scope-matrix.md` 的适用小节；设计测试、进入 Verified 或发布时读取 `docs/07-test-release-plan.md` 的适用小节。
6. 修改产品代码前读取当前 Requirement 的完整小节，完成任务前核对 `docs/08-traceability.md` 中对应 Requirement/Test 行。

除第 1.2 节允许的直接修改外，修改产品代码前必须明确 Work ID、Requirement ID 和 Test ID。治理变化可以没有产品 Requirement，但必须使用 `type: governance` 的 Work ID。

## 1.1 文档检索与读取边界

- 搜索命中不等于相关；共享 Requirement、Test ID、模块名、文件路径或宽泛关键词不足以建立 Change 依赖。
- 其他 Change 只有被当前 `related_changes`、`supersedes`、主规格或 ADR 明确引用，或为解决已经发现的规格冲突和历史决策问题时才可读取正文。
- Verified、Rejected、Released 和历史 Bug 默认只保留为证据，不进入当前任务上下文；列入 `changes/archive.json` 后其目录和封存条目永久只读。
- 搜索 Change 必须分两阶段：先用精确 Work/Requirement/Test ID 或代码路径搜索文件名和 `change.yaml` 少量匹配行，再逐个读取能够回答当前未决问题的正文。
- 读取未声明的 Change 前，AI 必须能说明它要回答的具体问题；确认相关后必须把依赖写回当前 Work 的 `related_changes`。
- 除非用户明确要求全库审计，不得批量输出文档目录、拼接多个 `change.md`、用宽泛全文搜索结果代替候选筛选，或从引用继续递归读取超过一层。
- 代码跨越未声明 ownership/privilege boundary、规格与实现冲突、路由不足，或涉及加密、格式、鉴权、秘密所有权、不可逆迁移和平台安全边界时，必须逐个扩大到所有直接相关主规格和 ADR，不受最小读取集限制。
- 扩大范围一次只读取一个候选文件；确认新依赖后更新路由元数据，无法确认时不得把候选继续带入上下文。

## 1.2 Work 与文档比例

- Work 的判断依据是是否需要长期保存产品决策、契约、风险、迁移或跨任务协调，不得按 UI、Bug、重构等修改类别或 diff 大小机械决定。
- 修改同时满足以下通用条件时可以直接实施：处于已接受行为和范围内；影响局部且容易回滚；没有新的产品或架构选择；不跨越安全/信任、secret、数据所有权、持久化/格式、公共 API/Schema/RPC/IPC/ABI、兼容/迁移、平台/范围或发布边界；可以在当前任务完成实现与充分验证。
- 直接修改可以新增或更新局部回归测试、测试数据和快照，只要它们证明已经明确的预期而不是暗中改变契约。测试变化本身不自动要求 Work。
- 典型直接修改包括但不限于 UI/文案微调、恢复既有响应式或可访问性预期、明确局部根因的普通 Bug、内部重构、类型/空值修正、测试补强、开发工具与非发布构建调整，以及不改变语义的局部性能改进。示例不是白名单。
- 出现以下任一情况必须建立或复用 Work：需要修改主规格/Requirement/Scope/ADR；需要产品或安全选择；跨模块/平台/版本协调；涉及生产依赖或许可、迁移、发布/回滚；Bug 严重、反复、根因不明、涉及安全或数据丢失；无法在当前任务完整验证；需要为后续 Agent 保存计划、取舍或未完成状态。
- 需要 Work 但影响有限时使用统一模板的精简正文；进入 Work 的 Bug 必须关联 Requirement、复现和回归证据。完整 Work 用于高风险、跨边界或长期演进事项。
- 多个小修改只有在同一 surface、同一目标和同一验收边界内才可以合并；禁止建立长期接收无关事项的 catch-all Change。

## 2. 权威级别

发生冲突时依次采用：

1. `AGENTS.md`
2. 已接受的 Scope Matrix
3. Functional Requirements
4. 专项 Specs
5. 已接受的 ADR
6. Architecture、Data Model 与 Security
7. 已接受 Change 中尚未合并到主规格的增量
8. 当前代码和测试

代码与规格冲突时不能默认代码正确。先判断是实现缺陷还是规格遗漏；改变已接受行为必须建立 CHG 并同步更新范围、Requirement、测试和 Traceability。公共枚举、Schema 和函数签名以代码为实现定位依据，文档不得复制完整清单形成第二所有者。

## 3. 产品范围

- VaultMesh 是本地优先、单设备密码管理器；当前工作客户端是 Tauri 2 桌面端、Chromium MV3 扩展和 Firefox MV2 扩展。Firefox 不包含 Chromium-only Passkey proxy。
- 当前范围没有账号、服务器、同步、分享或恢复后门。
- Tauri 2 是 macOS/Windows 的唯一产品 shell；Electron 与 SwiftUI/WinUI 产品源码已按 `CHG-2026-008` 移除。
- Optional、Future 和 Out of scope 不得被 AI 自主提升为当前 Required。
- 未决范围使用 `OPEN-*`，AI 不得自行关闭会改变产品或安全边界的事项。

## 4. 架构边界

- `crates/vault-core` 是加密、格式、模型、解锁会话和变更回滚的唯一所有者。
- Tauri renderer 无 Node/filesystem/generic invoke；只通过 window-bound capability 和 typed operation adapter 调用 Rust desktop runtime。
- Rust desktop runtime 必须拥有授权、生命周期、剪贴板、文件对话框、生物识别、SSH、邮件访问和浏览器 broker；不得依赖 N-API 或长期 Node sidecar。
- 扩展是瞬态远程 UI/自动填充代理，不打开 Vault，不持久化 Vault RPC 响应；native host 只转发消息。
- 桌面与扩展授权相互独立；最后一个授权锁定后必须清除解密核心和敏感临时会话。
- 已移除的 Native Preview 历史证据只保留在 Change/ADR；Tauri target 通过共享 Rust runtime/core 调用。

## 5. 安全与数据约束

- 禁止提交真实 Vault、备份、恢复秘密、凭证、OAuth Token、签名密钥或解密 Fixture。
- 禁止记录主密码、Vault Key、受保护字段、邮件正文、OTP、私钥或临时填充值。
- Secret 不得进入 analytics、crash data、持久化 UI state、扩展 storage 或非秘密 settings。
- Renderer-safe summary/detail 必须省略受保护值；读取值只能发生在有界的特权操作中。
- Vault mutation 必须先原子写盘成功再发布新内存状态，失败保留旧文件和旧状态。
- Format 改动必须明确版本/迁移/回滚策略并提供旧格式、恶意输入和失败恢复测试。
- 浏览器 discovery 不得包含页面现有字段值；origin、tab、document、frame、expiry 和 handle 必须绑定到最终 assignment。

## 6. 实现要求

- 以可验证的最小垂直切片修改 core、bridge、schema、service、UI/extension 和测试，不留下跨层半成品。
- Browser RPC 新操作必须同时更新 operation schema、policy、dispatcher、extension client、workflow manifest 和 parity test。
- 失败、取消、重复执行、锁定、过期、导航、撤销和兼容路径必须明确处理。
- 不得用 mock、TODO、静态演示数据或仅通过编译宣称功能完成。
- 平台签名和最终打包验证必须在目标 OS 执行；交叉编译不能替代发布验收。

## 7. 测试与完成定义

- 达到 Work 阈值的 Bug 使用 `BUG-*`，必须先关联现有 Requirement 并增加可复现回归测试；符合第 1.2 节的局部 Bug 可以直接修复，但仍须提供适用的回归验证。
- 不得删除测试、降低断言或修改 Fixture 来隐藏实现问题。
- 有 Work 的任务完成前更新 `docs/08-traceability.md` 中适用行，并把可定位证据写回 Change；直接修改不建立追踪行。
- `Verified` 表示实现和适用测试已通过，并且必须在同一任务结束前封存。发布事实由 Release 记录和 Git Tag 拥有，后续不得为发布回写已封存 Work；`Released` 只作为既有完成态兼容保留。
- 发布门禁和命令以 `docs/07-test-release-plan.md` 为准。

## 8. ADR 触发条件

以下变化必须新增或修订 ADR：加密/KDF/文件格式、核心语言、持久化所有权、Electron privilege boundary、浏览器信任模型、RPC 鉴权、Passkey 私钥归属、Native FFI、平台范围和不可逆迁移策略。

## 9. 文档格式

- Work、Requirement、Test、ADR 和 OPEN ID 永不复用或改变原意。
- 规范使用“必须/应该/可以”或 MUST/SHOULD/MAY，避免“尽量”“通常”“后续优化”。
- 同一规则只能有一个主规格所有者；Change、Traceability 和 Release 只引用，不重新定义完整行为。
- 主规格描述当前目标行为；Git Tag 冻结历史，不复制整套版本文档。
- `changes/archive.json` 以文件集合和 SHA-256 封存完成态 Work；已封存目录、摘要和既有条目不得修改、删除或增补，更正必须创建新 Work。

## 10. Change 与 Release

- 达到 Work 阈值的新功能和行为变化使用 `CHG-*`；需要长期追踪的实现偏离使用 `BUG-*`；安全、依赖、迁移、技术债和治理使用相同结构并设置对应 `type`。
- 状态按 `Draft → Accepted → Implementing → Verified` 推进；拒绝项进入 `Rejected`。`Verified`、`Rejected` 和兼容既有记录的 `Released` 都是完成态，必须执行 `pnpm work:archive -- <WORK-ID>` 后任务才算结束。
- 新功能只有 Accepted 后才能修改产品代码；行为增量先合并进主规格，再进入 Implementing。Bug 不得借修复改变 Requirement。
- 默认 Change 只有 `change.yaml` 和 `change.md`；复杂安全、Schema、ABI 或架构变化才增加 `design.md` 或 ADR。
- Work 文档详略按第 1.2 节与 `docs/09-document-governance.md` 决定；精简不等于免除状态、路由、测试或证据。
- 发布时只引用已封存 Work，从 `releases/_template.md` 创建版本记录并创建同名 Git Tag；不得把已封存 `Verified` Work 回写为 `Released`。
- `pnpm docs:check` 必须验证所有完成态 Work 已封存、文件集合与摘要未变，并相对可信 Git 基线拒绝删除或重写旧封存条目；CI 通过 `VAULTMESH_ARCHIVE_BASE_REF` 提供目标分支或 push 前提交。
- 完整规则与模板以 `docs/09-document-governance.md`、`changes/_template/` 和 `releases/_template.md` 为准。
