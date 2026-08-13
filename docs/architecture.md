# 架构总览

PiLore 以一个 Session 对应一个主 Domain Pack 为边界。Core 不理解“编程”“英语”或任何具体学科；它只负责将模型、消息、Profile、工具、快照和事件组织成稳定的运行时。Pack 把领域能力注入 Core，Infrastructure 为 Pack 和 Adapter 提供模型、遥测、持久化，Adapter 再对用户或宿主应用暴露产品接口。

## 分层与依赖方向

```text
core/ → packs/ → infrastructure/ → adapters/

src/core/                 通用 Runtime / Session / Router / Tool Runtime / Snapshot / Events
src/packs/                教学领域 Pack；每个 Session 只装载一个
src/infrastructure/       模型注册、请求遥测、内存与 PostgreSQL 持久化
src/adapters/cli/         终端交互入口
src/adapters/web/         HTTP + SSE + 静态 Web 入口
src/index.ts              唯一公共 API
```

这是依赖约束，而不只是目录习惯：

- `core` 不得导入任何 Pack、VFS、`ExecClient` 或领域术语。
- Pack 可以依赖 Core 类型和运行时，但不依赖 Adapter。
- Adapter 只能通过 `src/index.ts` 消费公共 API，不能绕过入口深层导入 Pack 或 Infrastructure。
- 默认 Profile 只在创建 Pack 时从磁盘懒加载；模块 import 不能读取环境变量、扫描磁盘或发网络请求。

## 一次对话的数据流

```text
CLI / Web / 宿主应用
        │ session.prompt(text, onEvent)
        ▼
Session
  ├─ 解析 @profile 提及并写入可信 Profile Context
  ├─ 管理 busy、取消、Snapshot 导出与事件映射
  ▼
Runtime + CoreState
  ├─ 动态构建已激活工具组
  ├─ 在工具调用前执行 capability deny-list
  └─ 将 Profile Context 转换为 LLM 可见消息
        ▼
pi-agent-core Agent ── streamFn ── 模型 Provider
        │                         │
        ├─ 内部工具：adopt_profile / update_profile_state / activate_toolset
        └─ Pack 工具：词汇、练习、VFS、执行、学习卡片等
        ▼
SessionEvent 流 → Adapter 渲染 / SSE → 用户
```

当 Web 持久化启用时，Adapter 在每一轮运行前调用 `SessionStore.beginRun()` 占用会话；完成后调用 `completeRun()` 原子写入新 Snapshot 与审计数据；异常时调用 `failRun()` 释放占用。详见 [持久化与 PostgreSQL](persistence.md)。

## 运行时边界

| 组件 | 责任 | 不负责 |
| --- | --- | --- |
| `Runtime` | 创建 Agent、装配内部工具、动态刷新工具、接入遥测和 capability 拦截 | 领域状态和持久化策略 |
| `Session` | 单轮生命周期、Profile 手动选择、事件映射、Snapshot 恢复/导出 | 数据库事务与用户身份 |
| `DomainPack` | Prompt、Profile Router、Tool Manifest、Snapshot Extension | HTTP、数据库连接池、UI |
| `SessionStore` | 会话/运行记录、revision 与互斥语义 | Agent 对话和 Pack 行为 |
| Adapter | 输入输出协议、身份映射、存储选择、产品 UI | 深层领域逻辑 |

## 领域状态与快照

Core Snapshot V1 固定包含：`version`、`revision`、`messages`、`activeProfileKey`、`activeToolsetKeys`、`extensions`。Core 只验证通用字段；Pack 通过一个 `SnapshotExtension` 验证并恢复 `extensions.<pack-id>`。

当前 namespace：

| Pack | Snapshot extension |
| --- | --- |
| Code | `extensions.code` |
| English | `extensions.english` |
| Math | `extensions.math` |
| Physics | `extensions.physics` |
| History | `extensions.history` |

因此一个 Snapshot 只属于创建它的 Pack；不要尝试把 `extensions.math` 的 Snapshot 恢复到 `History` Pack。Core 会拒绝未注册 extension，Pack 也会校验自己数据的形状和允许的 Profile / 工具组。

## 扩展决策

- 新教学领域：创建新的 Pack，不修改 Core 中的领域语义。
- 新教学方法：新增或调整该 Pack 的 `agent-design/profiles/*.md`。
- 新的按需能力：新增 Tool Group，并经 Manifest 映射到稳定 capability 名称。
- 外部计算、检索、仿真或判题：定义可注入接口并在 Pack 中使用，不让 Core 直接依赖服务。
- 新产品入口：创建 Adapter，通过 `src/index.ts` 创建 Session 并消费 `SessionEvent`。

具体步骤见 [开发新的 Pack](pack-development.md)。
