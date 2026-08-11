<div align="center">

<img src="assets/2d/pilore.png" alt="PiLore icon" width="112">

# PiLore

**AI 编码教育 Agent（核心组件）**

LLM → 工具调用（write_file / read_file / run_code）→ 远程沙箱执行 → 基于真实输出的讲解

<img src="assets/as1/robot_9.png" alt="PiLore 吉祥物" width="240">

</div>

PiLore 是一个 AI 辅助编程教育工具的核心 agent 组件，本阶段只包含命令行可验证的最小闭环。学生工作区是内存虚拟文件系统（VFS），代码执行发生在远程沙箱，本地不执行任何学习者代码。

**亮点**

- 内存 VFS + 远程沙箱：学习者代码绝不落地、绝不在本地执行
- 多「老师」教学人格：Feynman / Socrates / Oris，模型自动路由或 `@` 手动指定；**按需加载** —— 路由目录常驻，选中后才把方法论全文换入 system prompt
- 能力契约：每位老师用 frontmatter 声明允许/禁止的能力（deny-list），运行时强制拦截，文档与运行时解耦
- 传输无关的事件协议：`EduEvent` 纯 JSON 流，Web / CLI / 其它项目共用同一会话层
- **嵌入友好**：`createEduSession(config)` 一条接入，模型集合 / 老师集合 / 执行后端 / 工作区全部可注入，import 核心无任何副作用（不扫磁盘、不读 env、不发请求），见 [examples/embed-minimal.ts](examples/embed-minimal.ts)
- Fluent（微软）风格 Web 界面：流式回答、工具调用卡片、实时工作区侧栏
- 可替换执行后端：实现 `ExecClient` 接口，或用兼容 codapi 风格 `POST /v1/exec` 协议的服务，改一个环境变量即可切换

## 快速开始

```bash
npm install

# 1. 无 API key：跑内置演示链路（fauxProvider 脚本化 + 进程内 mock 执行服务）
npm run demo

# 2. 有 API key：
cp .env.example .env   # 填入 DEEPSEEK_API_KEY（首选）、MOONSHOT_API_KEY 或 LONGCAT_API_KEY

# 3. Web 界面（主要测试面，浏览器打开提示的地址；默认 8600 端口，被占用时自动回退 +1；
#    显式指定用 WEB_PORT=xxxx npm run web）：
npm run web            # 真实模型
npm run web:demo       # 无需 API key（fauxProvider 脚本化 + 进程内 mock 执行服务）

# CLI（遗留测试面，仍可用）：
npm run chat
#
# EXEC_API_BASE 默认指向真实执行后端 http://192.168.172.134:1313。
# 离线环境可改用本地 mock：npm run mock + EXEC_API_BASE=http://localhost:1313
#（若 1313 被 Windows Hyper-V 保留端口占用: PORT=13131 npm run mock，并同步改 EXEC_API_BASE）
```

其他命令：

```bash
npm run list-models        # 打印各 provider 可用模型，确认 MODEL_ID
npm run typecheck          # TypeScript 类型检查（不产出构建文件）
npm test                   # 单元测试（状态、快照、加密）
npm run test:postgres      # PostgreSQL 集成测试（读取 .env 的 DB_*，使用并清理临时 schema）
npm run test:agent         # Agent 核心离线测试（faux + mock，确定性，默认 3 轮）
npm run test:agent:real    # Agent 核心在线测试（真实模型，行为达成度评分，默认 3 轮平均值）
npm run test:agent:all     # 两者都跑
```

测试规格与评分模型见 `tests/TEST-SPEC.md`（用例清单、参数/预期/权重、S/A/B/C/D 等级）。切换在线测试模型：改 `.env` 的 `PROVIDER`/`MODEL_ID`/`THINKING_LEVEL`，或在命令后追加 `--provider x --model y --thinking off`，如：

```bash
npx tsx tests/run.ts --mode real --provider moonshotai-cn --model kimi-k2-0905-preview
```

CLI 内命令：`/quit` 退出、`/abort` 中断当前运行、`/help` 帮助。

## 架构分层

