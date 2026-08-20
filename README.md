<div align="center">

<img src="assets/2d/pilore.png" alt="PiLore icon" width="112">

# PiLore

**可扩展的多领域教学 Agent**

LLM → Profile 路由 → 动态学科工具 → 基于学习状态与真实工具结果的讲解

<img src="assets/as1/robot_9.png" alt="PiLore 吉祥物" width="240">

</div>

PiLore 由领域无关的 Core，以及 Code、English、大学数学、大学物理和大学历史 Pack 组成。Core 独立提供 Agent Loop、Session、Profile Router、动态工具运行时和快照；领域设定与工具由 Pack 注入。

## 文档

完整文档从 [docs/README.md](docs/README.md) 开始。建议按角色阅读：

- 使用或嵌入： [架构总览](docs/architecture.md)、[嵌入与 Session API](docs/embedding.md)、[Adapters 与 HTTP API](docs/adapters.md)
- 理解通用运行机制： [Core](docs/core.md)、[持久化与 PostgreSQL](docs/persistence.md)、[模型与遥测](docs/models-and-telemetry.md)
- 维护底层运行时： [Pi 运行时源码分叉](docs/runtime-source-fork.md)
- 开发或扩展领域： [Packs](docs/packs.md)、[开发新的 Pack](docs/pack-development.md)、[大学学科 Packs](docs/academic-packs.md)

**亮点**

- 内存 VFS + 远程沙箱：学习者代码绝不落地、绝不在本地执行
- 多 Profile 教学团队：Feynman / Socrates / Oris，模型自动路由或 `@` 手动指定；方法论只在激活后追加到可信上下文
- 能力契约：每位老师用 frontmatter 声明允许/禁止的能力（deny-list），运行时强制拦截，文档与运行时解耦
- 传输无关的事件协议：`SessionEvent` 纯 JSON 流，Web / CLI / 其它项目共用同一会话层
- **嵌入友好**：每个 Pack 都提供 `create*MentorSession(config)` 工厂；Core 也可不加载 Pack 独立运行
- Fluent（微软）风格 Web 界面：流式回答、工具调用卡片、实时工作区侧栏
- 可替换执行后端：实现 `ExecClient` 接口，或用兼容 codapi 风格 `POST /v1/exec` 协议的服务，改一个环境变量即可切换
- 独立 Judge Pack：Judge 教练先用 go-judge 验证参考解答与隐藏用例，再发布结构化题目卡；用户提交后先真实判题再讲解

## 快速开始

```bash
npm install

# 1. 无 API key：跑内置演示链路（fauxProvider 脚本化 + 进程内 mock 执行服务）
npm run demo

# 2. 有 API key：
cp .env.example .env   # 填入 DEEPSEEK_API_KEY（首选）、MOONSHOT_API_KEY 或 LONGCAT_API_KEY

# 或配置单个自定义模型（支持 OpenAI Chat Completions / Responses / Anthropic Messages）
# CUSTOM_MODEL_URL=https://api.example.com/v1
# CUSTOM_MODEL_PROTOCOL=openai-completions
# CUSTOM_MODEL_ID=your-model-id
# CUSTOM_MODEL_API_KEY=your-api-key

# 3. Web 界面（主要测试面，浏览器打开提示的地址；默认 8600 端口，被占用时自动回退 +1；
#    显式指定用 WEB_PORT=xxxx npm run web）：
npm run web            # 真实模型
npm run web:demo       # 无需 API key（fauxProvider 脚本化 + 进程内 mock 执行服务）

# CLI（支持 code / judge / english / math / physics / history pack）：
npm run chat
npm run chat:english
npm run chat:math
npm run chat:physics
npm run chat:history
#
# EXEC_API_BASE 默认指向真实执行后端 http://localhost:1313。
# 离线环境可改用本地 mock：npm run mock + EXEC_API_BASE=http://localhost:1313
#（若 1313 被 Windows Hyper-V 保留端口占用: PORT=13131 npm run mock，并同步改 EXEC_API_BASE）
# go-judge 默认地址为 http://127.0.0.1:5050，可通过 GO_JUDGE_API_BASE 修改。
```

