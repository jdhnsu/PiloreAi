# 开发新的 Pack

本指南说明如何新增一个可嵌入的教学领域 Pack。目标是把领域能力限定在 `src/packs/<id>/`，复用 Core 的 Router、Tool Runtime、Session 与 Snapshot 协议，并在不改动 Core 领域语义的前提下被 CLI、Web 或第三方宿主使用。

## 开始前的设计清单

先写清以下问题：

1. Pack 的稳定 ID 是什么？它将成为 `DomainPack.id`、Snapshot namespace 和 Web `courseId` 的一部分，发布后应避免改名。
2. 学习者要完成的能力有哪些？哪些适合靠模型讲解，哪些必须用工具或外部服务验证？
3. 需要哪些教学方法 Profile？它们必须按“学习者需要的教学方式”划分，而不是按章节、知识点或工具划分；每一对相邻 Profile 是否都有清晰的正向条件和负向边界？
4. 哪些工具是高风险或应受教学纪律约束？为它们定义 capability 名称。
5. 哪些领域状态需要跨会话保存？它必须能表示成 JSON，且只写入 `extensions.<id>`。
6. 是否真的需要执行、检索、仿真或评估后端？若需要，先和产品方确认部署、数据、认证、超时和降级策略。

## 1. 建立目录与 Profile

创建 `src/packs/<id>/agent-design/profiles/`。Profile 文件使用现有 frontmatter 格式：

```md
---
name: Visualizer
description: >-
  只在学习者明确要求用图形、空间关系或可视化表示建立直觉时使用。
  若用户要严格证明应选择 Proof；简单事实问题保持 auto。
  典型表达：画出来、几何直觉、看图理解。用法示例：@visualizer 画出这个关系帮助我理解。
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

## 2. 设计多教师路由

### 2.1 Profile 是教学方法，不是学科分包

一个 Session 只拥有一个主 Domain Pack。Pack 回答“学什么领域”，Profile 回答“这一轮用什么教学方法”。不要用 Profile 模拟跨 Pack 路由，也不要把每个章节、框架或题型都做成一名教师。

建议先控制在 2–4 个互补 Profile。只有同时满足以下条件才新增一名教师：

1. 它对应稳定、可复用的学习者意图，而不是某个主题词；
2. 它有不同于现有教师的完整教学流程；
3. 能写出至少两个“应该选它”和两个“绝不能选它”的自然语言例子；
4. 能解释它与最接近教师的分工，而不是依赖模型自行猜测。

典型的错误拆分包括“Python 教师 / JavaScript 教师”“第一章教师 / 第二章教师”“会用搜索工具的教师”。这些是领域、内容或能力边界，应由 Pack、Prompt、Tool Group 或 capability 表达。

### 2.2 `description` 是路由契约

模型在选择前常驻可见的是 `name + description`；方法论正文只在激活后注入。因此路由规则必须写在 description，不能只写在 methodology 中。每个 description 至少包含：

- 核心学习意图：用户究竟需要直觉、原理、练习、脚手架、证据分析还是别的方法；
- 强正向信号：完整语义和典型表达，而不只是关键词列表；
- 负向边界：简单事实、直接操作以及哪些请求不属于它；
- 相邻 Profile 分工：出现冲突时应该选谁；
- 一个自然的 `@key` 示例，供手动选择和帮助文本使用。

推荐格式：

```md
description: >-
  直觉导师，只在学习者明确觉得概念抽象、听不懂术语，或要求生活类比时使用。
  核心意图是降低抽象度，不是泛指任何“解释”请求。
  若用户要严密推导应选 Proof；若缺少多层前置知识应选 Scaffold；
  简单事实和直接操作问题保持 auto。
  典型表达：太抽象、用大白话、打个比方。用法示例：@intuition 用生活例子解释这个概念。
