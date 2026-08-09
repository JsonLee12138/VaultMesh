# 以网站或服务聚合关联的 Vault 内容

## 问题或目标

Vault 当前按 Login、SSH credential、identity 和 developer/service secret 分类。该模型适合执行类型化安全策略，
但用户通常按“这是哪个网站或服务的内容”寻找信息；同一服务的多个登录账号、API token、SSH 凭据、Passkey、
管理后台和备注因此分散在不同列表。

本阶段新增用户可见的“网站/服务”聚合入口。它只负责组织、导航和安全 metadata，不取代 Login、Secret、SSH、
Passkey 等现有 item，也不成为凭据、自动填充 target、HTTP target 或权限的第二所有者。

现有 Vault 可能已有约 1000 条记录，因此主流程不是要求用户逐条手工关联。VaultMesh 必须在本地根据现有记录的
URI、website、SSH host、Passkey RP/既有关联和安全标题 metadata 生成确定性的批量聚合方案；用户只需查看总体结果、
一次确认高置信度分组，再集中处理少量冲突和无法识别的记录。

## 预期行为

新增 `REQ-SERVICE-001`：

- 用户可以创建、编辑、搜索、删除、恢复和清理网站/服务记录，并为其保存名称、非秘密说明、标签和一个或多个
  明确的 HTTP(S) 站点地址。
- 用户可以显式关联现有 Login、developer/service Secret、SSH credential 和其他适用 item；一个服务可以包含多个账号
  和凭据，关联不复制受保护值，也不改变子 item 的独立 CRUD、history、re-prompt 和 secret lifecycle。
- 对现有 Vault，用户可以启动一次性“自动整理”。系统必须只在本地扫描 safe metadata，生成 service cluster、拟创建
  Service、拟关联 item、冲突和未分组数量；不需要逐条确认高置信度结果。
- 用户确认后，高置信度 cluster 作为一次原子批次写入；写入失败不发布部分结果。中/低置信度记录保持原样并进入
  “待确认”或“未分组”，不能为了覆盖率强制归入最相似服务。
- 初次整理完成后，新建、导入或更新 item 可以按同一确定性规则自动关联到唯一高置信度 Service；无唯一结果时只生成
  待确认建议。用户可以在设置中关闭持续自动聚合。
- 服务详情按“概览、登录账号、API/密钥、SSH、其他”展示关联内容，并允许进入原 item 的既有详情和特权操作。
- 服务删除只删除或进入 trash 的聚合记录，不级联删除关联 item；item 删除、恢复或 purge 后，聚合关系必须保持
  可验证且不得留下可导航到错误 item 的类型混淆引用。
- 用户可以批量合并重复 Service、拆分错误 cluster、把 item 移到其他 Service、忽略建议并重新运行扫描；重复扫描不得
  创建重复 Service/link，输入未变化时必须生成相同计划。
- 相同基础域、相似名称、SSO 或重定向只影响组织置信度，永远不能建立跨 origin 的 autofill、Agent、Passkey、HTTP
  或 SSH 授权关系。
- 全局分类列表、搜索和既有浏览器自动填充继续直接访问原 item。服务地址不得扩大 Login URI match、Passkey RP、
  Secret website、SSH target 或 Browser assignment 的允许范围。

## 非目标

- 不把 Login、Secret、SSH 或 Passkey 序列化为一个万能 item。
- 不在本阶段保存 API auth、Header 或请求模板；由后续 Agent API Environment Work 负责。
- 不发送 API 请求；由后续 Agent Broker 执行 Work 负责。
- 不改变 Browser RPC、自动填充匹配、Passkey RP 归属或 Agent account discovery。
- 不加入云端账号、同步、分享、团队 workspace、服务图标联网抓取或第三方服务目录。
- 不读取 password、Token、TOTP、恢复码、私钥、自定义 protected field 或页面字段值来做聚类。
- 不从现有 Secret 自动推断 auth method 或 Header，也不自动创建会进入 Agent 安全目录的 API Environment。

## 影响范围

- Core/payload：新增 encrypted service record、类型化关联、trash/history 和原子 mutation。
- Core：新增 safe-metadata service-key derivation、confidence、deterministic bulk plan、idempotent apply 和冲突分类。
- Desktop typed API：新增 renderer-safe service summary/detail 与显式 link/unlink operation；DTO 不包含关联 item 的
  受保护字段。
- Desktop UI：新增自动整理预览、总体计数、批量应用、待确认/未分组、merge/split/move/ignore，以及按网站/服务浏览；
  原有 item 分类入口保留。
- Browser/extension：本阶段无 RPC 或 UI 行为变化；现有 exact assignment 与 origin 校验必须回归通过。
- Vault format：新增 collection/field 前必须完成旧 writer 丢字段和 downgrade/refusal 评估。
- 安全：聚合关系是导航 metadata，不构成 credential、target、permission 或自动填充授权。
- 依赖与发布：automatic rule v1 不规范化 registrable domain，不引入 Public Suffix List/library 或联网查询；
  macOS/Windows packaged desktop 需要 1000 条级别性能、批量纠错和锁定清理验收。

