# Core

Core 是 PiLore 的领域无关运行层。它不包含任何学科 Prompt、具体工具、数据库或 UI；这些由 Pack、Infrastructure 和 Adapter 负责。本章对应 `src/core/`，公共类型由 `src/index.ts` 再导出。

## 核心类型

```ts
interface DomainPack {
  id: string;
  basePrompt?: string;
  router?: RouterConfig;
  toolManifest?: ToolManifest;
  snapshotExtension?: SnapshotExtension;
}

interface RuntimeConfig {
  model: Model<string>;
  models: MutableModels;
  thinkingLevel?: ThinkingLevel;
  systemPrompt?: string;
  tools?: AgentTool<any>[];
  domain?: DomainPack;
  maxTurns?: number;
  fetch?: typeof globalThis.fetch;
  llmTelemetry?: LlmTelemetrySink;
}
```

`DomainPack` 是 Core 与领域的唯一协作边界：它提供基础 Prompt、Profile 路由、动态工具清单和领域快照扩展。没有 `domain` 时，`createSession()` 仍可作为普通 Agent Session 使用。

## Runtime

`createRuntime(config)` 创建 `@earendil-works/pi-agent-core` 的 `Agent` 与 `CoreState`。它负责：

- 以 `systemPrompt ?? domain.basePrompt` 初始化 Agent。
- 将 `models.streamSimple` 包装为可选的遥测 stream function。
- 注册内部工具：有 Router 时注册 `adopt_profile` 与可选的 `update_profile_state`；有 Manifest 时注册 `activate_toolset`。
- 每回合根据已激活的 Tool Group 刷新 `agent.state.tools`。
- 在每次工具调用前根据当前 Profile 的 capability deny-list 拦截操作。
- 以 `maxTurns` 限制单次 `prompt()` 最多可运行的 LLM 回合数；未设置则不限制。

`Runtime.refreshTools()` 主要供 Session 恢复 Snapshot 后使用。通常 Pack 或 Adapter 不需要直接调用它。

## Session API

`createSession(config)` 在 Runtime 之上提供适合产品接入的单会话接口：

```ts
interface Session {
  prompt(text: string, onEvent: (event: SessionEvent) => void): Promise<void>;
  abort(): void;
  setProfile(key: string | null): void;
  exportSnapshot(): SessionSnapshotV1;
  readonly busy: boolean;
  readonly profile: string | null;
  readonly runtime: Runtime;
}
```

### 生命周期

1. `prompt()` 拒绝并发运行；若 `busy` 为真会抛出错误。
2. 若 Router 支持 `parseMention()`，如 `@feynman 问题` 会在调用模型前切换 Profile 并只将“问题”部分发给 Agent。
3. Session 先发出 `{ type: "start" }`，随后将 Agent 的文字、工具和消息结束事件映射为 `SessionEvent`。
4. Agent 成功、被中止或发生错误后都发出 `{ type: "done" }`；出错时还会先发出 `{ type: "error" }`。
5. `abort()` 仅中止当前 Agent 运行；Adapter 若已持久化了运行占用，需要负责调用 `SessionStore.failRun()`。

### SessionEvent

| 事件 | 含义 |
| --- | --- |
| `start` | 本轮已被接受 |
| `text_delta` | 助手流式文本片段 |
| `message_end` | 一条 Agent 消息结束 |
| `tool_start` / `tool_end` | Pack 或注入工具的执行状态；内部工具不会透出 |
| `profile` | 用户或模型切换了 Profile |
| `toolset` | Tool Group 被激活 |
| `error` | 本轮出错信息 |
| `done` | 本轮收束，可能携带 `errorMessage` |

## Profile Router

Profile 是一组可选择的教学方法。`ProfileDefinition` 包含稳定的 `key`、显示名、用于路由的 `description`、仅激活后注入的 `methodology`，以及可选 capability deny-list。

```ts
interface ProfileDefinition {
  key: string;
  name: string;
  description: string;
  methodology: string;
  capabilities?: Record<string, "allow" | "deny">;
}
```

Router 的关键安全与上下文行为：

- 基座 Prompt 只保留 Profile 目录（名称和描述）；完整方法论不常驻 system prompt。
- 用户通过 `setProfile()` 或 `@key` 选择 Profile 时，Session 在消息历史写入一个内部 `piloreProfileContext`。
- 模型通过内部 `adopt_profile` 工具切换时，工具结果携带渲染后的可信上下文；下一条用户消息会与其合并后传给 LLM。
- `convertProfileMessages()` 仅在紧邻用户消息时把内部上下文转换为 LLM 消息，不把内部消息原样暴露给模型。
- 每轮 Profile 切换数默认至多 2 次；Pack 可通过 `maxSwitchesPerTurn` 调整。

`update_profile_state` 只有当 Pack 提供 `RouterConfig.updateProfileState()` 时才注册。它只允许更新当前激活 Profile 的领域进度。

## 动态 Tool Runtime

Pack 不应把全部工具常驻提供给模型。它通过 `ToolManifest.groups` 划分 Tool Group：

```ts
interface ToolGroup {
  key: string;
  description: string;
  eager?: boolean;
  load(): AgentTool<any>[];
}

interface ToolManifest {
  groups: ToolGroup[];
  resolveCapability(toolName: string, args: unknown): string | undefined;
}
```

模型先调用内部 `activate_toolset({ toolset })`；Core 将该 Group 标记为激活并刷新 Agent 工具列表。`eager: true` 的组会从会话开始就加载。Manifest 在 Runtime 创建时验证：Tool Group key 与具体工具名都不能重复。

`resolveCapability()` 将具体工具调用映射为稳定 capability，例如 Code Pack 的 `run_code → exec.run`。当当前 Profile 对该 capability 声明 `deny` 时，Core 会在工具真正执行前阻止调用。

## Snapshot V1

```ts
interface SessionSnapshotV1 {
  version: 1;
  revision: number;
  activeProfileKey: string | null;
  activeToolsetKeys: string[];
  messages: unknown[];
  extensions: Record<string, JsonValue>;
}
```

`exportSnapshot()` 产生深拷贝 JSON。恢复时 `validateCoreSnapshot()` 会校验版本、revision、Profile key、Tool Group key、消息数组和 extension；随后 Session 恢复工具组、Profile、Agent 历史和领域 extension 状态。

`SnapshotExtension` 由 Pack 实现：

```ts
interface SnapshotExtension<T extends JsonValue = JsonValue> {
  key: string;
  export(): T;
  validate(value: unknown): T;
  restore(value: T): void;
  migrate?(value: unknown, version: number): T;
}
```

当前 Core V1 不调用 `migrate()`；要引入跨版本迁移时，应先定义新的 Core Snapshot 版本与兼容策略。

## 嵌入示例

```ts
import { createSession } from "./src/index.js";

const session = createSession({
  model,
  models,
  systemPrompt: "你是一位简洁的助手。",
  tools: [myTool],
});

await session.prompt("你好", (event) => {
  if (event.type === "text_delta") process.stdout.write(event.delta);
});
```

完整的 Pack 入口和持久化做法分别见 [嵌入与 Session API](embedding.md) 与 [持久化与 PostgreSQL](persistence.md)。
