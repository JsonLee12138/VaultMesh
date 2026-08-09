# macOS 原生桌面工作流补齐

- Work ID：`CHG-2026-003-native-macos-desktop-workflows`
- 类型：Feature
- 状态：Rejected（被 `CHG-2026-004-tauri-desktop-migration` 取代；保留历史证据）
- 父迁移：`../CHG-2026-002-native-desktop-migration/`
- 接受依据：2026-07-22 用户确认继续补齐原生端缺失的导入、新增、类型筛选、安全中心和设置

## 问题或目标

当前 Native Preview 只提供 Vault lifecycle、safe item list/detail、受保护值读取和
Touch ID。Electron 已有的新增、类型筛选、导入、安全中心和设置没有进入 macOS
主窗口；Browser RPC 的 104/104 route parity 不能代表 native desktop UI parity。

本切片把这些入口连接到真实 `vault-ffi`、AppKit dialog 和平台设置，不创建静态
演示页面或无行为导航。

## 预期行为

- `REQ-NATIVE-001`：解锁后的 macOS 窗口必须提供保险库、安全中心和设置三个真实目的地；保险库支持搜索和按五类 Item 筛选。
- `REQ-ITEM-001` 至 `REQ-ITEM-005`：用户必须能从原生界面选择类型并创建对应 Item；成功写盘后刷新列表，失败不发布部分状态。
- `REQ-IMPORT-001`：导入通过 AppKit 文件选择开始，预览只显示安全计数和标题，确认、取消、过期或锁定后清除 pending session。
- `REQ-RECOVERY-001`、`REQ-VAULT-003`：安全中心提供真实密码健康、回收站/历史入口和加密备份/恢复操作；本切片至少先交付已接通且可验证的能力，不用假数据填充未接通部分。
- `REQ-SEC-002`：设置提供实际生效的自动锁定、剪贴板清理和 Touch ID 状态；敏感设置不进入普通持久化状态。

## 非目标

- 不宣称本切片完成 Email OTP、SSH 外部客户端/公钥安装或 packaged browser AT。
- 不切换默认桌面客户端，不删除 Electron，不共享 Electron Vault 目录。
- 不改变 Vault format、KDF、Browser RPC v2 或 Native ABI version。
- 不追求与 Electron 像素一致；保持 macOS 原生交互。

## 影响范围

| Surface | 影响 |
| --- | --- |
| macOS UI | 新增三目的地 shell、筛选、创建表单、导入、安全中心和设置 |
| Native adapter | 复用串行 `VaultWorker` 调用 core-owned operation；AppKit 拥有文件 dialog/backup |
| Core/FFI | 不复制业务逻辑；沿用 mutation transaction 与 commit-before-publish |
| Electron/Extension | 无行为变化，继续作为 parity reference |
| Format/RPC | 无版本变化 |

## 实现约束

- 所有 mutation 必须经当前解锁 handle 的 `vault-ffi` operation 完成。
- 主密码、导入内容和 Item secret 不进入 SwiftUI restoration、日志、错误或 snapshot。
- 普通页面只持有 safe DTO；创建表单提交或取消后立即清除 secret state。
- 文件取消、无效输入、重复提交、锁定、导入过期和写盘失败必须 fail closed。
- 原生 UI 测试必须验证 operation registry、筛选、safe preview、锁定清理和刷新行为。

## 任务

| Task | Requirement | 可验证输出 | Test | 状态 |
| --- | --- | --- | --- | --- |
| NDM-051 | REQ-NATIVE-001 | 三目的地 shell、搜索与五类筛选 | CT-NATIVE-DESKTOP-001 | Done |
| NDM-052 | REQ-ITEM-001..005, NFR-REL-001 | 五类原生创建表单与原子写盘后刷新 | CT-NATIVE-DESKTOP-001 | Done |
| NDM-053 | REQ-IMPORT-001 | AppKit file selection、安全 preview、commit/cancel/expiry | CT-NATIVE-IMPORT-001 | Done |
| NDM-054 | REQ-RECOVERY-001, REQ-VAULT-003 | 安全中心、健康、回收站恢复与加密备份/恢复 | CT-NATIVE-DESKTOP-001, AT-NATIVE-MACOS-004 | In Progress |
| NDM-055 | REQ-SEC-002 | 原生安全设置与实际 adapter policy | CT-NATIVE-DESKTOP-001, AT-NATIVE-MACOS-004 | In Progress |

