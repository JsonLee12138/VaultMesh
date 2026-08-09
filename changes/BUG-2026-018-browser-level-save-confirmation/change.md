# 登录跳转后由浏览器级界面确认保存

## 问题或目标

最小复现：在 Chromium 中打开 `http://10.0.0.2/login`，提交登录表单后站点整页跳转到 `/Main`。对于新增账号或密码变化，Expected：保存/更新确认可操作地显示 10 秒。Actual：挂载在登录文档中的确认 DOM 随导航立即销毁；在目标文档中恢复仍依赖 content script 注入和页面生命周期，不能保证显示，系统通知创建失败又被静默忽略。对于保险库中账号密码完全相同的提交，后台会正确返回 `unchanged`，但页面此前仍短暂显示“正在检查账号”的准备态，造成确认弹窗被跳转清理的错觉。

## 预期行为

`REQ-AUTOFILL-002` 的 Save/Ignore 确认必须由扩展后台持有生命周期。待保存候选准备完成且结果确为新增或更新后，扩展只创建一个独立的 extension popup window 并设置工具栏待处理标记；网页不得再显示第二个正常确认。该窗口不属于网页标签或 browser-action 浮层，整页导航只能聚焦既有窗口，不能销毁它。独立窗口必须紧凑铺满、锚定到提交页面所在浏览器窗口的右上角。浏览器系统通知继续作为独立入口。10 秒期限由后台统一拥有，超时按 Ignore 清理。自动捕获的后台检查阶段必须保持网页 prompt 隐藏；`unchanged` 不显示提示，账号检查失败仍可以使用网页错误提示。

## 非目标

不调用或仿冒 Chrome 内建密码管理器的保存气泡，不改变捕获字段、账号路由、Vault RPC、格式或写入确认语义。

## 影响范围

仅影响 Chromium MV3 扩展的 capture prompt、browser action、notification 和内部消息协议；desktop、native host、core、Vault format、RPC/IPC/ABI、依赖和迁移无变化。适用 GATE-4 Browser。

## 实现约束

密码和捕获内容只保留在 background 内存。popup/content script 只能收到 hostname、类型、动作、opaque capture ID 和过期时间。独立窗口不通过 URL 携带 capture ID，由 background 以 window ID 绑定。Save/Ignore、关闭、超时、重复决定和页面切换必须由后台校验并幂等清理；系统通知不可用时 independent extension window 与 badge 仍提供入口。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| `BUG-2026-018-T1` | `REQ-AUTOFILL-002` | 后台拥有 10 秒 pending 生命周期和扩展级确认入口 | `CT-AUTOFILL-002` | Completed |
| `BUG-2026-018-T2` | `REQ-AUTOFILL-002` | navigation、popup、通知失败、超时和协议回归测试 | `CT-AUTOFILL-002` | Completed |
| `BUG-2026-018-T3` | `REQ-AUTOFILL-002` | typecheck/test/build 与 local ZIP | `AT-AUTOFILL-002` | In Progress（待目标站点复测） |

## 验收与证据

