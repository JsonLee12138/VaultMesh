# 贡献指南

感谢你参与 VaultMesh。这个项目处理高价值秘密，代码正确性、权限边界和可验证性优先于功能数量。

## 开始之前

1. 阅读 [`AGENTS.md`](AGENTS.md) 和 [`docs/00-spec-index.md`](docs/00-spec-index.md)。它们定义当前产品范围、架构所有权、Change 流程和完成门禁。
2. 对安全边界、格式、公共契约、依赖、许可、迁移或发布产生影响的改动，先创建或复用 Work Package；局部且可回滚的既有行为修复可以按 `AGENTS.md` 的直接修改规则处理。
3. 新功能在对应 Change 进入 `Accepted` 前不得修改产品代码。不要自行提升 Future/Out of scope 能力。
4. Issue、测试、日志和截图中都不得包含真实凭据、Vault、备份、恢复材料、OAuth token、私钥或受保护字段。

## 本地验证

```bash
pnpm install --frozen-lockfile
pnpm docs:check
pnpm scripts:test
pnpm test
pnpm typecheck
```

只运行与改动相关的较小测试集也可以用于开发迭代，但 Pull Request 必须说明最终运行了哪些命令、哪些目标平台验收不适用或仍待完成。不得删除测试、降低断言或修改 fixture 来隐藏问题。

## Pull Request

- 保持改动聚焦，说明问题、行为、非目标、风险和验证证据。
- 关联适用的 Work ID、Requirement ID 和 Test ID。
- 涉及 UI 时提供无秘密的截图或录屏；涉及平台能力时说明 OS、架构和安装形态。
- 失败、取消、重复、锁定、过期、回滚和兼容路径必须实现或明确说明为何不适用。
- `Verified` Work 必须在同一任务封存；合并本身不代表已验证或已发布。

## 贡献许可

提交贡献即表示你有权提交该内容，并同意该贡献按照仓库当前的 `PolyForm-Noncommercial-1.0.0` 许可证提供。第三方代码或资产必须保留来源、版权和兼容许可证信息；不要提交来源或授权不清晰的材料。

公开 Pull Request 不会自动把贡献的商业再许可权或版权转让给 `atlantis-mk`。若项目计划在商业授权版本中包含非平凡的第三方贡献，维护者必须在合并前取得贡献者另行签署的书面贡献协议；没有该协议时，不得宣称项目商业许可覆盖该贡献。
