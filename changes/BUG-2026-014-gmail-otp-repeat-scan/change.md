# Gmail 首次成功后无法继续识别验证码

- Work ID：`BUG-2026-014-gmail-otp-repeat-scan`
- 类型：Bug
- 状态：Implementing
- Requirement：`REQ-EMAIL-001`、`REQ-EMAIL-002`

## 问题或目标

在 macOS Tauri development app 中连接 Gmail、成功识别第一封测试验证码后，后续新验证码邮件已到达 Gmail，但后台监听和“立即扫描”均返回“最近邮件中没有找到验证码”。关闭 `onlyUnreadMessages` 后仍可复现。预期每封位于配置时间窗内、包含受支持数字验证码语义的 Gmail 邮件都能形成短时候选；实际只有满足理想化测试 MIME/文案的邮件可识别，失败邮件还会在提取前进入 runtime dedup，当前解锁会话不再重试。

## 预期行为

保持 `REQ-EMAIL-001/002` 不变：Gmail 只读扫描必须按分钟时间窗读取完整的有界 MIME 文本；常见中英文 code/登录代码文案必须可识别；没有提取到候选的邮件不得被永久当作已成功消费。

## 非目标

不新增邮箱权限；本 Bug 不支持字母数字验证码，该后续行为增量由 `CHG-2026-015` 拥有。不改变 domain matching、候选过期或通知策略，不修改 Vault format、公共 typed operation、Browser RPC、IPC 或 ABI。

## 影响范围

仅修改 Rust-owned Email OTP service 及其 `CT-EMAIL-001/002` 测试。Provider credential、邮件正文和验证码继续只存在于有界内存；renderer DTO、日志和持久化边界不变。

## 实现约束

- Gmail 查询必须使用真正的分钟 cutoff，并在本地以 `internalDate` 再次校验。
- Gmail MIME 必须在大小上限内解码 padded/unpadded Base64URL，并复用 MIME parser 处理 multipart、charset 和 transfer encoding。
- 只收集 inline text MIME part，不把附件内容加入验证码识别。
- 候选 dedup 保持按 account/message/code；没有提取到 code 的邮件允许后续扫描重试。
- 失败、锁定、过期和 secret 清理语义保持现状。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| GOR-010 | REQ-EMAIL-001 | Gmail 精确时间查询和有界 MIME 解析 | CT-EMAIL-001 | Done |
| GOR-020 | REQ-EMAIL-002 | 常见验证码文案与失败后重试安全 | CT-EMAIL-002 | Done |
| GOR-030 | REQ-EMAIL-001/002 | 自动化与真实 Gmail 回归证据 | CT-EMAIL-001/002、AT-EMAIL-001/002 | In Progress（automated Pass；live AT Pending） |

## 验收与证据

- 修复前：本机 `onlyUnreadMessages=false` 仍出现首封成功、后续邮件无法识别；代码级复现覆盖常见 `Your code`/登录代码、multipart/quoted-printable、padded Base64URL、失败后同 message 重试和分钟 cutoff。
- 修复后：上述回归测试通过，并运行 Tauri Rust Email OTP tests、Clippy、fmt、typecheck 和 docs check。
- 真实 Gmail `AT-EMAIL-001/002` 仍需使用不记录邮件正文或验证码的 packaged/manual 验收；未执行前 Work 不得标记 Verified。

| Evidence ID | 日期 | 范围 | 证据 | 结果 |
| --- | --- | --- | --- | --- |
| EVID-GOR-001 | 2026-07-23 | GOR-010/020 automated；macOS 14.8.7 x86_64 | Gmail 查询改用 epoch `after:` 并以 `internalDate` 复核分钟 cutoff；`format=raw` 在 1 MiB 输入/512 KiB 文本上限内交给 `mailparse` 处理 multipart、charset、quoted-printable，跳过 attachment；兼容 padded/unpadded Base64URL。候选识别覆盖常见中英文 code 文案、HTML numeric entity、负例和同 message 首次无候选后的重试。`cargo test -p vaultmesh-tauri-desktop email_otp::tests --lib` 7/7；`cargo test -p vaultmesh-tauri-desktop --lib` 41/41；renderer 16 files/57 tests；`cargo clippy -p vaultmesh-tauri-desktop --all-targets --no-deps -- -D warnings`、`cargo fmt --all -- --check`、`pnpm tauri:typecheck`、`pnpm docs:check` Pass。`pnpm tauri:build` 生成 macOS `.app` 与 12,723,095-byte x64 DMG，DMG SHA-256 `c8a4e9ecf107767053bb411727270e508ac7847703ee040bb535a12df267abf7`，`hdiutil verify` Pass | `CT-EMAIL-001/002` 与 production bundle Pass；真实 Gmail `AT-EMAIL-001/002` Pending，Work 保持 Implementing |

## 安全与数据生命周期

OAuth token 继续只存于 encrypted account record；邮件 raw/MIME text 和 OTP 只在 Rust service 有界内存中处理，不进入日志、测试快照、renderer storage 或非秘密 settings。锁定和过期清理保持不变。

## 兼容与迁移

无。已有 account、OAuth credential 和非秘密 settings 原样兼容；回滚到旧版本不需要数据转换，但会重新暴露识别缺陷。

## Bug 根因（仅 type=bug）

Gmail 实现把“分钟”错误编码为 Gmail `newer_than:<n>m`（其中 `m` 是月），只解析理想化 inline unpadded Base64URL body，验证码上下文词过窄，并在提取前把 message ID 写入 `seen`。既有测试只使用单一 `verification code` inline payload，没有真实 Gmail MIME、常见文案、失败重试或精确 cutoff 样本。受影响版本为 `0.1.0-development`；修复版本待 Release 确定。