## 实现约束

- `vault-core` 是 service record、relationship validation、trash/history 和原子 mutation 的唯一所有者；renderer 不得
  拼接或直接持久化关系。
- 聚合器只能读取 renderer-safe item metadata 中已经允许使用的 title、URI/website、SSH host、Passkey RP/既有关联和
  item kind；不得请求或解密受保护值。扫描、计划和应用均在本地，不查询远端品牌、图标或域名服务。
- 每个候选必须派生版本化 `serviceKey` 与 confidence reason。建议基线：exact canonical host/origin 和已存在显式关联为
  high；普通 registrable domain 可以 high/medium；共享托管域、IP、localhost、不同 port、跨 registrable domain、
  仅标题相似或多 URI 冲突不得无条件 high。规则版本变化不得静默重写已确认关系。
- Bulk plan 必须绑定 Vault namespace、item catalog revision、规则版本和输入 digest；preview 后 item 变化使 plan 过期并
  要求重新扫描，不能把旧计划应用到新 item 集合。
- 高置信度 apply 必须在一次 Vault mutation 中创建 Service/link 并先原子写盘；无法一次安全提交时必须使用有明确事务
  边界和补偿的有界批次，不能留下半个 cluster。重复 apply/re-run 幂等。
- 自动关系必须记录来源 `automatic:<rule-version>` 或等价 metadata，使 UI 可以解释、批量筛选和纠错；用户 merge/split/
  move/ignore 后的显式决定优先，后续扫描不得再次推翻。
- 关系必须携带 item kind 与 opaque ID，并在 link、read、restore、purge 和目标 item kind 漂移时验证；未知 kind、
  重复引用、dangling reference 和类型混淆必须稳定处理。
- 已冻结的关系基数允许一个服务关联多个 item，并允许同一 item 被多个服务引用，以覆盖 SSO、同一凭据面向多个产品
  入口等场景；如后续收敛为单一 primary service，必须建立新 Work 并记录数据迁移和冲突处理理由。
- Service summary 可以包含名称、标签、站点数量和各 item kind 的计数；不得包含 username、token、password、TOTP、
  recovery code、SSH host 或自定义 protected field。
- 服务地址必须 canonicalize，但只能用于展示、打开和生成待确认建议。任何 privileged operation 必须重新读取原 item
  自己的 URI/website/target 并按原 Requirement 授权。
- 所有 link/unlink、删除、恢复和 purge 必须遵守先原子写盘成功再发布内存状态；失败保留旧记录和旧关系。
- final lock 清除 renderer 中展开的聚合详情和临时建议；不得把关联 item detail 持久化到 UI state。
- 自动聚合错误只能影响导航视图。Browser autofill、Passkey、Agent discovery、ApiEnvironment、HTTP、SSH 和 secret use 必须
  始终重新读取原 item/显式 Environment 的权威 target，不得从 Service cluster 推导权限。

## 阶段门与决策

1. **Draft → Accepted**：冻结用户术语（“网站/服务”）、关系基数、service-key/confidence 规则、共享托管域/IP/local
   行为、批量预览/应用/纠错、删除/恢复语义、规则版本、format-3 兼容和桌面信息架构；如改变 format 或持久化所有权，
   先新增或修订 ADR。
2. **Accepted → Implementing**：把 `REQ-SERVICE-001` 合并进主规格，更新 Scope Matrix、数据模型、测试计划和
   Traceability，再开始产品代码。
3. **Implementing → Verified**：完成 Core→typed API→desktop UI 的最小垂直切片，执行自动化与 macOS/Windows
   packaged AT，写回证据并封存 Work。

已于 2026-08-04 冻结 Draft → Accepted 决策：用户术语为“网站/服务”；关系为多对多；删除 Service 不级联；
automatic rule v1 仅把非 IP/非 localhost 的 exact canonical host 作为 high confidence，且不引入 PSL/联网依赖；
不同非默认 port、跨 host、共享托管域、仅标题相似与冲突 URI 进入待确认/未分组；Service 与纠错 metadata 作为
format-3 encrypted additive collections 保存，旧开发 writer 不受支持，兼容和权限理由由 ADR-0014 拥有。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| `SERVICE-001` | `REQ-SERVICE-001` | 冻结术语、关系基数、删除语义、非目标与主规格增量 | `pnpm docs:check` | Complete（2026-08-04） |
| `SERVICE-002` | `REQ-SERVICE-001`、`NFR-COMPAT-001` | Core service model、关系 validation、format 兼容决策与恶意输入覆盖 | `CT-SERVICE-001`、`CT-COMPAT-001` | Complete（2026-08-04） |
| `SERVICE-002A` | `REQ-SERVICE-001`、`NFR-PRIV-001` | safe metadata service-key、confidence、deterministic 1000-item plan 和无 secret 扫描 | `CT-SERVICE-AUTO-001`、`CT-PRIV-001` | Complete（2026-08-04） |
| `SERVICE-003` | `REQ-RECOVERY-001`、`NFR-REL-001` | 原子 CRUD、link/unlink、trash/history、restore/purge 与失败回滚 | `CT-SERVICE-001`、`CT-RECOVERY-001`、`CT-REL-001` | Complete（2026-08-04） |
| `SERVICE-004` | `REQ-SERVICE-001`、`NFR-PRIV-001` | renderer-safe preview/apply、总体计数、待确认/未分组、merge/split/move/ignore 和锁定清理 | `CT-SERVICE-001`、`CT-SERVICE-AUTO-001`、`CT-PRIV-001` | Complete（2026-08-04） |
| `SERVICE-005` | `REQ-ITEM-001/003/005`、`REQ-PASSKEY-001` | 原 item CRUD、Passkey 归属、autofill 与 Agent target 不被关系扩大 | `CT-ITEM-001/003/005`、`CT-PASSKEY-001`、`CT-AUTOFILL-001` | Complete（2026-08-04） |
| `SERVICE-006` | `REQ-SERVICE-001` | macOS/Windows packaged desktop 完成 1000-item 自动整理、纠错、重跑、创建、导航、删除和恢复 | `AT-SERVICE-001`、`AT-SERVICE-AUTO-001` | In Progress（macOS app/DMG build 通过；macOS/Windows packaged AT 待执行） |