- 自动化必须证明：提示元数据不含 secret；capture 请求在导航前交给后台；新文档恢复与 browser-action 使用同一 pending；后台 10 秒过期；Save/Ignore/重复/过期不写错项目。
- 平台验收：Chromium 127+，`http://10.0.0.2/login → /Main`，local unpacked/package build。实现后补命令和产物证据。
- 2026-07-25：`pnpm --filter @vaultmesh/browser-extension typecheck` 通过。
- 2026-07-25：`pnpm --filter @vaultmesh/browser-extension test` 通过，37 files / 227 tests；新增回归证明正常保存只创建独立 extension window、网页 confirmation 保持隐藏、右上角位置计算、后台 tab/origin selection、prompt metadata 与统一倒计时计算继续通过。
- 2026-07-25：`pnpm --filter @vaultmesh/browser-extension build`、`pnpm docs:check`、local keyed `wxt zip` 和 `unzip -tq` 通过；bundle 包含独立 `save-confirmation.html`；压缩布局后的 `artifacts/local/VaultMesh-browser-extension-local.zip` SHA-256 `e93268c382b01ae338a4140e2a4725e8190c352bc611ef73d77a9de6bf47432a`，固定 development extension identity 已核对。
- 2026-07-25 目标站点现场诊断：Chrome 实际加载的 `content-scripts/vaultmesh.js` SHA-256 与当前 build 完全一致，且后台支持 `vaultmesh.save-capture-window.get`，排除旧 bundle。提交保险库中已有的相同账号密码时，后台返回 `unchanged`、pending 为 `none`，因此没有待显示的保存/更新确认；使用仅驻留内存且不落盘的变化候选验证时，后台返回 `queued`/`update`，并成功创建独立 `save-confirmation.html` 窗口。由此确认本次“一闪后不显示”的直接原因是可见准备态造成误判，而不是路由清除了 pending。
- 2026-07-25：自动捕获改为隐藏准备态；`unchanged` 从提交到后台响应始终无提示，账号检查失败仍显示错误，新增/更新候选只由独立窗口承载 10 秒确认。对应回归包含在 37 files / 227 tests 中。
- 2026-07-25：修复独立确认窗口和 browser-action popup 的秒数/进度条漂移。两者不再在每次秒数重绘时改写 CSS animation duration，而是从同一次 `expiresAt` 时钟采样同时计算剩余秒数和 0–100% 进度；较晚打开时从真实剩余比例开始。网页错误反馈不再作为正常倒计时 surface。
- 2026-07-25：移除独立窗口中的“此窗口不属于网页，跳转不会关闭”倒计时说明；去掉卡片外部边距、圆角和 ring，使内容铺满；进一步把窗口压缩为 `340×150`，内容内边距减至 12px，并缩小图标、标题、按钮和区块空隙。窗口依据提交 tab 的浏览器窗口 bounds 以 8px inset 锚定右上角，bounds 不可用时由 Chromium 安全选位。
- 目标站点 AT 尚未声明通过：浏览器自动化安全策略拒绝访问扩展管理页，无法替用户重新加载新 bundle；需安装/重新加载上述 ZIP 后复测 `/login → /Main`。

## 安全与数据生命周期

secret owner 仍是 extension background；renderer-safe prompt 不含密码。pending 只在内存中存在，Save、Ignore、超时、tab close 或保存失败时清理；不进入 storage、日志、通知正文或 URL。

## 兼容与迁移

无 Vault format、RPC、settings、pairing、upgrade/downgrade 或不可逆变化。回滚可恢复原 page prompt，但会重新暴露整页导航丢失问题。

## Bug 根因（仅 type=bug）

原始生命周期缺陷是把可见确认交给被导航销毁的网页 Document；第一次补偿仍使用 browser-action popup，而该工具栏浮层也会被标签页导航立即关闭。该缺陷由 background 创建具有独立 window ID 的 extension popup window 修复：capture ready 和 top-level navigation complete 只会创建或聚焦该窗口；正常网页 confirmation 已移除，网页 DOM 仅保留错误反馈；同时由 background 统一拥有 10 秒期限、badge 和 system notification。

目标站点持续报告的“一闪后不显示”还有一个独立的直接原因：自动捕获在后台判定前先显示“正在检查账号”，而现场使用的账号密码已与保险库记录完全相同。后台正确返回 `unchanged`，从未创建 pending 或 Save/Update 窗口；准备态随后隐藏，看起来却像确认窗口被新路由清理。最终修复让自动检查保持不可见，只在后台确认 `queued` 后显示独立窗口，失败仍显示错误。既有 jsdom 测试没有区分 preparation UI 与 actionable confirmation，且此前没有用目标站点同时验证 `unchanged` 和 `update` 两条路径，因此未发现该交互误导。受影响版本为 `0.1.0-development`，修复版本待发布。

倒计时错位的根因是 React 每 200ms 更新秒数，但渲染进度条时又用新的 `Date.now()` 重写 CSS `animation-duration`；浏览器会基于不断缩短的 duration 重算动画进度，使进度条比后台 deadline 更快结束。独立窗口若在 pending 创建后才加载，还会错误地从满格开始。修复后所有确认 surface 都以后台 `expiresAt` 和统一 10 秒 lifetime 直接派生秒数、剩余比例与超时，不再把动画自身当作计时器。
