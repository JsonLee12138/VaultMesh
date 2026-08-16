# 浏览器表单字段角色与场景语义识别

## 问题或目标

现有 content script 把控件附近容器文本拼接后按固定场景优先级分类。登录页同时展示“现在注册”等导航文案时，弱注册文本可能覆盖 URL、表单结构、密码字段和登录提交按钮等强信号，导致登录账号候选被替换为注册生成器。目标是改为字段角色优先、真实/伪表单作用域内聚合证据的本地确定性解析。

最小复现：HTTP(S) `/login` 页面包含一个邮件登录表单（账号、密码、“登录”提交按钮），表单附近另有“现在注册”链接。Expected：账号和密码字段均为高置信度登录场景并显示既有 Login 候选。Actual：旧解析可能把容器识别为 signup 并显示随机账号生成器。

## 预期行为

- `REQ-AUTOFILL-001`：content script 必须先在同一真实或伪表单簇内识别账号、当前密码、新密码、确认密码和 OTP 字段角色，再从结构化强信号到弱文本信号推导场景。
- 表单外或导航链接中的“注册”文案不得覆盖同一登录簇的账号、密码、login path/action 和登录提交按钮。
- 新密码生成器只能在可靠的新密码角色上出现；低置信度或冲突场景必须保守回落，不能自动披露或提交。
- 解析结果和诊断理由不得包含页面字段当前值。

## 非目标

不引入云端分类、遥测、下载规则、DOM/value 上传或第三方模型；不修改 Browser RPC、Vault format、capture 成功判定和自动提交策略。本 Work 不增加用户自定义 selector UI。

## 影响范围

仅修改 Chromium MV3/Firefox MV2 共用的 extension discovery、inline candidate/generator 决策和测试。Desktop、native host、core、Email OTP、Passkey、RPC/IPC/ABI、Vault format、依赖和发布打包结构无变化。

## 实现约束

- 角色判定顺序为显式 `autocomplete`/直接字段元数据、同簇密码结构、form action/page path/submit 语义、排除导航链接后的弱上下文。
- 每个控件只使用所属真实 form，或无法获得 form 时的最小可见伪表单容器；不得用整页文本决定局部表单。
- 填充和生成保持保守：登录候选可以在高/中置信度 login 出现，密码生成只接受可靠 new-password；OTP 的直接字段语义继续优先。
- discovery descriptor 继续无 value；无新增 storage、日志和网络生命周期。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| CHG-038-01 | REQ-AUTOFILL-001 | 字段角色、表单簇、分层评分和置信度解析器 | CT-AUTOFILL-003 | Completed |
| CHG-038-02 | REQ-AUTOFILL-001 | inline 候选与生成器按可靠语义决策 | CT-AUTOFILL-003 | Completed |
| CHG-038-03 | REQ-AUTOFILL-001 | `/login` + 外部注册链接、多表单、改密、注册、OTP 回归 | CT-AUTOFILL-003 | Completed |
| CHG-038-04 | REQ-AUTOFILL-001 | 扩展类型检查、测试、构建和文档门禁 | CT-AUTOFILL-003, AT-AUTOFILL-001 | Completed |

## 验收与证据

- 自动化必须覆盖 rcvps 类登录结构、注册链接位于表单内外、多登录方式、多真实表单、伪表单、显式 autocomplete、改密、注册、重置和 OTP。
- Chromium/Firefox 共用源码执行 `pnpm extension:typecheck`、`pnpm extension:test`、`pnpm extension:build`；`pnpm docs:check` 验证路由和追踪。
- 真实安装态 `AT-AUTOFILL-001` 仍用于最终浏览器交互验收；自动化通过但未完成安装态验收时不得把 Work 标记为 Verified。

证据（2026-08-15，macOS）：

- `pnpm extension:test`：38/38 files、230/230 tests Pass；包含 rcvps 类 action `/login?action=email`、表单内外注册链接、同页 login/signup 独立簇、诊断无字段值、OTP/改密/注册/身份/支付/capture 回归。
- `pnpm extension:typecheck` Pass；`pnpm extension:build` Chrome MV3 Pass；`pnpm --filter @vaultmesh/browser-extension build:firefox` Firefox MV2 Pass。
- `pnpm verify:browser-parity`：2/2 files、6/6 tests Pass；`pnpm docs:check` Pass。
- 本地固定身份 Chrome ZIP 和 Firefox ZIP 构建成功。当前外部 Chromium 安装态访问 `https://rcvps.cn/login`，邮箱表单 action 为 `/login?action=email`，账号/密码/“登录”位于同一 form，“现在注册”为导航 link；聚焦邮箱字段后页内菜单显示现有 `rcvps.cn` Login 候选且不显示注册生成器，Escape 正常关闭，未触发表单提交。`AT-AUTOFILL-001` 本 Work 场景 Pass。

## 安全与数据生命周期

分类只读取 DOM 标签、属性、可见性、字段顺序、form action、当前 HTTP(S) path 和非导航语义文本。字段 value 不进入分析结果、诊断理由、日志、storage 或 RPC。现有 origin/document/frame/handle/expiry/assignment 边界不变。

自动化以非空 canary 验证语义分析 JSON 不包含账号或密码值；真实验收只读取字段属性、form action、可见按钮和菜单状态，未读取或记录页面字段值。

## 兼容与迁移

无 Vault、payload、RPC、IPC、ABI、settings 或 pairing 迁移。旧版可以直接回滚；回滚仅恢复旧分类行为。

## Bug 根因（仅 type=bug）

N/A。
