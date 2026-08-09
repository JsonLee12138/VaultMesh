# Native ABI v1 contract design

- Work ID：`CHG-2026-002-native-desktop-migration`
- Task：`NDM-010`
- Requirements：`NFR-COMPAT-001`、`NFR-PRIV-001`
- Tests：`CT-NATIVE-ABI-001`、`CT-NATIVE-MEMORY-001`
- 状态：Frozen 2026-07-22

本文只记录 Native ABI v1 的实现设计。用户可观察行为继续由关联 Requirement
和 `../../specs/native-desktop-migration.md` 所有。

## 边界表示

- ABI v1 只导出 `extern "C"` operation，不导出 Rust struct layout、trait object、
  `Vec`、`String`、enum discriminant 或内部 session pointer。
- ABI version 和 status 使用固定宽度 `uint32_t`。除
  `vaultmesh_abi_version()` 外，每个业务 operation 必须接收并校验调用方 ABI
  version；不匹配时 fail closed 为 `VAULTMESH_STATUS_INCOMPATIBLE_ABI`。
- 字节长度使用 C `size_t`，Rust 对应 `usize`。输入使用 pointer + length 的
  borrowed view；`length == 0` 时 pointer 可以为空，否则空 pointer 是无效参数。
- 文本输入必须是 UTF-8 bytes。ABI 层只在 operation 调用期间借用输入，不取得
  所有权；调用方继续负责秘密输入的生命周期和清零。
- Native ABI 不返回本地化 Rust error/debug string。Swift/WinUI adapter 根据稳定
  status code 映射平台文案，避免秘密或内部实现进入日志和 crash 信息。

## 输出所有权与销毁

- Rust 返回的可变长度结果使用 `VaultmeshBuffer { data, len }`。非空 buffer 的
  allocation 唯一属于 `vault-ffi`；调用方不得 resize、reallocate 或自行 free。
- 每个成功返回的 Rust-owned buffer 必须恰好由
  `vaultmesh_buffer_destroy()` 回收。destroy 会先把调用方 struct 置空，再对完整
  allocation 执行显式 zeroize，最后使用创建它的 Rust allocator 释放。
- `{NULL, 0}` 是稳定 empty 状态；destroy empty buffer 必须成功，因此取消、失败、
  lock 和 teardown 可以共享幂等 cleanup path。
- 非空未知 pointer、`{NULL, non-zero}` 和非 Rust-owned allocation 不属于合法调用
  契约。adapter 只能销毁原 operation 返回且尚未销毁的 buffer。
- 即使当前 response 被标记为非秘密，统一 destroy 仍执行 zeroize，避免 DTO
  分类变化导致调用点遗漏清理。

## 错误与 panic

- ABI v1 status 至少区分 success、invalid argument、incompatible ABI、core
  failure、locked、I/O failure 和 contained panic；后续只追加新 code，不改变既有
  code 的数值或语义。
- 所有导出 operation 必须经过同一个 `catch_unwind` boundary。Rust panic 被转换为
  `VAULTMESH_STATUS_PANIC`，不得 unwind 到 Swift、Objective-C、C++ 或 WinRT。
- failure path 必须把所有 out parameter 保持或恢复到 documented empty/null 状态，
  不得返回部分初始化 allocation 或 session。
- `vault-ffi` 不记录密码、Vault Key、protected value、原始 Vault bytes 或 Rust
  error display/debug text。

## 并发与 handle

- v1 handle 在后续 operation slice 中表现为 opaque C pointer；调用方不得解引用。
- 同一个 handle 的 operation 必须由 platform adapter 串行调用；v1 不承诺共享
  handle 的并发安全。不同 handle 是否可并行由对应 operation contract 明确。
- matching destroy 负责 lock/zeroize 后释放 handle。销毁后的 pointer 不可复用。
- 跨进程 Vault 写锁不属于本任务，由 `NDM-DEC-002` 冻结；在其完成前 native
  preview 与 Electron 不得并行写同一 Vault。

## 绑定与验证

- `crates/vault-ffi/include/vaultmesh.h` 是 ABI v1 的 C binding 入口；Rust contract
  test 校验 status 数值和 header 声明，防止手写 header 漂移。
- macOS contract probe 必须由 Xcode toolchain 的 `swiftc` 直接导入该 header、链接
  实际 `vaultmesh-ffi` dynamic library，并覆盖 version、兼容/不兼容 version、空
  buffer 重复销毁和无效参数。
- Rust tests 必须覆盖 panic containment、buffer empty state、zeroize-before-free
  helper 和 header parity。不得通过读取已释放内存证明清零。