```
├─ src/
│  ├─ interfaces.ts   # 组件边界：EduAgentConfig 统一配置（models/personas/exec/vfs 全可注入）
│  ├─ models/         # 模型 API 层（模块化）：provider 注册表 + 各 provider 定义
│  │  ├─ index.ts       # createModelCollection() / DEFAULT_MODEL_IDS / PROVIDERS
│  │  ├─ registry.ts    # 注册表：新增 provider 只需追加一项
│  │  └─ providers/     # deepseek / moonshot-cn / longcat（含官方文档 URL）
│  ├─ vfs.ts          # 内存虚拟文件系统（Map<path, content>，路径规范化、list）
│  ├─ exec-client.ts  # ExecClient 边界接口 + codapi 风格 HTTP 实现（POST /v1/exec）
│  ├─ personas.ts     # 老师登记与解析：parsePersona（纯函数）/ loadPersonasFromDir /
│  │                  #   getDefaultPersonas（懒加载，import 不扫盘）/ @老师 解析 / buildCatalog()
│  ├─ tools.ts        # AgentTool：write_file / read_file / run_code / adopt_persona / update_teaching
│  │                  #   （执行后端与老师集合经 ToolDeps 注入，不硬编码）
│  ├─ agent.ts        # Agent 组装工厂：固定基座 systemPrompt + Persona 追加上下文 + 权限拦截
│  ├─ persona-context.ts # 内部 Persona 消息、稳定哈希与 convertToLlm 转换
│  ├─ telemetry.ts    # 可选的脱敏逻辑调用 / HTTP attempt / usage 观测
│  ├─ shared-state.ts # 教学状态单一事实源（activePersona / 按老师分桶的教学进度 / 切换护栏）
│  ├─ session.ts      # 会话组件层：传输无关的 EduEvent 协议（Web / CLI / 其它项目共用）
│  ├─ render.ts       # 事件流 → 终端渲染（CLI 适配层用）
│  ├─ cli.ts          # CLI 适配层（遗留测试面）
│  ├─ server.ts       # Web 适配层：HTTP + SSE + 静态服务
│  └─ index.ts        # 组件公开入口：全部对外 API（仓库内所有消费者均从这里导入）
├─ examples/          # 嵌入示例：embed-minimal.ts（无需 API key / agent-design/ / 远程沙箱）
├─ agent-design/      # Feynman / Socrates / Oris 内置老师设计文档（*.md，缺省老师集合）
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

1. `cli.ts` 收到用户输入 → `agent.prompt(text)`
2. Agent loop（`@earendil-works/pi-agent-core` 的 `Agent`）通过 `streamFn`（`models.streamSimple`）请求 LLM
3. LLM 返回工具调用 → agent 调度执行 `tools.ts` 中的工具：
   - `write_file` / `read_file` 操作 `vfs.ts` 的内存文件系统
   - `run_code` 把 VFS 全部文件作为 `files` POST 给执行服务（`exec-client.ts`）
4. 事件流（`agent.subscribe`）由 `render.ts` 实时渲染：流式文本、工具调用摘要、工具结果
5. LLM 基于工具结果继续下一轮，直到产出讲解文本并结束

### 依赖说明

- [`@earendil-works/pi-ai`](https://www.npmjs.com/package/@earendil-works/pi-ai)：统一 LLM API（models 集合、provider、流式事件协议）
- [`@earendil-works/pi-agent-core`](https://www.npmjs.com/package/@earendil-works/pi-agent-core)：agent loop / 工具调度 / 事件流
- [`yaml`](https://www.npmjs.com/package/yaml)：老师设计文档 frontmatter 元数据解析
- 不引入 `@earendil-works/pi-coding-agent`：其内置工具面向本地 fs / 进程，与本项目"内存 VFS + 远程沙箱"的模型不符

## Web 界面

Fluent（微软）风格单页应用，零前端依赖，由 `src/server.ts` 通过 SSE 推送 `EduEvent` 流式渲染：

- 流式回答 + markdown/代码块渲染、工具调用卡片（`write_file` / `run_code` 状态与输出）
- 顶栏与消息内显示当前「老师」（模型自动路由经 `adopt_persona` 声明，或用户 `@` 指定）
- `@feynman` / `@socrates` / `@oris` 直接指定教学方法（输入框上方也有快捷 chips）；`@pilore` 或老师激活时出现的「↩ 切回 PiLore」按钮可手动切回自动路由
- 老师是临时模式：模型判断教学阶段完成（讲解+检验通过）或话题切换时，会自动 `adopt_persona("auto")` 交还 PiLore 路由，也可直接切换到另一位老师
- 每条回复右下角显示本次回答的老师徽标（紫色 = 指定/自动路由到的老师，灰色 = PiLore 自动）
- 右侧「工作区」侧栏实时展示 VFS 文件并可查看内容

HTTP 接口（适配层与组件的边界，任何前端/其它服务都可消费）：

| 接口 | 说明 |
| --- | --- |
| `GET /` | 静态页面（web/） |
| `GET /api/state` | `{ busy, persona, model, demo }` |
| `GET /api/files` | `{ files: [{ path, content }] }` |
| `POST /api/chat` | `{ message }` → SSE 流，每帧 `data: <EduEvent JSON>`，以 `done` 结束 |
| `POST /api/persona` | `{ persona: "feynman"/"socrates"/"oris" }` 设置老师；`{ persona: null }` 切回自动路由 |
| `POST /api/abort` | 中止当前运行 |

## 老师设计文档与元数据（按需加载）

`agent-design/*.md` 是内置的「老师」集合：**新增一位老师只需放一个带 frontmatter 的 md 文件**，首次创建会话时才扫描登记（懒加载），无需改代码。嵌入其它项目时也可以完全绕开该目录，用 `parsePersona(source, fileName)` 从任意来源（字符串 / 数据库 / 配置中心）构造 `Persona[]` 并注入 `createEduSession({ personas })`。

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
2. **选中后追加**：模型 `adopt_persona(key)` 将方法论写入 toolResult；用户 `@key` 追加内部 Persona context，并在模型边界与下一条 user 消息合并。system prompt 全程固定，既有历史不重写；`auto` 通过同样的追加事件恢复路由
3. **权限强制**：active persona 的 `capabilities` deny 命中时 `beforeToolCall` 拦截工具并给出原因（如 Socrates 激活时覆盖已有文件 → 被拦），模型看到拦截原因后自我纠正

## 组件接口（嵌入到其他项目）

核心是可移植的会话层，统一配置对象 `EduAgentConfig`（`src/interfaces.ts`），所有依赖均有缺省值、全部可注入：

| 配置项 | 缺省值 | 说明 |
| --- | --- | --- |
| `models` | 内置 provider 注册表 | 自定义模型集合（如测试用 fauxProvider） |
| `providerId` / `modelId` | env `PROVIDER` / `MODEL_ID` | 模型选择 |
| `thinkingLevel` | env `THINKING_LEVEL`，缺省 `off` | 推理级别 |
| `systemPrompt` | `buildBasePrompt(personas)` | 自定义基座提示词 |
| `fetch` | `globalThis.fetch` | 自定义 provider HTTP transport，便于代理或测试 |
| `llmTelemetry` | 关闭 | 脱敏的逻辑调用、HTTP attempt/retry、前缀哈希与 usage 事件 |
| `vfs` | 新建空实例 | 自定义工作区（可预置学习者文件） |
| `personas` | `agent-design/` 懒加载 | 自定义老师集合（`parsePersona` 纯函数构造） |
| `exec` | `createHttpExecClient()` | 自定义执行后端（实现 `ExecClient` 接口） |
| `maxTurns` | 不限 | 单次 prompt 的 LLM 回合护栏 |

import 核心不产生任何副作用（不扫磁盘、不读 env、不发请求），缺省值在创建会话时才解析：

```ts
import { createEduSession, parsePersona } from "./src/index.js";

// 最小用法：全部缺省
const session = createEduSession();

// 完全替换：自有老师 + 自有沙箱 + 自有模型，不依赖 agent-design/ 与 EXEC_API_BASE
const session = createEduSession({
  personas: [parsePersona(myTeacherMd, "guide.md")],  // 从字符串/数据库/配置中心构造
  exec: { exec: async (req) => mySandbox.run(req) },  // 实现 ExecClient
  models: myModels, providerId: "x", modelId: "y",
});

await session.prompt("什么是闭包？", (event) => {
  // event: text_delta / tool_start / tool_end / persona / error / done ...
});
session.setPersona("guide");   // 也可直接切换老师（null = 自动路由）
session.abort(); session.listFiles(); session.readFile("main.py");

// 快照是纯 JSON，可交给独立持久化层；恢复时会校验版本、persona 和消息结构
const snapshot = session.exportSnapshot();
const restored = createEduSession({ snapshot });
```

完整可运行示例见 [examples/embed-minimal.ts](examples/embed-minimal.ts)（`npm run example:embed`，无需 API key）。
`src/server.ts` 与 `src/cli.ts` 都只是它的两个适配器——把 `EduEvent` 换成 WebSocket 或嵌入其它 UI 框架即可复用。`adopt_persona` 是内部工具，会话层将其折叠为 `persona` 事件对外暴露，外部消费者无需感知 pi-agent-core。

### PostgreSQL 会话持久化

核心导出 `EduSessionSnapshotV2`，并可将 V1 恢复为 V2（数据库记录在下一次成功保存时惰性升级），不直接访问数据库。模式 B 部署可用 `PostgresSessionStore` 管理会话与运行记录；默认 schema 为 `pilore`，也可显式注入其它合法 schema。正文与 VFS 快照在写库前通过可替换的 `CryptoProvider` 加密：

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

模型 API 层独立为 `src/models/`，与新模型平台对接只需三步：在 `providers/` 下实现一个 `ProviderDefinition`（pi-ai 的 `createProvider` 工厂 + 元数据），追加进 `src/models/registry.ts`，然后在 `.env.example` 登记对应环境变量。每个 provider 定义都带有官方文档 URL（`docsUrl`），例如：

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
| `EXEC_API_BASE` | 执行服务地址，默认 `http://192.168.172.134:1313`（真实沙箱） |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | PostgreSQL 连接参数；核心不会自动读取，由宿主构造 `pg.Pool` 后注入 |

## 执行后端协议（替换真实沙箱）

执行后端是可插拔的 `ExecClient` 接口（`src/exec-client.ts`）：`run_code` 工具把整个 VFS 作为 `files` 对象提交，缺省实现为 codapi 风格 HTTP 客户端：

```
POST {EXEC_API_BASE}/v1/exec
{ "sandbox": "python", "command": "run", "files": { "main.py": "print('hi')" } }

→ 200 { "id": "...", "ok": true, "duration": 143, "stdout": "hi", "stderr": "" }
```

替换真实后端有两种方式：实现 `ExecClient` 接口注入 `createEduSession({ exec })`（进程内沙箱/子进程均可），或把 `EXEC_API_BASE` 指向兼容该协议的服务（如 [codapi](https://github.com/nalgeon/codapi)），代码无需改动；`ok: false` 会被转成错误工具结果让模型自我纠正。mock 服务（`mock/exec-server.ts`）不真正执行代码，只按规则模拟输出（提取 `print("字面量")`，否则返回说明/hello），仅用于无沙箱环境演示。

## 下一步：接 HTTP / UI

`createAgent()` 是无副作用的工厂，返回 `{ agent, vfs, model, models, shared, personas }`，可直接在 HTTP 服务中按会话创建实例复用：

1. 用任意 HTTP 框架（如 Hono/Express）暴露 `POST /chat`：每个会话持有一个 `createAgent()` 实例
2. 把 `agent.subscribe` 的事件流通过 SSE/WebSocket 转发给前端，渲染逻辑与 `src/render.ts` 一一对应（事件类型见 `pi-agent-core` 的 `AgentEvent`）
3. 把 `vfs` 的文件树作为侧栏展示，学生可直接看到"工作区"内容
4. 之后可替换执行后端为真实沙箱、增加多用户会话持久化（序列化 `agent.state.messages`）

## 已核实的依赖 API 事实（v0.84.1）

实现基于对安装包 `.d.ts` 的实际核对，与任务描述的两处差异如下：

- moonshot provider 的模块路径是 `@earendil-works/pi-ai/providers/moonshotai-cn`（provider id `moonshotai-cn`），不存在 `providers/moonshot`
- `Type`（TypeBox）从 `@earendil-works/pi-ai` 导出，`@earendil-works/pi-agent-core` 不导出 `Type`
- `AgentTool.execute` 返回的 `AgentToolResult` 必须包含 `details` 字段
