# ADR-0009：统一风险感知 Agent 权限申请

- 状态：Accepted
- 日期：2026-07-27
- 关联 Work：`CHG-2026-021-unified-risk-aware-agent-permission`
- Supersedes：`ADR-0008` 中独立 action confirmation 与高风险逐次确认的路由部分

## 背景

当前 Agent 动作在权限申请后，高风险动作还可能打开第二个 confirmation 窗口。权限申请界面又没有直接展示风险、工具和结构化命令，用户必须在两个窗口之间重复确认。

## 决策（2026-07-27 修订）

R0 自动通过硬策略；R1–R4 使用同一个风险感知的原生权限申请界面完成显式 Allow 和 permission lease 裁决，不再创建第二个 action confirmation challenge。该界面必须显著显示风险、账号、目标、工具类型和 broker 生成的动作摘要；SSH structured command 使用等宽 Markdown code-block 风格展示。Allow 按钮按风险使用警示等级颜色，但颜色不改变授权语义。

R0 仅执行不需要账号权限的硬策略元数据动作。R1 默认推荐 safe + connection，并可选择 exact/safe/all 与 once/connection/persistent。R2/R3 可以保存 connection 或 persistent permission scope，但每次具体执行仍必须在同一权限窗口 fresh confirm，并只签发绑定当前 canonical action 的 single-use execution grant；R3 只提供 exact scope。R4 Allow 只提供 exact + once，Deny 仍可选择 once、connection 或 persistent。所有级别仍由 Rust broker 生成风险、目标、Host Key、参数 digest、scope 和 lifetime；renderer 只渲染安全摘要。

Connection lifetime 绑定真实 Agent transport，不绑定内部 15 分钟防重放 session。内部 session 轮换不得清除 connection permission；真实断连、App 重启、Vault 锁定、revoke 与 final lock 必须清除。

## 原因

将当前动作确认与 permission challenge 合并可减少重复窗口；将动作摘要由 broker 生成，可让用户看到实际执行的命令而不让 Agent 或 renderer 成为 policy owner。风险矩阵避免低风险操作反复询问，同时防止高风险的 broad/persistent permission 被误解为无需再次确认的执行授权。

## 被拒方案

- 保留第二个确认窗口：用户操作重复，同一个权限窗口已经具备完整动作上下文。
- 让 R2–R4 的 connection/persistent permission 自动执行后续动作：授权范围过宽，容易把“记住可申请范围”误解为“以后无需确认”；R2/R3 改用同窗逐次确认，R4 禁止 persistent Allow。
- 把 connection lifetime 绑定内部 15 分钟 session：会在真实 MCP 连接未断开时意外丢失用户授权。
- 让 renderer 从原始 Agent 参数自行拼命令或判断风险：会产生显示/执行不一致和潜在 secret 泄漏。
- 用按钮颜色代替 broker policy：视觉提示永远不授予权限，必须保留 typed scope、duration、target 和 deny 约束。

## 验证

由 `REQ-AGENT-010`、`REQ-AGENT-011`、`CT-AGENT-AUTHZ-002`、`CT-AGENT-AUTHZ-003` 和 `AT-AGENT-AUTHZ-002` 验证。