## 验收与证据

- Happy path：对约 1000 条混合 Login/Secret/SSH/Passkey metadata 预览并一次应用高置信度 cluster，大多数记录无需逐条处理；
  从聚合详情进入原 item 并完成既有受控操作。
- 边界：多个账号/URI/origin、共享托管域、IP/localhost/port、同 item 多服务、重复关联、仅标题相似、已删除/恢复 item、
  清空 trash、未知 kind/ID、扫描中 catalog drift 和规则版本变化。
- 安全：服务地址与 item website 不一致时不得改变 autofill、Passkey、HTTP/Agent 或 SSH target；summary/detail 无 secret。
- 失败：加密写入失败、关系验证失败、锁定中 mutation、删除/恢复中断均保留旧文件和旧 unlocked state。
- 取消/重复：预览取消不写入；重复 apply/re-run/link/unlink 幂等，不产生重复 Service/link；用户纠错决定不被后续扫描推翻。
- 纠错：批量 merge/split/move/ignore 后关系正确，源 item 与其秘密、history、target 和权限不改变；Applied batch 支持明确
  rollback 或等价批量反向操作。
- 性能：1000 条级别扫描、预览、应用和搜索有有界内存/时间，UI 保持可取消且不显示每条秘密 metadata。
- 兼容：决定并测试 format 3 additive field 或新 format 的完整策略；不得用 serde default 绕过旧 writer 风险。
- 平台：macOS/Windows packaged Tauri 验证键盘导航、搜索、详情、锁定后敏感 UI 清理和原分类回退入口。

2026-08-04 自动化证据：

- `pnpm test` 通过：Rust workspace（含 Service core/FFI/Tauri regression）、Tauri renderer `116/116`、Extension
  `228/228`；Tauri Rust 为 `206 passed / 1 ignored`，忽略项是需要本机 OpenSSH daemon 的既有测试。
- `pnpm typecheck`、`pnpm extension:build`、Tauri renderer production build 和 `git diff --check` 通过。
- Service 专项覆盖 format-3 encrypted round-trip、backup/restore、typed relationship 恶意 kind、secret canary、catalog
  drift、deterministic/idempotent apply、rollback、trash/restore/purge、持续自动关联开关和 1000 条 safe metadata 输入。
- `pnpm tauri:build` 在 macOS x86_64 生成 `VaultMesh.app` 和 `VaultMesh_0.1.0_x64.dmg`。
- `pnpm docs:check` 通过。`AT-SERVICE-001`、`AT-SERVICE-AUTO-001` 的 macOS/Windows packaged/manual 流程尚未执行，
  因此本 Work 保持 `Implementing`，不得进入 `Verified` 或封存。

## 安全与数据生命周期

Service record、关系和必要的自动来源/纠错 metadata 位于 encrypted Vault payload。Service 本身不得存储凭据值；聚合器
只读取安全 metadata，renderer 只获得计数、cluster reason 和 opaque item reference。点击关联 item 后仍由原 item 的
typed operation、re-prompt、copy/reveal、autofill、Passkey 或 Agent policy 决定是否使用秘密。未应用的 aggregation
plan 只存在于解锁期有界内存，取消、锁定、Vault 切换和退出时清除。

## 兼容与迁移

现有 format-3 item 在应用聚合前保持全部功能。用户一次确认后，可以按 deterministic high-confidence plan 批量创建
Service/link；不得改写源 item，也不得把 medium/low confidence 强制持久化。服务删除或批量 rollback 不删除子 item。
ADR-0014 已决定新增 collection/relationship/source/ignore metadata 保持 format 3 encrypted additive collections；旧开发
writer 不受支持，不提供 downgrade writer。Backup/restore 必须完整保留服务、关系、自动来源、用户纠错、trash/history，
并在失败时保持旧 Vault；对应 round-trip、backup/restore 与非当前格式 fail-closed CT 已通过。