其他命令：

```bash
npm run list-models        # 打印各 provider 可用模型，确认 MODEL_ID
npm run typecheck          # TypeScript 类型检查（不产出构建文件）
npm test                   # 单元测试（状态、快照、加密）
npm run test:postgres      # PostgreSQL 集成测试（读取 .env 的 DB_*，使用并清理临时 schema）
npm run test:agent         # Core + Pack 离线测试（faux，确定性）
npm run test:agent:real    # Agent 核心在线测试（真实模型，行为达成度评分，默认 3 轮平均值）
npm run test:agent:all     # 两者都跑
```

测试规格与评分模型见 `tests/TEST-SPEC.md`（用例清单、参数/预期/权重、S/A/B/C/D 等级）。切换在线测试模型：改 `.env` 的 `PROVIDER`/`MODEL_ID`/`THINKING_LEVEL`，或在命令后追加 `--provider x --model y --thinking off`，如：

```bash
npx tsx tests/run.ts --provider moonshotai-cn --model kimi-k2-0905-preview
```

嵌入时也可通过 `customModel` 直接指定连接信息；该配置会自动注册并选中模型，且不需要新增 provider 源文件：

```ts
const session = createCodeMentorSession({
  customModel: {
    url: "http://127.0.0.1:11434/v1",
    protocol: "openai-completions",
    id: "qwen2.5",
  },
});
```

CLI 内命令：`/quit` 退出、`/abort` 中断当前运行、`/help` 帮助。

## 架构分层

```
├─ src/
│  ├─ core/           # runtime / session / state / snapshot / router / tool-runtime / events
│  ├─ packs/
│  │  ├─ code/        # 编程导师设定、Profiles、VFS、ExecClient、代码工具与快照扩展
│  │  ├─ judge/       # go-judge、题目自验证、题目卡、提交判定与讲题状态
│  │  ├─ english/     # 英语导师设定、Profiles、词汇/练习工具与快照扩展
│  │  ├─ math/        # 大学数学 Profiles、学科工具与 math 快照扩展
│  │  ├─ physics/     # 大学物理 Profiles、学科工具与 physics 快照扩展
│  │  ├─ history/     # 大学历史 Profiles、学科工具与 history 快照扩展
│  │  └─ shared/      # 学科 Pack 共用的卡片、练习、评估器与状态实现
│  ├─ infrastructure/ # models / telemetry / persistence
│  ├─ adapters/
│  │  ├─ cli/         # CLI 入口
│  │  └─ web/         # HTTP + SSE + 静态服务
│  └─ index.ts        # 唯一公开 API 入口
├─ examples/          # 嵌入示例
├─ web/               # Fluent 风格前端（index.html / style.css / app.js）
├─ mock/
│  └─ exec-server.ts  # mock 代码执行服务（node:http，不真正执行代码）
├─ scripts/
│  ├─ demo.ts         # 无 API key 终端演示
│  ├─ web-demo.ts     # 无 API key Web 演示入口
│  └─ list-models.ts  # 打印 provider 可用模型列表
└─ package.json       # 依赖与脚本入口
```

数据流（一次对话）：

1. CLI / Web Adapter 收到用户输入 → `session.prompt(text)`
2. Agent loop（`@pilore/pi-agent-core` 的 `Agent`）通过 `streamFn`（`models.streamSimple`）请求 LLM
3. LLM 先用 `activate_toolset` 动态加载工具组，再调用 Pack 工具
4. `SessionEvent` 由 Adapter 实时渲染：流式文本、Profile、工具组与工具结果
5. LLM 基于工具结果继续下一轮，直到产出讲解文本并结束

大学数学、大学物理与大学历史 Pack 的 Profile、卡片/练习类型、评估器注入和 Snapshot 说明见 [`docs/academic-packs.md`](docs/academic-packs.md)。三个 Pack 默认不需要计算、仿真、史料检索或判题后端。

