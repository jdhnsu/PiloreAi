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
- Fluent（微软）风格 Web 界面：流式回答、工具调用卡片、实时工作区侧栏
- 可替换执行后端：兼容 codapi 风格 `POST /v1/exec` 协议，改一个环境变量即可切换

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
```

CLI 内命令：`/quit` 退出、`/abort` 中断当前运行、`/help` 帮助。

## 架构分层

```
├─ src/
│  ├─ models/        # 模型 API 层（模块化）：provider 注册表 + 各 provider 定义
│  │  ├─ index.ts      # createModelCollection() / DEFAULT_MODEL_IDS / PROVIDERS
│  │  ├─ registry.ts   # 注册表：新增 provider 只需追加一项
│  │  └─ providers/    # deepseek / moonshot-cn / longcat（含官方文档 URL）
│  ├─ vfs.ts          # 内存虚拟文件系统（Map<path, content>，路径规范化、list）
│  ├─ exec-client.ts  # codapi 风格执行后端 HTTP 客户端（POST /v1/exec）
│  ├─ personas.ts     # 目录扫描 agent-design/*.md + frontmatter 元数据解析（yaml）+ @老师 解析 + buildCatalog()
│  ├─ tools.ts        # AgentTool：write_file / read_file / run_code / adopt_persona（+ PersonaState 共享状态）
│  ├─ agent.ts        # Agent 组装工厂 createAgent()：基座/Persona 两套 systemPrompt + prepareNextTurn 换入 + beforeToolCall 权限拦截
│  ├─ session.ts      # 会话组件层：传输无关的 EduEvent 协议（Web / CLI / 其它项目共用）；@指定 结构性激活
│  ├─ render.ts       # 事件流 → 终端渲染（CLI 适配层用）
│  ├─ cli.ts          # CLI 适配层（遗留测试面）
│  ├─ server.ts       # Web 适配层：HTTP + SSE + 静态服务
│  └─ index.ts        # 组件公开导出（迁移到其它项目的入口）
├─ agent-design/      # Feynman / Socrates / Oris 老师设计文档（*.md）
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

`agent-design/*.md` 即「老师」的注册表：**新增一位老师只需放一个带 frontmatter 的 md 文件**，启动时目录扫描自动登记，无需改代码。

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
2. **选中后注入**：模型 `adopt_persona(key)` 或用户 `@key` → `prepareNextTurn` / 会话层把该老师全文换入 system prompt，下一轮 LLM 调用即生效；`adopt_persona("auto")` / `@pilore` 恢复基座
3. **权限强制**：active persona 的 `capabilities` deny 命中时 `beforeToolCall` 拦截工具并给出原因（如 Socrates 激活时覆盖已有文件 → 被拦），模型看到拦截原因后自我纠正

## 组件接口（迁移到其它项目）

核心是可移植的会话层 `src/session.ts`，不依赖任何传输层，事件协议为纯 JSON：

```ts
import { createEduSession } from "./src/index.js"; // 组件公开入口

const session = createEduSession(); // 可传 models/providerId/modelId/systemPrompt（测试可注入 fauxProvider）
await session.prompt("什么是闭包？", (event) => {
	// event: text_delta / tool_start / tool_end / persona / error / done ...
});
session.abort(); session.listFiles(); session.readFile("main.py");
```

`src/server.ts` 与 `src/cli.ts` 都只是它的两个适配器——把 `EduEvent` 换成 WebSocket 或嵌入其它 UI 框架即可复用。`adopt_persona` 是内部工具，会话层将其折叠为 `persona` 事件对外暴露，外部消费者无需感知 pi-agent-core。

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

## 执行后端协议（替换真实沙箱）

`run_code` 工具把整个 VFS 作为 `files` 对象提交：

```
POST {EXEC_API_BASE}/v1/exec
{ "sandbox": "python", "command": "run", "files": { "main.py": "print('hi')" } }

→ 200 { "id": "...", "ok": true, "duration": 143, "stdout": "hi", "stderr": "" }
```

替换真实后端（如 [codapi](https://github.com/nalgeon/codapi)）只需把 `EXEC_API_BASE` 指向兼容该协议的服务，代码无需改动；`ok: false` 会被转成错误工具结果让模型自我纠正。mock 服务（`mock/exec-server.ts`）不真正执行代码，只按规则模拟输出（提取 `print("字面量")`，否则返回说明/hello），仅用于无沙箱环境演示。

## 下一步：接 HTTP / UI

`createAgent()` 是无副作用的工厂，返回 `{ agent, vfs, model, models }`，可直接在 HTTP 服务中按会话创建实例复用：

1. 用任意 HTTP 框架（如 Hono/Express）暴露 `POST /chat`：每个会话持有一个 `createAgent()` 实例
2. 把 `agent.subscribe` 的事件流通过 SSE/WebSocket 转发给前端，渲染逻辑与 `src/render.ts` 一一对应（事件类型见 `pi-agent-core` 的 `AgentEvent`）
3. 把 `vfs` 的文件树作为侧栏展示，学生可直接看到"工作区"内容
4. 之后可替换执行后端为真实沙箱、增加多用户会话持久化（序列化 `agent.state.messages`）

## 已核实的依赖 API 事实（v0.84.1）

实现基于对安装包 `.d.ts` 的实际核对，与任务描述的两处差异如下：

- moonshot provider 的模块路径是 `@earendil-works/pi-ai/providers/moonshotai-cn`（provider id `moonshotai-cn`），不存在 `providers/moonshot`
- `Type`（TypeBox）从 `@earendil-works/pi-ai` 导出，`@earendil-works/pi-agent-core` 不导出 `Type`
- `AgentTool.execute` 返回的 `AgentToolResult` 必须包含 `details` 字段