## 验收与证据

自动化必须至少覆盖：筛选映射、所有创建 operation/input、mutation 后刷新、错误和
锁定拒绝、导入 preview 不含 secret、取消/过期清理、密码健康解码和设置边界。
macOS Debug/Release build、strict ad-hoc codesign 和人工 UI 验收结果记录在本节。

| Evidence ID | 日期 | 范围 | 证据 | 结果 |
| --- | --- | --- | --- | --- |
| EVID-NDW-001 | 2026-07-22 | NDM-051..055 automated slice；macOS 14.8.7 x86_64；Xcode 16.2 / Swift 6.0.3 | `CT-NATIVE-DESKTOP-001`/`CT-NATIVE-IMPORT-001` static-link contract 创建五类真实 item、验证 filter、password health、0600 settings、safe import preview、commit/expiry，并以真实 controller 验证加密 backup、错误密码不改变当前 payload、正确密码 restore；Debug/Release Xcode build 均 `BUILD SUCCEEDED`，strict ad-hoc codesign valid；Release LaunchServices 启动/退出 smoke；Rust core 24 + FFI 19 tests、Electron 34 files/171 tests、Extension 22 files/141 tests/typecheck/build、Native Host 12 tests、Browser parity 6 tests、Native 104/104 parity 和 docs check 通过 | Automated Pass；`NDM-051/052/053` Done；`AT-NATIVE-MACOS-004` Not Run，故 `NDM-054/055` 保持 In Progress |

### AT-NATIVE-MACOS-004 原生桌面工作流验收清单

使用 Native Preview 隔离 Vault 和合成秘密，不得复制 Electron 或真实 Vault：

1. 解锁后确认侧边栏只有保险库、安全中心和设置三个真实目的地；逐个切换，确认没有空壳页面。
2. 在保险库使用搜索和全部五种类型筛选；新增 login、card、identity、SSH、developer secret，确认成功后立即刷新且列表/详情不显示受保护值。
3. 分别取消一次新增和提交一次无效表单，确认没有新增记录；操作进行中重复点击不得产生重复 mutation。
4. 使用包含合成密码的 CSV/Bitwarden 导出执行选择、预览、取消和确认；预览只能出现标题/安全 metadata，成功后数量正确；锁定后旧预览不得继续提交。
5. 在安全中心核对真实密码健康分数和问题登录；删除一个合成项目后从回收站恢复；创建加密备份并用正确密码恢复，错误密码/取消不得替换当前 Vault。
6. 在设置中改变切后台锁定、休眠锁定和剪贴板 10–120 秒时限并重启，确认策略持久化且实际生效；浏览器授权仍按独立 system-lock policy 清除。
7. 检查 UI/Console/文件，确认没有主密码、导入密码、完整卡号、SSH 私钥、secret value、raw JSON 或 Vault bytes；设置文件权限为 0600。

本清单当前为 Not Run。自动化 contract、build、codesign 和 LaunchServices smoke 不替代
NSOpenPanel/NSSavePanel、真实窗口、锁定时序与人工可见 redaction 验收。

## 安全与数据生命周期

创建表单的 protected value 只在用户编辑和一次 FFI 调用期间存在；提交、取消、锁定
和 teardown 清除。导入原文与解析后的 secret 只由有界 native service session 持有，
SwiftUI 只接收安全 preview。备份保持加密 envelope。所有普通错误只映射稳定 status。

## 兼容与迁移

Vault envelope 1、Browser RPC 2 和 Native ABI 1 均不变。Native Preview 继续使用隔离
Application Support 目录；默认客户端切换和跨进程锁仍由父迁移后续门禁处理。
