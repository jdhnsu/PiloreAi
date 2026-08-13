# 嵌入与 Session API

PiLore 的宿主集成以“每个学习会话创建一个 Pack Session”为基本模型。Session 封装模型、Profile、领域状态、动态工具与对话历史；宿主只需要选择 Pack、消费 `SessionEvent`、按需要保存 Snapshot。

## 选择 Pack

所有入口均从 `src/index.ts` 导入：

```ts
import {
  createCodeMentorSession,
  createEnglishMentorSession,
  createMathMentorSession,
  createPhysicsMentorSession,
  createHistoryMentorSession,
} from "./src/index.js";

const session = createMathMentorSession();
```

各工厂都支持相同的模型、Profile、快照和遥测基础配置；Code Pack 额外支持 `vfs`、`exec`、`evaluator`，English Pack 支持 `vocab`、`evaluator`，大学学科 Pack 支持 `cards`、`evaluator`。

## 最小流式接入

```ts
const session = createEnglishMentorSession();

await session.prompt("讲讲现在完成时", (event) => {
  switch (event.type) {
    case "text_delta":
      process.stdout.write(event.delta);
      break;
    case "tool_start":
      console.log(`\n工具：${event.toolName}`);
      break;
    case "error":
      console.error(event.message);
      break;
  }
});
```

不要在同一个 Session 上并发调用 `prompt()`；运行中应读取 `session.busy`，或调用 `session.abort()` 终止当前轮次。用户想手动指定教学方式时可使用 `session.setProfile("key")`，也可在输入中使用 `@key 问题`；传入 `null` 或 `@pilore` 回到自动路由。

## 模型配置

工厂默认创建内置模型集合，从 `PROVIDER`、`MODEL_ID` 和 `THINKING_LEVEL` 读取模型选择。宿主可注入测试模型或自有模型集合：

```ts
const session = createPhysicsMentorSession({
  models: myModels,
  providerId: "my-provider",
  modelId: "my-model",
  thinkingLevel: "off",
});
```

也可以用 `customModel` 临时注册一个 OpenAI Completions、OpenAI Responses 或 Anthropic Messages 兼容服务。模型注册细节见 [模型与遥测](models-and-telemetry.md)。

## Snapshot 保存与恢复

`SessionSnapshotV1` 是 JSON，可直接保存到你的存储层：

```ts
const snapshot = session.exportSnapshot();
await store.save(snapshot);

const restored = createMathMentorSession({ snapshot: await store.load() });
```

恢复会验证 Snapshot 与当前 Pack 是否兼容。生产环境如需会话并发控制、运行审计与加密，使用 `SessionStore` 语义；[持久化与 PostgreSQL](persistence.md) 提供完整流程。

## Pack 专用快捷方法

| Pack | Session 额外接口 |
| --- | --- |
| Code | `listFiles()`、`readFile(path)`、`codeState` |
| English | `listWords()`、`getWord(word)`、`englishState` |
| Math | `listMathCards()`、`getMathCard(id)`、`mathState` |
| Physics | `listPhysicsCards()`、`getPhysicsCard(id)`、`physicsState` |
| History | `listHistoryCards()`、`getHistoryCard(id)`、`historyState` |

五个 Pack 都提供 `modelInfo`，格式为 `provider/model`，适合作为运行审计元数据。

## 事件传输建议

`SessionEvent` 是纯 JSON，适合 CLI、SSE、WebSocket 或消息队列。Web Adapter 采用 SSE：每条事件编码为 `data: <JSON>\n\n`。内部工具不会作为普通工具事件透出，因此 UI 不需要渲染 `adopt_profile`、`update_profile_state` 或 `activate_toolset` 的工具卡片；它们分别映射为 `profile` 和 `toolset` 事件。

## 配置参考

| 配置 | 用途 |
| --- | --- |
| `profiles` | 覆盖默认的懒加载 Profile 集合 |
| `systemPrompt` | 覆盖 Pack 基座 Prompt |
| `snapshot` | 恢复一个已验证的会话快照 |
| `maxTurns` | 限制单次 prompt 的 Agent 回合数 |
| `fetch` | 注入模型请求 transport，便于代理或测试 |
| `llmTelemetry` | 接收脱敏的模型请求与 HTTP attempt 事件 |
| `useEnvCustomModel` | 设为 `false` 时不读取 `CUSTOM_MODEL_*` |

若要写新的领域 Pack，请从 [开发新的 Pack](pack-development.md) 开始。