```

禁止只写“擅长耐心讲解”“用户问为什么时使用”一类宽泛描述。多个 description 若共同包含“讲解、解释、为什么、区别”等泛词，却没有负向边界，真实模型通常会过度激活或随机选人。

开发前先写一张冲突表；任意一格无法给出稳定答案时，先合并或重写 Profile，不要靠增加提示词补洞：

| 用户意图 | Intuition | Proof | Scaffold | auto |
|---|---:|---:|---:|---:|
| 明确要求生活类比 | 应选 | 不选 | 不选 | 不选 |
| 要求严密推导和反例 | 不选 | 应选 | 不选 | 不选 |
| 不知道缺哪些前置 | 不选 | 不选 | 应选 | 不选 |
| 简单事实或一行语法 | 不选 | 不选 | 不选 | 应选 |

### 2.3 基础 Prompt 必须定义完整状态机

不能只写“选择最合适的 Profile”。多教师 Pack 的基础 Prompt 必须明确以下四类行为：

1. **自动激活**：当前为 auto 时，只有完整语义强匹配某种专门教学方式才调用 `adopt_profile`；简单事实、简短语法和直接操作保持 auto。
2. **稳定保持**：当前 Profile 仍匹配时不重复调用；更换话题本身不是换教师的理由。
3. **直接切换**：学习方式明确改变时直接切到目标 Profile，不先 `auto` 再切目标。
4. **主动交还**：用户明确结束专门讲解并转问独立简单问题时，先切回 `auto` 再回答。

目标是每条用户消息最多发生一次模型驱动的 Profile 变化。Core 的 `maxSwitchesPerTurn` 是安全上限，不是允许模型来回试选的预算。稳定回合不应产生 Profile 事件；切换回合应只产生一个、且必须是目标 key 的事件。

不要使用“只有 auto 才判断 Profile”这类规则。它会让模型在首次激活后停止检查用户的新意图，造成教师粘滞。也不要写成“每次换主题就回 auto”，这会让长期采用同一教学方法的对话频繁抖动。

### 2.4 Profile Context 不能阻止重新路由

`renderContext()` 会把当前 Profile 的方法论与下一条用户消息合并。若上下文只写“当前教师 X，严格执行方法论”，模型容易把它理解为不可变命令，即使用户已经改变意图也不切换。

多教师 Pack 的激活上下文应先声明重新判断，再要求执行方法论：

```ts
renderContext(message) {
  if (!message.profileKey) {
    return "<pilore_profile_context>\n当前模式：自动路由。\n</pilore_profile_context>";
  }
  return `<pilore_profile_context>
当前教师：${message.profileName}（@${message.profileKey}）。
先按基础 Prompt 判断本轮是否仍需要这种教学方式；若不适用，先调用 adopt_profile
直接切到目标 Profile 或 auto。只有决定保持当前 Profile 时，才执行下列方法论。

${message.methodology}
</pilore_profile_context>`;
}
```

不要把方法论放回常驻 system prompt，也不要让 `renderContext()` 自行分类用户意图。它只负责提供当前权威 Profile、最新领域进度、重新路由提醒和已激活的方法论。

### 2.5 手动选择、状态和权限

- `@key`、`session.setProfile(key)` 与模型调用 `adopt_profile` 最终使用同一 ProfileDefinition；key 必须稳定、小写、唯一，发布后不得随意改名。
- `@pilore` 或 `setProfile(null)` 返回自动路由。不要承诺“手选永久锁定”，除非 Pack/Core 另行保存并恢复锁定来源；当前 Snapshot V1 只保存 `activeProfileKey`。
- `progressByProfile` 只记录该方法需要的学习进度，不要复制完整聊天历史，也不要让一个 Profile 写另一个 Profile 的状态。
- capability 只表达执行权限，不参与语义路由。不能靠禁止工具来补救错误选师；路由与权限必须分别测试。

## 3. 定义状态、工具和 Snapshot

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

## 4. 组装 Mentor 工厂

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

## 5. 公开 API 与 Adapter 接入

在 `src/packs/<id>/index.ts` 只导出宿主需要的工厂、配置、Profile parser/loader、工具 Manifest 和领域类型。然后在 `src/index.ts` 添加：

```ts
export * from "./packs/example/index.js";
```

所有 ESM 相对导入必须带 `.js`。外部消费者只能从 `src/index.ts` 导入。

CLI 接入：在 `src/adapters/cli/index.ts` 的 `PACKS` 注册表添加 id、名称、Profile help 和创建函数；可在 `package.json` 添加 `chat:<id>` 脚本。

Web 接入：在 `src/adapters/web/index.ts` 的 `WEB_PACKS` 添加 Pack 元数据、Profile 列表、Session 工厂和侧栏投影。若有 `FAUX_DEMO`，还需提供不依赖真实服务的 demo 响应脚本。Web 的 `courseId` 使用 Pack id 分桶，所以不要复用已有 id。

## 6. 测试

### 6.1 离线契约测试

为新 Pack 增加 `tests/unit/<id>-pack.test.ts`，最低覆盖：

1. 默认 Profile key 的稳定顺序；
2. 未激活 Tool Group 时具体工具不可见，激活后才出现；
3. 一个代表性领域实体的验证和读写；
4. 通过 faux provider 走完一次动态工具调用；
5. 导出并恢复 Snapshot，确认只写入 `extensions.<id>`；
6. 有 evaluator / executor 等注入接口时，确认请求带有正确领域上下文。

多教师 Pack 还必须增加以下确定性测试：

7. Profile key 唯一、顺序稳定、description 和 methodology 非空；
8. 基础 Prompt 含自动激活、稳定保持、直接切换、主动交还四类规则，但不含完整 methodology；
9. faux provider 模拟 `auto → A`、`A → B`、`A → auto`，确认 `SessionEvent.profile` 的 key 与 source 正确；
10. 稳定回合不重复调用相同 Profile，直接切换不会产生 `A → auto → B`；
11. `renderContext()` 在方法论之前保留重新判断提醒，并携带最新 `getProfileState()`；
12. Snapshot 恢复拒绝未知 Profile key，恢复已知 key 后上下文仍能正确生成。

离线测试只能验证协议、提示结构和事件链，不能证明真实模型会按 description 正确分类。因此不得用 faux provider 的预设工具调用宣称“自动路由已通过”。

### 6.2 真实模型路由评测

每个新增的多教师 Pack 都应有显式、会产生费用的真实模型评测入口。评测不加入默认 `npm test`，但必须在首次发布、Profile description 调整、基础路由 Prompt 调整或 `renderContext()` 改动后运行。

至少覆盖以下矩阵：

| 类别 | 初始状态 | 用户意图 | 断言 |
|---|---|---|---|
| 应激活 | auto | 每个 Profile 各一个强匹配自然表达 | 精确命中目标 key |
| 不应激活 | auto | 简单事实、直接操作、弱相关关键词 | 保持 auto，无 Profile 事件 |
| 应保持 | Profile A | 方法不变但继续追问或更换主题 | 保持 A，无重复事件 |
| 应切换 | Profile A | 明确改用 Profile B 的教学方式 | 直接 `A → B`，恰好一个事件 |
| 应交还 | Profile A | 明确结束专门教学并转问独立简单问题 | 直接 `A → auto` |
| 抗歧义 | auto 或 A | 同时含多个泛词但真实意图只有一个 | 不因单个关键词误选或抖动 |

编写 case 时遵守：

- 输入只写自然语言，不出现 `@key`、Profile 名称或“请切换教师”等答案泄漏；
- 每个场景使用全新 Session，避免前一个 case 的历史和状态污染；
- 多轮场景先用准备轮稳定进入起始 Profile，再单独给计分轮；准备轮失败也应使该场景失败；
- 同时断言回合开始 Profile、结束 Profile、模型来源的 Profile 事件序列和错误；不要只检查最终 key，否则会漏掉 `A → auto → B` 抖动；
- 路由测试以 Profile 轨迹为主。回答风格、教学质量和工具纪律应放在独立规则中，避免用“输出出现某个关键词”替代路由断言。

推荐默认每例运行 3 次，并采用以下最低门槛：

- 每个场景至少成功 2/3；
- 应激活、不过度激活、保持稳定、应切换四类指标分别不低于 80%；
- 同一用户回合内超过一次模型路由变化的抖动数为 0；
- 重试耗尽后的模型错误数为 0。

在线 runner 必须从现有 provider 配置读取 API key；缺 key 时直接非零退出并提示环境变量名，不得静默跳过、打印 key 或把 key 写进报告。报告使用独立时间戳文件，至少包含 provider/model、迭代次数、期望与实际轨迹、分类指标、失败场景、错误和重试次数。

只允许对连接中断、限流等传输失败重试，并且每次用全新 Session 重跑整个场景；路由选错不能重试到成功。保留轮次间节流，避免并发和供应商限流污染行为统计。

开发流程应是：

1. 先在未修改路由规则时跑完整基线；
2. 从失败轨迹区分漏切换、过度切换、粘滞和抖动；
3. 优先调整通用边界、状态机或 Context，不针对某条测试原句硬编码；
4. 用 `--filter` 单独复测失败场景；
5. 最后重新跑完整 3 轮矩阵，确认没有以提高切换率为代价破坏稳定率。

Code Pack 的参考实现为：

```bash
npm run test:router:real
npm run test:router:real -- --filter CRR-10 --iterations 1
```

新增 Pack 时可复用 `tests/harness/router-real-driver.ts` 的逐回合证据思路，但 case、Session 工厂和 Profile key 必须属于该 Pack；不要继续把所有 Pack 硬编码进 Code runner。

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
- Profile 按教学方式划分，每一对相邻教师都有正向条件、负向边界和冲突归属。
- 基础 Prompt 明确自动激活、稳定保持、直接切换和主动交还；Context 不会把当前教师变成不可切换指令。
- 真实模型矩阵同时验证“该切时切”和“该保持时保持”，不存在双切抖动。
- 所有具体工具都在 Manifest 中有 capability 映射。
- Snapshot extension 是 JSON，验证严格，namespace 唯一。
- 外部服务可选、可注入、可降级；没有未经讨论的新部署依赖。
- `src/index.ts`、CLI、Web、README、文档导航和测试均已更新。
