# AGENTS.md — PiLore

PiLore 是一个 **AI 编码教育 agent 的核心组件**，设计目标是**嵌入到其他系统中**：LLM → 工具调用 → 远程沙箱执行 → 基于真实 stdout/stderr 的讲解。
`src/cli.ts` 与 `src/server.ts`+`web/` 只是测试/演示用的适配层，改核心逻辑时不要与它们耦合。

## 核心架构（改代码前先读这些）

按依赖方向读：`vfs / exec-client / personas → interfaces → tools → shared-state → agent → session → index`。

- `src/index.ts` — **唯一公开入口**：全部对外 API 从这里导出。仓库内所有消费者（CLI / Web / scripts / tests / examples）一律从 `index.js` 导入，**不要新增深层路径导入**（`./agent.js`、`./personas.js` 等），否则内部重组会破坏嵌入方。
- `src/interfaces.ts` — 组件边界：`EduAgentConfig` 统一配置对象。models / providerId / modelId / thinkingLevel / systemPrompt / vfs / **personas / exec** / maxTurns 全部可注入，缺省值在 `createAgent` 内部按需解析。**import 核心不产生任何副作用**（不扫磁盘、不读 env、不发请求）——新增依赖时保持这条不变式。
- `src/agent.ts` — `createAgent(config)` 工厂，核心组装点：
  - 两套 systemPrompt：`buildBasePrompt(personas?)`（角色+路由规则+目录+执行纪律+环境适配，**不含方法论全文**）与 `buildPersonaPrompt()`（persona 激活后换入方法论全文）。`getSystemPrompt()` 是缺省基座 prompt 的懒求值入口（原 `SYSTEM_PROMPT` 常量已移除，因为它是 import 时求值）。
  - `prepareNextTurn` 钩子：persona / 教学进度变化时换入或换回 systemPrompt。
  - `beforeToolCall` 钩子：按 active persona 的 `capabilities` deny-list 拦截工具（`write_file` 细分为 `file.write` 新建 / `file.modify` 覆盖已有）。
  - `maxTurns` 是单次 prompt 的 LLM 回合护栏（测试防烧 token），`agent_start` 时清零。
  - 返回值含 `personas`：该 agent 实际使用的老师集合（自定义或内置默认），@ 解析与 prompt 构建以它为准。
- `src/session.ts` — 传输无关的会话层，`createEduSession(config)`；personas 只解析一次（createAgent / @ 解析 / setPersona 共享同一数组）。对外只发 `EduEvent` 纯 JSON 事件流（text_delta / tool_start / tool_end / persona / error / done）。`adopt_persona` 是内部工具，对外折叠为 `persona` 事件。`@老师` 前缀与 `setPersona()` 走结构性激活（不计数，不受护栏限制）。
- `src/shared-state.ts` — persona 状态与教学进度的**唯一事实源**（工具、agent 钩子、session 层都读它，不要另建副本）。含同轮非 auto 切换护栏 `MAX_SWITCHES_PER_TURN = 2`；预算按「一次用户查询」计，`resetUserTurn()` 在每轮 prompt 开始时调用，**不能放 prepareNextTurn**（会在工具回合间被清零）。
- `src/tools.ts` — 5 个工具：`write_file` / `read_file` / `run_code` / `adopt_persona` / `update_teaching`。执行后端与老师集合经 `ToolDeps { exec, personas }` **注入**（不硬编码 import）。文件不存在等错误直接 throw → 自动转 isError 工具结果让模型自纠。
- `src/personas.ts` — 老师登记与解析。**import 时不扫磁盘**：`getDefaultPersonas()` 首次调用才扫 `agent-design/`（懒加载+记忆化）；`parsePersona(source, fileName)` 是纯函数，嵌入方可从字符串/数据库/配置中心构造老师；`loadPersonasFromDir(dir?)` 扫自定义目录。`buildCatalog` / `getPersona` / `resolveMention` 全部接受可选 personas 参数。内置集合目录缺失或文档非法在 `getDefaultPersonas()` 调用时报错，而非 import 时。
- `src/exec-client.ts` — `ExecClient` 边界接口（`exec(request): Promise<ExecResponse>`）+ codapi 风格 HTTP 缺省实现 `createHttpExecClient(baseUrl?)`。`baseUrl` 省略时每次调用读 `EXEC_API_BASE` env（缺省指向真实沙箱），便于测试/演示动态切换。
- `src/vfs.ts` — 内存虚拟文件系统（`Map<path, content>`），学习者代码绝不落本地磁盘。
- `src/models/` — 模型 API 层：`registry.ts` 注册表 + `providers/`（deepseek / moonshotai-cn / longcat）。新增 provider = 实现 `ProviderDefinition` + 注册表追加一项 + `.env.example` 登记。

