# 开发新的 Pack

本指南说明如何新增一个可嵌入的教学领域 Pack。目标是把领域能力限定在 `src/packs/<id>/`，复用 Core 的 Router、Tool Runtime、Session 与 Snapshot 协议，并在不改动 Core 领域语义的前提下被 CLI、Web 或第三方宿主使用。

## 开始前的设计清单

先写清以下问题：

1. Pack 的稳定 ID 是什么？它将成为 `DomainPack.id`、Snapshot namespace 和 Web `courseId` 的一部分，发布后应避免改名。
2. 学习者要完成的能力有哪些？哪些适合靠模型讲解，哪些必须用工具或外部服务验证？
3. 需要哪些教学方法 Profile？每个 Profile 的适用范围是否能通过简短 description 区分？
4. 哪些工具是高风险或应受教学纪律约束？为它们定义 capability 名称。
5. 哪些领域状态需要跨会话保存？它必须能表示成 JSON，且只写入 `extensions.<id>`。
6. 是否真的需要执行、检索、仿真或评估后端？若需要，先和产品方确认部署、数据、认证、超时和降级策略。

## 1. 建立目录与 Profile

创建 `src/packs/<id>/agent-design/profiles/`。Profile 文件使用现有 frontmatter 格式：

```md
---
name: Diagram
description: >-
  何时使用该教学方法。包含主题、学习者意图、触发词和一个 @key 示例。
capabilities:
  notes.write: allow
  practice.run: deny
---

## 约束
- 教学边界和不应代写的内容。

## 方法
1. 可重复执行的教学步骤。
2. 对证据、计算、引用或安全的要求。
```

实现 `agent-design/profiles.ts`：复用 `parseAcademicProfile` 或遵循现有 Code/English loader 的相同校验规则，并用模块内缓存让默认 Profile 只在 `getDefault*Profiles()` 第一次调用时加载。

基础 Prompt 放在 `agent-design/base-prompt.ts`。它应包含角色、Profile 目录、工具组目录、动态激活提醒、领域教学纪律与环境限制；不要把每个 Profile 的完整方法论拼进基础 Prompt。

## 2. 定义状态、工具和 Snapshot

创建只属于该领域的状态对象。状态应保持小而显式，避免把可从消息历史重建的信息重复保存。

```ts
interface ExampleState extends Record<string, JsonValue> {
  progressByProfile: Record<string, ExampleProgress>;
  notes: Record<string, ExampleNote>;
}
```

定义 Tool Group 时，延迟创建 `AgentTool[]`：

```ts
export function createExampleToolManifest(state: ExampleState): ToolManifest {
  return {
    groups: [
      { key: "notes", description: "保存与查看学习笔记", load: () => createNoteTools(state) },
      { key: "practice", description: "发起和记录练习", load: () => createPracticeTools(state) },
    ],
    resolveCapability(toolName) {
      if (toolName === "save_note") return "notes.write";
      if (toolName === "list_notes") return "notes.read";
      if (toolName === "submit_example_answer") return "practice.run";
      return undefined;
    },
  };
}
```

工具不要在 module import 时读环境变量、访问磁盘或发网络请求。工具失败时抛出 `Error`，让 Agent 将其作为工具错误返回模型；不要把错误伪装成成功文本。

然后实现 `SnapshotExtension`：

```ts
const extension: SnapshotExtension = {
  key: "example",
  export: () => structuredClone(state),
  validate: (raw) => validateExampleSnapshot(raw),
  restore: (value) => restoreExampleState(state, value),
};
```

`validate()` 必须是防御性边界，不能只做类型断言。它要拒绝未知 Profile key、不合法枚举、缺字段和不可信嵌套值。不要在 extension 中持久化模型密钥、连接池、函数或循环引用。

## 3. 组装 Mentor 工厂

创建 `create-<id>-mentor.ts`。其职责与现有 Pack 相同：解析 Profile、创建状态与工具 Manifest、注册/选择模型、构造 `DomainPack`，然后交给 `createRuntime()` 和 `createSession()`。

```ts
export function createExampleMentorSession(config: ExampleMentorConfig = {}): ExampleMentorSession {
  const resolved = resolveExampleMentor(config);
  const session = createSession({
    ...config,
    model: resolved.model,
    models: resolved.models,
    domain: resolved.domain,
  });
  return Object.assign(session, {
    exampleState: resolved.state,
    listNotes: () => resolved.notes.list(),
  });
}
```

工厂应接受与现有 Pack 一致的基础配置：`models`、`model`、`customModel`、`useEnvCustomModel`、`providerId`、`modelId`、`thinkingLevel`、`systemPrompt`、`profiles`、`snapshot`、`maxTurns`、`fetch`、`llmTelemetry`。领域专用依赖作为额外可选项注入。

若新 Pack 与 Math / Physics / History 同样属于“本地学习卡片 + 练习”的学科，可评估复用 `src/packs/shared/academic/`；只有语义、验证规则和工具名称确实一致时才复用，避免把不相干领域强行抽象到 shared。

## 4. 公开 API 与 Adapter 接入

在 `src/packs/<id>/index.ts` 只导出宿主需要的工厂、配置、Profile parser/loader、工具 Manifest 和领域类型。然后在 `src/index.ts` 添加：

```ts
export * from "./packs/example/index.js";
```

所有 ESM 相对导入必须带 `.js`。外部消费者只能从 `src/index.ts` 导入。

CLI 接入：在 `src/adapters/cli/index.ts` 的 `PACKS` 注册表添加 id、名称、Profile help 和创建函数；可在 `package.json` 添加 `chat:<id>` 脚本。

Web 接入：在 `src/adapters/web/index.ts` 的 `WEB_PACKS` 添加 Pack 元数据、Profile 列表、Session 工厂和侧栏投影。若有 `FAUX_DEMO`，还需提供不依赖真实服务的 demo 响应脚本。Web 的 `courseId` 使用 Pack id 分桶，所以不要复用已有 id。

## 5. 测试

为新 Pack 增加 `tests/unit/<id>-pack.test.ts`，最低覆盖：

1. 默认 Profile key 的稳定顺序；
2. 未激活 Tool Group 时具体工具不可见，激活后才出现；
3. 一个代表性领域实体的验证和读写；
4. 通过 faux provider 走完一次动态工具调用；
5. 导出并恢复 Snapshot，确认只写入 `extensions.<id>`；
6. 有 evaluator / executor 等注入接口时，确认请求带有正确领域上下文。

同时更新 `package.json` 的 `test:agent` 与 `tests/TEST-SPEC.md`。提交前至少运行：

```bash
npm run typecheck
npm test
npm run test:agent
```

## 发布前审查

- Core 没有被加入任何领域名或 Pack import。
- import 不产生 I/O 或网络副作用。
- 基础 Prompt 不包含完整 Profile 方法论。
- 所有具体工具都在 Manifest 中有 capability 映射。
- Snapshot extension 是 JSON，验证严格，namespace 唯一。
- 外部服务可选、可注入、可降级；没有未经讨论的新部署依赖。
- `src/index.ts`、CLI、Web、README、文档导航和测试均已更新。
