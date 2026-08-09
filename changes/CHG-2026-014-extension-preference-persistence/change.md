# 浏览器插件非秘密偏好持久化

## 问题或目标

插件生成器只有密码和用户名参数写入本地存储，短语、UUID 和最后使用的生成类型会在 popup 关闭后恢复默认值。需要同时核对插件其他设置，形成明确的持久化白名单和瞬态状态边界。

## 预期行为

`REQ-BROWSER-003` 要求用户明确选择的生成器类型与四类生成参数、插件安全策略及按 origin 记住的 Login 选择跨 popup 关闭和浏览器重启保留。桌面安全设置、PIN、生物识别与配对继续由 privileged desktop runtime 持久化；生成结果/历史、搜索/筛选、表单草稿、秘密与授权会话不得进入扩展持久化存储。

## 非目标

不持久化生成内容或编辑草稿，不把扩展偏好同步到账号或其他设备，不改变 Vault format、Browser RPC、配对或授权模型。

## 影响范围

只影响 Chromium MV3 extension 的非秘密本地偏好及其 popup/content-script 读取；desktop、native host、core、Vault format、RPC/IPC/ABI、email、SSH、Passkey、依赖和发布打包无行为变化。

## 实现约束

扩展本地设置必须经 schema 校验并在无效或不可读时回落到安全默认值。生成器使用聚合 v2 记录，继续读取并双写既有 password/username v1 key，以支持当前开发版本升级和代码回滚。持久化失败不得影响生成能力，也不得将生成值写入日志或存储。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| `TASK-CHG-014-001` | `REQ-BROWSER-003` | 完整偏好/瞬态状态清单与主规格 | `CT-BROWSER-003` | Done |
| `TASK-CHG-014-002` | `REQ-BROWSER-003` | 生成类型与四类参数统一持久化、v1 兼容 | `CT-BROWSER-003` | Done |
| `TASK-CHG-014-003` | `REQ-BROWSER-003` | Extension typecheck/test/build 与文档校验 | `CT-BROWSER-003` | Done |

## 验收与证据

- 自动化必须覆盖四类生成参数与生成类型 round-trip、旧 v1 key fallback/dual-write、非法值回退，以及既有安全策略和 origin-scoped Login 选择。
- 适用平台为 Chromium MV3；真实浏览器重启行为由当前 extension local storage contract 与 build 产物确认，本 Change 不要求发布安装签名验收。
- 定向运行 `generator-preferences.test.ts` 与 `autofill-page.test.ts`：2 files / 40 tests Pass。
- `pnpm extension:typecheck`：Pass。
- `pnpm extension:test`：30 files / 193 tests Pass，包含 generator、安全策略和 origin preference。
- `pnpm extension:build`：Chromium MV3 production build Pass；仅保留既有 chunk-size warning。
- `pnpm docs:check`：Pass（59 Markdown、29 YAML、28 requirements、66 test IDs、15 routed Changes）。

## 安全与数据生命周期

扩展 local storage 只保存布尔值、数字、枚举、短前缀和 opaque Login UUID/origin preference。生成结果、生成历史、主密码、PIN、Vault 数据、填充值、表单草稿、pending confirmation、授权 token 与 popup workspace 不新增持久化；桌面安全设置仍由 Rust runtime 的私有设置文件拥有。

## 兼容与迁移

Vault format、payload、RPC/IPC/ABI、settings ownership 和 pairing 无变化。读取优先采用聚合 v2 记录，无有效 v2 时合并既有 password/username v1 key 与新默认值；保存时双写 v2 与两个 v1 key，回滚到旧代码仍保留原有两类配置。无不可逆迁移。