## 嵌入契约（改公开 API 前必读）

- 嵌入方只依赖 `src/index.ts` 的导出。改签名/删导出 = breaking change：先查 in-repo 消费者与 `tests/`、`examples/` 的用法。
- 新增可注入依赖的套路：接口定义放 `interfaces.ts`（或所属模块），`EduAgentConfig` 加可选字段，`createAgent` 内部解析缺省值，`createTools` 的 `ToolDeps` 透传，`index.ts` 导出接口与缺省实现。
- 教学逻辑（路由规则 / 护栏 / 进度分桶）与注入机制正交：注入点只替换「老师是谁、代码在哪跑、用哪个模型」，不改行为语义。

## 教学系统设计（重点）

- 自动路由模式：基座 prompt 只含目录（`buildCatalog()` 由 frontmatter 的 name+description 生成，是路由**唯一依据**）；模型判断该用哪种方法时调 `adopt_persona(key)`，`auto` = 交还路由。
- 按需加载：目录常驻，**选中后才把方法论全文换入 system prompt**；`adopt_persona("auto")` / `@pilore` 恢复基座。
- 教学进度：`update_teaching` 按 persona key 分桶保存（`teachingByPersona`），切老师不丢、切回可续讲；无激活 persona 时调用会抛错。
- 能力契约：frontmatter 的 `capabilities` 是 deny-list（省略=允许），能力词汇（file.write / file.modify / file.read / exec.run）与运行时工具解耦。

## 关键约定

- ESM：所有相对导入必须带 `.js` 后缀（`./personas.js`）。
- 环境变量（见 `.env.example`）：`PROVIDER`（deepseek 默认）/ `DEEPSEEK_API_KEY` / `MOONSHOT_API_KEY` / `LONGCAT_API_KEY` / `MODEL_ID` / `THINKING_LEVEL` / `EXEC_API_BASE`。env 只是缺省值来源，一切都能被 config 注入覆盖。
- 依赖事实（v0.84.1）：`Type`（TypeBox）从 `@earendil-works/pi-ai` 导出；`AgentToolResult` 必须含 `details` 字段；**不要**引入 `@earendil-works/pi-coding-agent`（面向本地 fs/进程，与本项目模型不符）。

## 命令

```bash
npm run typecheck         # tsc --noEmit
npm test                  # 单元测试（src/shared-state.test.ts）
npm run test:agent        # Agent 核心离线测试（faux + mock，确定性，无网络，含 OIN 注入用例）
npm run test:agent:real   # 在线测试（真实模型，行为达成度评分，需 .env key）
npm run test:agent:all    # 两者
npm run list-models       # 打印各 provider 可用模型
npm run demo / web:demo   # 无需 API key 的演示（fauxProvider + 进程内 mock）
npm run example:embed     # 最小嵌入示例（自定义 personas + exec，无需 API key）
```

测试规格唯一事实源：`tests/TEST-SPEC.md`（用例清单、判定口径、评分模型，脚本行为与规格不符以规格为准并修正脚本）。在线测试可用 `npx tsx tests/run.ts --mode real --provider x --model y --thinking off` 覆盖配置。

## 已知坑

- 本地默认 `EXEC_API_BASE` 指向真实远程沙箱 `http://192.168.172.134:1313`；离线用 `npm run mock` + `EXEC_API_BASE=http://localhost:1313`（Windows 上 1313 可能被 Hyper-V 保留：`PORT=13131 npm run mock` 并同步改 EXEC_API_BASE）。测试套件经 `tests/harness/exec-mock.ts` 注入进程内 mock，不依赖外网。
- mock 执行服务不真正运行代码，只提取 `print("字面量")` 模拟输出。
- `run_code` 的 python 沙箱入口固定 `main.py`，非 main.py 的 entry 会自动别名挂载。
- 设计文档写的是「本地文件 + 终端」，agent 环境只有 VFS + 远程沙箱：`agent.ts` 的 `TOOL_ADAPTATION` 统一翻译语义，改方法文档时保持口径一致。
- 改 `agent-design/*.md` 时 frontmatter 必须有 `name` / `description`，`capabilities` 值只能是 `allow`/`deny`；缺 frontmatter 或解析失败会在 `getDefaultPersonas()` 首次调用时报错（懒加载后不再炸 import）。
- 在线测试很烧 token：改 prompt / 路由规则后优先跑离线套件，再跑 `test:agent:real`。
