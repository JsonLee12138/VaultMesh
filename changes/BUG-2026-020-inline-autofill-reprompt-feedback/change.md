# 修改密码自动填充、重新验证与失败反馈

## 问题或目标

在 macOS Edge 的 `rcvps.cn/security` 修改密码弹窗中，content script 已识别保存的 Login 候选；用户点击候选后菜单关闭，但空的“原密码”字段保持未填充，页面无错误或失败反馈。第一轮修复后的现场复测证明原密码 assignment 与独立的新密码生成器各自可用，但二者没有联动：选择 Login 只填原密码，必须再次聚焦新密码并选择生成器才会填入新密码与确认密码。Expected：显式选择经 desktop revalidation 后填充当前/原密码，并在可靠的 password-change 簇中自动生成一次新密码同步填入两个空的新密码字段；失败显示可操作的非秘密状态。Actual：内联回调原先以 fire-and-forget 发送请求，所有非 `filled` 结果均被静默丢弃；需要主密码重新验证的非卡片项目未进入确认流程；成功 Login assignment 也没有触发本地生成器。

最小复现：打开包含 `old_password`、`password`、`re_password` 三个 password input 的修改密码表单，聚焦 `old_password`，选择匹配 Login。修复前候选菜单关闭而 `old_password` 仍为空。

## 预期行为

- `REQ-AUTOFILL-001`：页面加载时仍不得在 password-change context 自动披露；用户显式选择后，assignment 只允许把保存值写入已绑定且安全识别的当前/原密码空字段。成功后 content script 使用本地生成器生成一次新密码，并只同步写入同簇且仍为空的新密码/确认密码，不提交表单。
- `REQ-AUTOFILL-002`：需要 `masterPasswordReprompt` 的显式选择必须进入 popup 主密码确认，并把确认值只交给当前 desktop revalidation 请求；取消、错误、锁定、过期和页面变化必须返回非秘密可见状态。
- 不需要重新验证且成功的显式选择保持直接填充。

## 非目标

不改变字段语义分类、page-load fill、卡片确认策略、Vault/core re-prompt 规则、RPC schema、Native Host 协议或网站表单提交行为；不覆盖用户已经输入的任一新密码值。

## 影响范围

修改 Chromium MV3/Firefox MV2 共用的 extension content/background/popup 逻辑与测试。Tauri Rust broker、native host、core、Vault format、RPC/IPC/ABI、email、SSH、Passkey、依赖和发布格式无代码变化；通过既有 broker typed error 与 assignment contract 验证兼容。

## 实现约束

- `masterPasswordReprompt` 只是 renderer-safe 布尔元数据；主密码只存在于当前 popup confirmation state，并只随一次 `browser.autofill.execute` 请求传给 desktop，不进入 content script、storage、日志或错误文案。
- 内联选择必须消费后台结果；成功可以关闭菜单，失败必须显示有限状态或打开既有确认 UI，不得显示受保护值。
- confirmation token 绑定 tab/origin/page URL/item/expiry；取消或超时后不得复用。
- 保留页面加载、非空字段、document/navigation、assignment one-use 和 no-submit 现有约束。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| `BUG-2026-020-T1` | `REQ-AUTOFILL-002` | login/secret/SSH 的 re-prompt 候选进入既有 popup confirmation | `CT-AUTOFILL-002` | Completed |
| `BUG-2026-020-T2` | `REQ-AUTOFILL-001` | 内联选择消费 `filled` 与 typed failure，失败不再静默 | `CT-AUTOFILL-001` | Completed |
| `BUG-2026-020-T3` | `REQ-AUTOFILL-001` | rcvps 类修改密码表单填入当前密码，并自动生成同值的新密码/确认密码 | `CT-AUTOFILL-003`, `AT-AUTOFILL-001` | Automated Pass / AT Pending |
| `BUG-2026-020-T4` | `REQ-AUTOFILL-001` | modal focus trap 下的真实 pointer 选择保留 click，不在 focusin 时提前销毁菜单 | `CT-AUTOFILL-001`, `AT-AUTOFILL-001` | Automated Pass / AT Pending |
| `BUG-2026-020-T5` | `REQ-AUTOFILL-001` | SPA 后挂载 `role`/ARIA 字段语义时 debounce rescan，并保持 page-ready 无字段值 | `CT-AUTOFILL-001` | Completed |

## 验收与证据

