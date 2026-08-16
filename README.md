# VaultMesh

VaultMesh 是一个本地优先、单设备、源码可见的密码管理器。当前客户端是 Tauri 2 桌面端（macOS / Windows）和 Chromium MV3 扩展；Vault 的加密、格式、模型与解锁会话由共享 Rust core 统一拥有。

项目详情：[VaultMesh 产品详情页](https://blog.atlankj.com/products/vaultmesh)

> [!WARNING]
> 当前版本是 `0.0.2-review`。正式公开发布所需的独立密码学/内存审计、目标平台签名与安装验收等门禁尚未全部完成。请把源码和 review build 视为开发中软件，不要将其当作已经完成安全审计的生产密码管理器。

## 产品边界

- 本地优先，不提供账号、服务器、同步、分享或恢复后门。
- Tauri renderer 不直接拥有 filesystem、Node 或通用命令执行权限。
- 浏览器扩展是瞬态远程 UI/自动填充代理，不打开或持久化 Vault。
- 正式范围、架构和安全约束以 [`AGENTS.md`](AGENTS.md) 与 [`docs/00-spec-index.md`](docs/00-spec-index.md) 为准。

## 开发

需要 Rust stable、Node.js 和 pnpm 11.1.1，以及目标平台的 Tauri 2 系统依赖。

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
```

启动桌面开发环境：

```bash
pnpm tauri:dev
```

启动 Chromium 扩展开发环境：

```bash
pnpm extension:dev
```

开发和测试只能使用虚构凭据。不要提交真实 Vault、备份、恢复秘密、OAuth token、签名密钥或解密 fixture。

## 贡献与安全

提交改动前请阅读 [`CONTRIBUTING.md`](CONTRIBUTING.md)。安全问题不要创建公开 Issue；请按 [`SECURITY.md`](SECURITY.md) 使用 GitHub 私密漏洞报告。

## 许可证

当前版本中由授权方拥有或有权许可的 VaultMesh 源代码按 [PolyForm Noncommercial License 1.0.0](LICENSE) 提供，SPDX 标识为 `PolyForm-Noncommercial-1.0.0`，仅允许该许可证定义的非商业用途。本项目是 source-available 软件，不是 OSI 认可的开源软件。

商业使用需要另行取得书面授权，联系 `atlantis-mk <atlanxg@gmail.com>`。完整边界、历史 AGPL 授权和第三方材料说明见 [`LICENSING.md`](LICENSING.md)，商业授权入口见 [`COMMERCIAL-LICENSE.md`](COMMERCIAL-LICENSE.md)。

Required Notice: Copyright 2026 atlantis-mk <atlanxg@gmail.com>
