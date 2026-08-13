# 架构总览

PiLore 以一个 Session 对应一个主 Domain Pack 为边界。Core 不理解“编程”“英语”或任何具体学科；它只负责将模型、消息、Profile、工具、快照和事件组织成稳定的运行时。Pack 把领域能力注入 Core，Infrastructure 为 Pack 和 Adapter 提供模型、遥测、持久化，Adapter 再对用户或宿主应用暴露产品接口。

## 分层与依赖方向

```text
src/core/                 通用 Runtime / Session / Router / Tool Runtime / Snapshot / Events
src/packs/                教学领域 Pack；每个 Session 只装载一个
src/infrastructure/       模型注册、请求遥测、内存与 PostgreSQL 持久化
src/adapters/cli/         终端交互入口
src/adapters/web/         HTTP + SSE + 静态 Web 入口
src/index.ts              唯一公共 API
```

这是依赖约束，而不只是目录习惯。各层的 import 边界（"可以依赖谁"）如下：

| 层 | 允许依赖 | 禁止依赖 |
| --- | --- | --- |
| `core/` | `@earendil-works/*`、Node 内置、`infrastructure/telemetry`（遥测 streamFn 包装属 Runtime 机制，受控例外，见下） | Pack、VFS、`ExecClient`、领域术语 |
| `packs/` | `core/`、`infrastructure/models`、`infrastructure/telemetry`（仅类型）；大学学科 Pack 可共享 `packs/shared/academic/` | Adapter |
| `infrastructure/` | `@earendil-works/*`、Node 内置、`pg`、`core/types` 与 `core/snapshot`（供持久化使用） | Pack |
| `adapters/` | `src/index.ts`（唯一公开入口）；web 的 faux demo 另可引用 `mock/exec-server.ts` | 绕过入口的深层导入 |

另有两条通用约束：

- 默认 Profile 只在创建 Pack 时从磁盘懒加载；模块 import 不能读取环境变量、扫描磁盘或发网络请求。
- 越层导入目前靠 code review 把关；`tests/unit/core.test.ts` 已自动覆盖 `core` 不导入 Pack / VFS / `ExecClient` 的核心约束。

### core ↔ infrastructure 的受控交叉

目录分四层，但模块层面存在两处跨层依赖，是当前实现的受控例外，不是分层错误：

1. `core/runtime` 运行时导入 `infrastructure/telemetry` 的 `createObservedStreamFn`（`core/types.ts` 另有 `LlmTelemetrySink` 的类型导入）。理由：遥测包装是 Agent 运行的机制，而非产品设施。目标状态：把 streamFn 契约与包装下沉到 `core`，`infrastructure/telemetry` 只保留实现与 sink 类型；届时上表 `core/` 行可收紧为只允许 `@earendil-works/*` 与 Node 内置。
2. `infrastructure/persistence` 使用 `core` 的快照设施——`persistence.ts` 类型导入 `core/types` 的 `SessionSnapshot`，`memory-store.ts` 运行时导入 `core/snapshot` 的 `cloneCoreSnapshot` 做深拷贝。该方向与"上层依赖下层"一致，无需消除；若未来希望 `infrastructure` 完全独立于 `core`，可把快照克隆工具下沉为共享模块。

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
