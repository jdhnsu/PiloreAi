# 大学学科 Packs

PiLore 现提供三个无需外部后端即可运行的大学学科 Pack：

| Pack | 工厂 | 默认 Profiles | Snapshot namespace |
| --- | --- | --- | --- |
| 大学数学 | `createMathMentorSession()` | Euler / Gauss / Noether | `extensions.math` |
| 大学物理 | `createPhysicsMentorSession()` | Curie / Feynman / Maxwell | `extensions.physics` |
| 大学历史 | `createHistoryMentorSession()` | Bloch / Braudel / Sima | `extensions.history` |

三个 Pack 都沿用 Core 的 Profile Router、动态 Tool Runtime、Session 与 Snapshot 协议。领域状态不会进入 Core，也不会跨 Pack 共享。

## 最小使用

```ts
import {
  createHistoryMentorSession,
  createMathMentorSession,
  createPhysicsMentorSession,
} from "./src/index.js";

const math = createMathMentorSession();
await math.prompt("@euler 直观解释方向导数", console.log);

const physics = createPhysicsMentorSession();
await physics.prompt("@maxwell 如何建立带阻力的抛体模型？", console.log);

const history = createHistoryMentorSession();
await history.prompt("@bloch 如何分析一份战时日记？", console.log);
```

CLI 可用 `npm run chat:math`、`npm run chat:physics`、`npm run chat:history`。Web 注册表也会自动列出三个 Pack。

## 共用学习能力

每个 Pack 有两个默认按需工具组：

- `study_cards`：`save_study_card`、`list_study_cards`、`remove_study_card`。卡片记录类型、标题、摘要、详情和标签，并随 Session Snapshot 持久化。
- `practice`：`start_academic_practice`、`submit_academic_answer`。练习答案始终写入本 Pack 的日志；只有注入评估器时才自动判分。

卡片类型：

- 数学：`definition`、`theorem`、`formula`、`method`、`mistake`
- 物理：`law`、`model`、`formula`、`experiment`、`mistake`
- 历史：`event`、`person`、`concept`、`source`、`debate`

练习类型：

- 数学：`concept`、`calculation`、`derivation`、`proof`、`application`
- 物理：`concept`、`calculation`、`derivation`、`experiment`、`estimation`
- 历史：`chronology`、`concept`、`causation`、`comparison`、`source_analysis`、`essay`

## 可选评估器

默认实现不发送网络请求，也不要求部署判题或检索服务。应用如果已有规则引擎、人工批改系统或模型评估服务，可以通过小接口注入：

```ts
import { createMathMentorSession, type MathEvaluator } from "./src/index.js";

const normalize = (text: string) => text.replace(/\s+/g, "").toLowerCase();

const evaluator: MathEvaluator = {
  async check(request) {
    // request.subject 固定为 "math"；这里可连接应用自己已有的评估能力。
    return {
      correct: normalize(request.answer) === normalize(request.reference ?? ""),
      feedback: "请同时写出定义域与关键变形依据。",
    };
  },
};

const session = createMathMentorSession({ evaluator });
```

评估器是应用边界，不属于 Pack 的必需基础设施。若后续要加入计算机代数、物理仿真或史料检索等开源后端，应先明确使用场景、部署约束和数据边界，再增加适配器，而不是让 Pack 直接依赖服务。

## Profile 定制

每个 Pack 的 `agent-design/profiles/*.md` 都使用与现有 Code / English Pack 相同的 frontmatter 格式。可通过 `parseMathProfile`、`parsePhysicsProfile`、`parseHistoryProfile` 解析自定义 Markdown，然后在创建 Session 时传入 `profiles`。方法论只在 Profile 激活后进入可信上下文，不常驻 system prompt。