- 修复前：当前安装态 Edge 已复现候选关闭、`#oldPwd:placeholder-shown === true`、页面 console 无错误；源代码证明内联回调丢弃后台结果，re-prompt 非卡片候选绕过确认。
- 第一轮 bundle 现场分层诊断：同一候选选择后 `oldPwd` 从空变为非空而两个新密码仍为空；随后独立打开本地生成器并选择一次后，新密码与确认密码均变为非空且同组写入成功。该证据证明 assignment、角色分类和生成器各自可用，剩余根因为成功 Login assignment 没有触发 password-change 生成联动。诊断结束后已刷新页面清除三个瞬态字段与 content-script 内存，未提交网站表单。
- 新联动 bundle 现场复测：DOM `click()` 激活候选时，三个字段各收到 20 次 `input` 和 1 次 `change`，最终均非空；真实 CDP pointer 按下/释放时，菜单关闭但三个字段事件数均为 0。安全事件轨迹为候选 host `pointerdown` → 网站 modal 内部 `focusin` → 菜单 `display:none` → `pointerup` 落到下层 form，证明 Bootstrap modal focus trap 在 React `click` 前把扩展 shadow 菜单焦点拉回网页并触发销毁。这是用户物理点击“没有任何效果”的直接根因。
- 修复后必须通过 extension typecheck/test、Chrome MV3 与 Firefox MV2 build，并运行相关 Tauri/browser contract 测试。
- macOS 外部 Chromium AT：重新加载修复 bundle 后，普通 Login 显式选择填入原密码，并自动生成同值的新密码与确认密码；re-prompt Login 先显示主密码确认，正确确认后执行相同联动；任一新密码字段预先非空时不得覆盖；取消/错误不填充且有反馈；不点击网站“确定”。

自动化证据（2026-08-15）：

- `pnpm --filter @vaultmesh/browser-extension typecheck`：Pass。
- `pnpm extension:test`：Pass，39 个文件、240 个测试；新增自动生成联动、两个新密码同步、已有新密码不覆盖、生成结果绑定原 Login capture，以及 pointerdown 保留页面焦点后 click 仍执行的回归。
- `pnpm --filter @vaultmesh/browser-extension build`：Pass（Chrome MV3）。
- `pnpm --filter @vaultmesh/browser-extension build:firefox`：Pass（Firefox MV2）。
- `pnpm verify:browser-parity`：Pass，2 个文件、6 个测试。
- `cargo test -p vaultmesh-tauri-desktop browser_fill -- --nocapture`：Pass，3 个相关测试。
- `pnpm docs:check`：Pass，包含 Work routing、Requirement/Test ID 与封存一致性检查。
- `git diff --check`：Pass。
- `VAULTMESH_EXTENSION_DISTRIBUTION=sideload-review pnpm extension:release:zip:all`：Pass；含 pointer/modal 修复的 Chrome/Edge ZIP SHA-256 `2efdb72333771e6f2b51edfae918825b04f7aaff0781e5988b2e3fc7a6fe44f7`，Firefox ZIP SHA-256 `5f352a8e6d49fc7c40c0e24668be51e40c835cedca0af4b0b7ccddaee315d0ca`。
- 外部 macOS Edge `AT-AUTOFILL-001`：Pending；当前 Edge 进程仍加载构建前的 unpacked extension，需要人工点击 Reload 后执行无提交、无字段值读取的现场复测。
- 自动化证据（2026-09-09）：动态登录表单补充 `aria-label` 后，content script 在 150 ms debounce 后再次发送无值 `vaultmesh.autofill-page-ready`；`pnpm --filter @vaultmesh/browser-extension test -- autofill-page.test.ts` 通过（39 files / 241 tests），`pnpm --filter @vaultmesh/browser-extension typecheck` 通过。观察属性仅覆盖 discovery 实际读取的语义/可见性元数据，明确不包含字段 `value`。

## 安全与数据生命周期

保存的 Login 密码仍只由 core/Tauri broker 读取并以短时 assignment 交给目标 content script。主密码只在 popup 内存和一次 authenticated RPC request 中存在，popup 关闭、取消、锁定、断开、失败、成功或 60 秒 confirmation expiry 后清除。不得记录主密码、Login 密码、字段值或 assignment value。

## 兼容与迁移

Vault format/payload、RPC/IPC/ABI、settings、pairing、upgrade 和 downgrade 无变化；回滚只恢复旧 extension bundle，无数据迁移或不可逆影响。

## Bug 根因（仅 type=bug）

`autofill-page.ts` 的候选回调使用 `void sendMessage(...)`，未消费后台 typed result；同时 background 和 popup 仅按 `card` 判断是否需要主密码确认，忽略候选的 `masterPasswordReprompt`。因此 desktop 返回的 `re-prompt-required` 或其他 typed failure 对页面完全不可见。成功 Login assignment 与 `fillGeneratedPassword` 也分别由两次独立 UI 操作触发，没有 password-change 联动。进一步的真实 pointer 现场轨迹证明，菜单按钮的 pointer 默认聚焦会被网站 modal focus trap 重定向到网页，扩展 `focusin` 因而在 `click` 前隐藏并卸载 React 菜单。既有测试只调用 DOM `click()`，没有覆盖 pointerdown 默认聚焦与 modal focus trap。受影响版本为 `0.0.8-review`；修复版本待发布。
