# PiLore 文档

PiLore 是可嵌入的多领域教学 Agent：领域无关的 Core 处理 Agent 生命周期、Session、Profile 路由、动态工具和快照；领域 Pack 提供教学设定、学习状态和工具；Infrastructure 提供模型、遥测与持久化；Adapter 将它们交付给 CLI、Web 或宿主应用。

本文档采用与 [pi](https://github.com/earendil-works/pi) 相近的组织方式：根 README 用于快速上手，本目录按子系统提供独立、可链接的专题文档。文档描述当前仓库已实现的行为；涉及未来扩展的建议会明确标注为扩展点。

## 从这里开始

- [架构总览](architecture.md)：分层、依赖方向、一次对话的完整数据流和扩展边界。
- [模块依赖关系图（交互式）](module-graph.html)：`src/` 内部模块导入关系的力导向图，浏览器直接打开即可探索。
- [嵌入与 Session API](embedding.md)：在 Node.js 应用中创建 Pack Session、接收事件、恢复快照。
- [Core](core.md)：Runtime、Session、Profile Router、Tool Runtime、Snapshot 协议。
- [Packs](packs.md)：五个现有 Pack 的能力、状态和公共约定。
- [开发新的 Pack](pack-development.md)：从设计 Profile 到公开导出、测试与 Adapter 接入的完整步骤。
- [持久化与 PostgreSQL](persistence.md)：SessionStore 契约、并发语义、加密快照、表结构和迁移。
- [模型与遥测](models-and-telemetry.md)：Provider 注册、自定义模型与脱敏观测事件。
- [Adapters 与 HTTP API](adapters.md)：CLI、Web、SSE 和会话存储选择。
- [大学学科 Packs](academic-packs.md)：数学、物理、历史 Pack 的教学设计、卡片、练习和可选评估器。
- [测试说明](../tests/TEST-SPEC.md)：离线、PostgreSQL 与在线 Agent 测试。

## 快速导航

| 目标 | 建议阅读 |
| --- | --- |
| 将 PiLore 嵌入现有产品 | [嵌入与 Session API](embedding.md) → [Core](core.md) |
| 增加一种学习领域 | [Packs](packs.md) → [开发新的 Pack](pack-development.md) |
| 接入 PostgreSQL 或排查并发/恢复问题 | [持久化与 PostgreSQL](persistence.md) |
| 添加模型服务或接入观测平台 | [模型与遥测](models-and-telemetry.md) |
| 修改 CLI / Web 产品入口 | [Adapters 与 HTTP API](adapters.md) |

## 文档约定

- 所有公开 TypeScript API 均从 `src/index.ts` 导入；仓库外消费者不应深层导入 `src/**`。
- 示例中的 Profile、工具与数据库 schema 均以当前实现为准。
- `snapshot` 指 `SessionSnapshotV1`；它是纯 JSON，可由任意符合 `SessionStore` 的实现保存。
- Pack 内的领域状态必须只写入该 Pack 自己的 Snapshot extension namespace。