### 依赖说明

- [`@pilore/pi-ai`](packages/pi-ai/README.md)：统一 LLM API（models 集合、provider、流式事件协议）
- [`@pilore/pi-agent-core`](packages/pi-agent-core/README.md)：agent loop / 工具调度 / 事件流
- [`yaml`](https://www.npmjs.com/package/yaml)：老师设计文档 frontmatter 元数据解析
- 不引入 `@earendil-works/pi-coding-agent`：其内置工具面向本地 fs / 进程，与本项目"内存 VFS + 远程沙箱"的模型不符

## Web 界面

Fluent（微软）风格单页应用，零前端依赖，由 `src/adapters/web/index.ts` 通过 SSE 推送 `SessionEvent`：

- 流式回答 + markdown/代码块渲染、工具调用卡片（`write_file` / `run_code` 状态与输出）
- 顶栏与消息内显示当前 Profile（模型经 `adopt_profile` 路由，或用户 `@` 指定）
- `@feynman` / `@socrates` / `@oris` 直接指定教学方法（输入框上方也有快捷 chips）；`@pilore` 或老师激活时出现的「↩ 切回 PiLore」按钮可手动切回自动路由
- Profile 是临时模式：模型可调用 `adopt_profile("auto")` 交还自动路由
- 每条回复右下角显示本次回答的老师徽标（紫色 = 指定/自动路由到的老师，灰色 = PiLore 自动）
- 右侧「工作区」侧栏实时展示 VFS 文件并可查看内容
- 长会话接近模型窗口时先征求确认：可压缩为结构化学习检查点后继续，或新建会话并保留当前草稿；单条过长输入会提示拆分，不会向模型发送必然失败的请求

在 `.env` 中可统一设置上下文护栏：`PILORE_CONTEXT_WINDOW=128000` 覆盖模型的总上下文窗口（含 system prompt、工具和历史），`PILORE_MAX_INPUT_TOKENS=12000` 限制单条用户消息。显式传入 `contextPolicy.contextWindow` 或 `contextPolicy.maxInputTokens` 时以代码配置为准。

HTTP 接口（适配层与组件的边界，任何前端/其它服务都可消费）：

| 接口 | 说明 |
| --- | --- |
| `GET /` | 静态页面（web/） |
| `GET /api/packs` | 可用 Pack 与 Profile 目录 |
| `GET /api/state?id=...` | 当前会话的 Pack / Profile / busy / model |
| `GET /api/panel?id=...` | Code 文件、Judge 公开题目/最近提交/语言、English 词汇或学科学习卡片侧栏 |
| `POST /api/chat` | `{ sessionId, message }` → SSE `SessionEvent` |
| `POST /api/judge/run` | `{ sessionId, sourceCode, language, stdin? }` → 自定义输入真实运行结果 |
| `POST /api/judge/submit` | `{ sessionId, sourceCode, language }` → 当前题目脱敏判题结果 |
| `POST /api/context/compact` | `{ sessionId }` → 用户确认后压缩早期历史并持久化；`/api/chat` 超限时返回 `409 CONTEXT_COMPACTION_REQUIRED` |
| `POST /api/profile` | `{ sessionId, profile }` 手动切换 Profile |
| `POST /api/abort` | 中止指定会话的当前运行 |
| `POST /api/register` | `{ code, email, password, name? }` 一次性邀请码注册 |
| `POST /api/login` | `{ email, password }` 邮箱密码登录（仅真实模式；演示模式免登录） |
| `POST /api/logout` / `GET /api/me` | 清除登录 Cookie / 当前登录用户 |

### 内测登录（邀请码）

真实模式下 Web 界面要求先用一次性邀请码注册邮箱和密码，再把登录用户映射为会话身份，实现多用户会话隔离（跨用户访问一律 404）：

```bash
npm run gen:beta-codes        # 生成 data/beta-users.json（只存哈希）并打印 15 个明文邀请码
AUTH_SECRET=$(openssl rand -hex 32) npm run web
```

要点：邀请码只存 SHA-256 哈希，首次注册后永久核销；密码使用 scrypt 加盐哈希；登录签发 HMAC 签名 Cookie（HttpOnly + SameSite=Lax）；部署在 HTTPS 反代后设 `WEB_COOKIE_SECURE=1`；同来源每分钟最多 5 次失败登录。详见 [docs/adapters.md](docs/adapters.md) 与 [docs/persistence.md](docs/persistence.md)。

## 老师设计文档与元数据（按需加载）

每个 Pack 在自己的 `agent-design/profiles/*.md` 保存 Profile。首次创建该 Pack 时才懒加载；也可用对应的 `parseCodeProfile`、`parseEnglishProfile`、`parseMathProfile`、`parsePhysicsProfile` 或 `parseHistoryProfile` 从字符串构造 `ProfileDefinition` 后注入。

```yaml
---
# 路由目录条目（单一事实源：路由器只依据它判断方法，方法正文不再手工 paraphrase）
name: Socrates
description: >-
  当用户想理解原理、辨析易混淆概念、解释代码逻辑时使用。触发词：讲解、解释、原理、
  为什么、区别、对比。用法示例：@socrates 讲讲 Python 的 GIL 是什么？
# 本期无语义，预留给未来（如 manual = 仅 @ 指定）
mode: primary
# 环境契约：deny-list，只列禁止项，省略 = 允许；也可显式声明 allow。能力词汇与运行时工具解耦：
#   file.read → read_file    file.write → write_file（新建）    file.modify → write_file（覆盖已有）
#   exec.run  → run_code     （未来可扩展 file.list / web.fetch / web.search）
capabilities:
  file.write: allow
  file.modify: deny
---
```

按需加载机制：

1. **目录常驻**：基座 system prompt 只含角色 + 路由规则 + 目录（name+description），不含任何方法论全文
2. **选中后追加**：`adopt_profile` 或 `@key` 追加可信 Profile Context，并在模型边界与下一条 user 消息合并
3. **权限强制**：active Profile 的 capability deny-list 在工具调用前强制拦截

## 组件接口（嵌入到其他项目）

Core 提供 `createSession()`；领域产品提供 `createCodeMentorSession()`、`createEnglishMentorSession()`、`createMathMentorSession()`、`createPhysicsMentorSession()` 与 `createHistoryMentorSession()`：

| 配置项 | 缺省值 | 说明 |
| --- | --- | --- |
| `models` | 内置 provider 注册表 | 自定义模型集合（如测试用 fauxProvider） |
| `providerId` / `modelId` | env `PROVIDER` / `MODEL_ID` | 模型选择 |
| `thinkingLevel` | env `THINKING_LEVEL`，缺省 `off` | 推理级别 |
| `systemPrompt` | Pack 基座 Prompt | 自定义基座提示词 |
| `fetch` | `globalThis.fetch` | 自定义 provider HTTP transport，便于代理或测试 |
| `llmTelemetry` | 关闭 | 脱敏的逻辑调用、HTTP attempt/retry、前缀哈希与 usage 事件 |
| `vfs` | 新建空实例 | 自定义工作区（可预置学习者文件） |
| `cards` | 新建空实例 | 数学/物理/历史 Pack 的学习卡片库 |
| `evaluator` | 关闭 | English 或大学学科 Pack 的可选应用侧评估器 |
| `profiles` | Pack 的 `agent-design/profiles/` 懒加载 | 自定义 Profile 集合 |
| `exec` | `createHttpExecClient()` | 自定义执行后端（实现 `ExecClient` 接口） |
| `maxTurns` | 不限 | 单次 prompt 的 LLM 回合护栏 |

import 核心不产生任何副作用（不扫磁盘、不读 env、不发请求），缺省值在创建会话时才解析：

```ts
import { createCodeMentorSession, parseCodeProfile } from "./src/index.js";

// 最小用法：全部缺省
const session = createCodeMentorSession();

// 完全替换：自有 Profiles + 自有沙箱 + 自有模型
const session = createCodeMentorSession({
  profiles: [parseCodeProfile(myProfileMd, "guide.md")],
  exec: { exec: async (req) => mySandbox.run(req) },  // 实现 ExecClient
  models: myModels, providerId: "x", modelId: "y",
});

await session.prompt("什么是闭包？", (event) => {
  // event: text_delta / profile / toolset / tool_start / tool_end / error / done
});
session.setProfile("guide");
session.abort(); session.listFiles(); session.readFile("main.py");

// 快照是纯 JSON，可交给独立持久化层；恢复时会校验版本、Profile、工具组和扩展
const snapshot = session.exportSnapshot(currentRevision);
const restored = createCodeMentorSession({ snapshot });
```

完整可运行示例见 [examples/embed-minimal.ts](examples/embed-minimal.ts)（`npm run example:embed`，无需 API key）。
CLI 与 Web 都只是 Adapter；嵌入方只需消费 `SessionEvent`，无需感知 `pi-agent-core`。

### PostgreSQL 会话持久化

核心导出 `SessionSnapshotV1`。领域数据分别位于 `extensions.code`、`extensions.english`、`extensions.math`、`extensions.physics` 或 `extensions.history`；`PostgresSessionStore` 可管理会话和运行记录，并通过可替换的 `CryptoProvider` 加密：

```ts
import { Pool } from "pg";
import {
  applyPostgresMigrations,
  createAes256GcmCryptoProvider,
  createPostgresSessionStore,
} from "./src/index.js";

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: false, // 仅开发环境；生产按平台要求配置
});
await applyPostgresMigrations(pool);

const store = createPostgresSessionStore({
  pool,
  crypto: createAes256GcmCryptoProvider({
    primaryKeyId: "dev-v1",
    keys: { "dev-v1": keyBytes }, // 必须为 32 字节；生产替换为 KMS/Vault 实现
  }),
});
```

`beginRun` 原子占用会话；`completeRun` 通过 `expectedRevision` 防止静默覆盖，并在同一事务中保存新快照、完成运行记录和释放占用；失败路径使用 `failRun`。平台用户、租户和课程 ID 都是不透明字符串，不与平台表建立外键。

## 模型 API 层（模块化）

模型 API 层位于 `src/infrastructure/models/`；新增平台时实现 `ProviderDefinition`、注册到 `registry.ts`，并在 `.env.example` 登记环境变量。

- LongCat（OpenAI 兼容，接入点 `https://api.longcat.chat/openai/v1`）：https://longcat.chat/platform/docs/zh/
- DeepSeek：https://platform.deepseek.com/
- Kimi 国内站（moonshotai-cn）：https://platform.moonshot.cn/docs/intro

运行 `npm run list-models` 可查看全部已注册 provider 的模型、key 环境变量与文档链接，`PROVIDER=longcat`（配 `LONGCAT_API_KEY`）即可使用 LongCat。

## 环境变量

见 [.env.example](.env.example)。

| 变量 | 说明 |
| --- | --- |
| `PROVIDER` | `deepseek`（默认）、`moonshotai-cn` 或 `longcat` |
| `DEEPSEEK_API_KEY` | DeepSeek API key（首选测试 provider） |
| `MOONSHOT_API_KEY` | Moonshot/Kimi（api.moonshot.cn）key，provider id 为 `moonshotai-cn` |
| `LONGCAT_API_KEY` | LongCat key（https://api.longcat.chat/openai），provider id 为 `longcat`，文档见 <https://longcat.chat/platform/docs/zh/> |
| `MODEL_ID` | 模型 ID，默认按 provider 取（deepseek → `deepseek-v4-pro`，longcat → `LongCat-2.0`），以 `npm run list-models` 为准 |
| `THINKING_LEVEL` | 推理级别 `off`~`max`，默认 `off` |
| `EXEC_API_BASE` | 执行服务地址，默认 `http://localhost:1313`（真实沙箱） |
| `GO_JUDGE_API_BASE` | go-judge REST API 根地址，默认 `http://127.0.0.1:5050` |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | PostgreSQL 连接参数；核心不会自动读取，由宿主构造 `pg.Pool` 后注入 |
| `AUTH_SECRET` | Web 内测登录 Cookie HMAC 密钥（≥32 字符）；未设置时随机生成，重启后用户需重新登录 |
| `BETA_USERS_FILE` | 内测用户注册表路径，默认 `data/beta-users.json`（`npm run gen:beta-codes` 生成） |
| `WEB_COOKIE_SECURE` | `1` 强制登录 Cookie 附加 `Secure`（HTTPS 反代部署建议开启） |

## 执行后端协议（替换真实沙箱）

Code Pack 的 `ExecClient` 位于 `src/packs/code/exec-client.ts`；`run_code` 将 VFS 作为 `files` 提交：

```
POST {EXEC_API_BASE}/v1/exec
{ "sandbox": "python", "command": "run", "files": { "main.py": "print('hi')" } }

→ 200 { "id": "...", "ok": true, "duration": 143, "stdout": "hi", "stderr": "" }
```

实现 `ExecClient` 后注入 `createCodeMentorSession({ exec })`，或配置 `EXEC_API_BASE` 指向兼容服务。mock 仅用于离线演示。

### Judge Pack 与 go-judge

Judge Pack 使用两个动态工具组：

- `judge`：`list_judge_languages`、`run_judge_code`、`judge_code`、`submit_problem_solution`；
- `problem_cards`：`verify_problem` 先运行参考解答、示例和隐藏测试，成功后由 `publish_problem_card` 向前端发送不含参考答案/隐藏用例的结构化题目卡。

配置 `GO_JUDGE_API_BASE` 指向 go-judge REST API 根地址。默认语言配置与本地镜像一致：C (`gcc`)、C++ (`g++`) 和 Python 3；增加语言时需先在镜像安装运行时，再通过 `createHttpGoJudgeClient({ languages })` 注入命令配置。编译产物通过 `/file` 缓存复用于各测试用例，并在判题后删除。

Web 切换到 `judge` 后加载独立三栏工作台：可折叠/调宽的题目卡、Monaco Editor + 可调高测试结果区、Judge 教练对话。面板尺寸、折叠状态和每题代码草稿保存在浏览器本地；窄屏使用可恢复的题目/教练抽屉。编辑器“提交判题”先调用服务端 Judge，再把可信结果交给教练讲解。

## 下一步：接 HTTP / UI

`createCodeMentorSession()` / `createEnglishMentorSession()` 可直接按会话创建实例复用：

1. 每个会话持有一个 Pack Session
2. 把 `SessionEvent` 通过 SSE/WebSocket 转发给前端
3. 持久化 `session.exportSnapshot(currentRevision)`，恢复时通过 `snapshot` 配置注入

## 已核实的依赖 API 事实（v0.84.1）

实现基于对安装包 `.d.ts` 的实际核对，与任务描述的两处差异如下：

- moonshot provider 的模块路径是 `@pilore/pi-ai/providers/moonshotai-cn`（provider id `moonshotai-cn`），不存在 `providers/moonshot`
- `Type`（TypeBox）从 `@pilore/pi-ai` 导出，`@pilore/pi-agent-core` 不导出 `Type`
- `AgentTool.execute` 返回的 `AgentToolResult` 必须包含 `details` 字段

## 许可证

本项目采用仓库根目录中的 `LICENSE`（PiLore Source-Available License, Non-Commercial）。

- 允许学习、研究、非商业场景下使用、修改与分发
- 禁止任何商业使用，除非事先取得版权所有者书面授权

如需商业授权，请联系仓库维护者。
