# 模型与遥测

模型能力位于 `src/infrastructure/models/`，请求观测位于 `src/infrastructure/telemetry/`。两者均通过 `src/index.ts` 导出，且只在创建 Mentor / Runtime 时解析环境配置；import 本身不读环境变量或发网络请求。

## 内置 Provider

`createModelCollection()` 创建 `MutableModels`，并按注册表顺序注册：DeepSeek、Moonshot CN、LongCat、Ollama。第一个 Provider 是默认值，因此当前未设置 `PROVIDER` 时选择 DeepSeek。每个 Provider 的默认模型由 `DEFAULT_MODEL_IDS` 给出。

```ts
import {
  createModelCollection,
  DEFAULT_MODEL_IDS,
  resolveProviderId,
} from "./src/index.js";

const models = createModelCollection();
const providerId = resolveProviderId();
const model = models.getModel(providerId, DEFAULT_MODEL_IDS[providerId]);
```

Pack 工厂按以下优先级选择模型：显式 `config.model`、显式或环境解析的 `customModel`、`config.providerId` / `config.modelId`、环境 `PROVIDER` / `MODEL_ID`、注册表默认值。找不到目标模型时工厂会抛出错误。

## 自定义模型

`CustomModelConfig` 支持三种流式协议：`openai-completions`、`openai-responses`、`anthropic-messages`。

```ts
const session = createHistoryMentorSession({
  customModel: {
    url: "http://127.0.0.1:11434/v1",
    protocol: "openai-completions",
    id: "my-local-model",
    apiKey: process.env.LOCAL_MODEL_API_KEY,
  },
});
```

等价环境变量为 `CUSTOM_MODEL_URL`、`CUSTOM_MODEL_PROTOCOL`、`CUSTOM_MODEL_ID`，可选 `CUSTOM_MODEL_PROVIDER_ID`、`CUSTOM_MODEL_API_KEY`。三项必填变量只要部分存在就会报错；设置 `useEnvCustomModel: false` 可禁止工厂读取它们。

自定义 URL 必须是没有账号、查询参数或片段的 `http:` / `https:` base URL。注册时不能覆盖已有 Provider id。

## 新增内置 Provider

新增 Provider 的最小步骤：

1. 在 `src/infrastructure/models/providers/` 实现 `ProviderDefinition`；
2. 在 `registry.ts` 的 `PROVIDERS` 追加定义；顺序会影响默认 Provider；
3. 提供稳定 id、默认模型 id、文档 URL、认证说明和 `register(models)`；
4. 更新 README / 本文档和必要测试。

不要在 Provider 模块顶层解析密钥或网络探测。认证应在 pi-ai Provider 实际请求时处理。

## 遥测

把 `llmTelemetry` 传给任一 Mentor 工厂或 `createRuntime()`，即可订阅 `LlmTelemetryEvent`：

```ts
const session = createMathMentorSession({
  llmTelemetry: {
    onEvent(event) {
      console.log(event.type, event.logicalRequestId);
    },
  },
});
```

事件分为两层：

| 事件 | 含义 |
| --- | --- |
| `logical_request_start` | 一次模型逻辑调用开始，含 provider/model、Profile key、Prompt 指纹与消息前缀复用长度 |
| `http_attempt_start/end/error` | 该逻辑调用的每一次底层 HTTP 尝试，含脱敏 endpoint、载荷 hash/字节数、状态和耗时 |
| `logical_request_end` | 模型流结束，含 stop reason、usage、总耗时和成功 HTTP 请求 id |

遥测不会保存原始 Prompt、工具 schema、消息或 HTTP body；它只发送 SHA-256 指纹、payload 长度和去除查询参数后的 `origin + pathname`。Sink 抛出的异常会被吞掉，不能影响教学请求。注入 `fetch` 时，遥测包装该 transport，适用于代理、测试和可观测性平台。

`logical_request_start.commonPrefixMessages` 通过相邻调用的消息 hash 比较得到，可用于估计上下文前缀复用；它不是模型 Provider 返回的缓存命中率。
