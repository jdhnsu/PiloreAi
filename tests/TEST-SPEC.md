# PiLore Agent 核心测试规格(TEST-SPEC)

> 本文件是 Agent 核心测试套件的**唯一事实来源**:定义被测对象、用例清单、每条用例的输入/预期/判定口径、两套评分模型、运行方式与结果解读。实现与文档以本文件为准;若脚本行为与规格不符,以规格为准并修正脚本。

- 被测范围:Agent 核心、会话快照、加密/持久化兼容层、PostgreSQL 适配器与执行后端协议。
- 驱动方式:离线 = `fauxProvider`(脚本化回复)+ 进程内 mock exec,确定性、无需网络;在线 = 真实 LLM provider(读 `.env` / 环境变量的 API key)。
- 运行:`npm test`(组件单测)、`npm run test:postgres`(持久化集成)、`npm run test:agent`(离线)、`npm run test:agent:real`(在线)。详见 [§4 运行方式](#4-运行方式)。

---

## 1. 被测参数总览

| 参数族 | 覆盖内容 |
| --- | --- |
| 工具契约 | `write_file`(新建/覆盖/内容回显)、`read_file`(存在/缺失)、`run_code`(空工作区/不存在的入口/python 别名/失败回传) |
| 教学方法 | `adopt_persona`(合法 key / 未知 key / auto)、persona systemPrompt 换入、`update_teaching`(阶段/主题/已覆盖/待展开/跨 persona 隔离/未激活) |
| 护栏 | 同轮切换次数上限、同 key 重复声明、用户 `@` 路径不受限、auto 交还 |
| 会话协议 | `EduEvent` 序列、persona 事件单发与状态一致、busy 互斥、abort 后可重发 |
| 路径/VFS 边界 | `normalizePath`(越界/空/反斜杠/`.`/`..`/重复分隔符)、read 缺失、clear |
| 执行后端 | `simulate` 三分支、`exec-client` 请求/响应/非 2xx/连接失败 |
| 依赖注入 | 自定义 personas 集合注入（`parsePersona` 内存构造）、自定义 `ExecClient` 注入（不依赖 env/网络） |
| 会话持久化 | 快照 JSON 往返/恢复/非法数据、AES-256-GCM/AAD/key rotation、PostgreSQL migration/加密/互斥/revision/失败清理、标题派生/list 过滤排序、内存版存储同语义 |
| 在线行为 | 真实模型的路由选择(三类问题→三种 persona)、执行纪律(写码必跑、基于真实输出)、多轮教学进度维护与交还 |

---

## 2. 离线测试用例(确定性,PASS/FAIL)

离线用例全部用 `fauxProvider` + mock exec 驱动,同一用例可复现 100%。每条用例列出:输入、预期结果、判定口径、权重。

**计分**:每条用例含若干**子断言**;子断言 0/1;用例得分 = 通过子断言数 / 总子断言数。聚合公式见 [§5.1](#51-离线确定性)。

### OVF-01 `normalizePath` 规范化与越界防护
- 维度:边界 · 权重:2
- 输入:`" a/b "`、`"a\\b"`(反斜杠)、`"//a//b//"`、`"./a"`、`"a/./b"`、`"a/../b"`、`"../x"`、`"a/../../x"`、`""`。
- 预期:前五类归一为合法相对路径(`a/b` 等,不抛错);`a/../b → b`;`../x`(根级越界)与 `a/../../x` 与空串抛出 `路径越界` / `路径不能为空` / `无效路径` 之一。
- 判定:`normalizePath` 返回值逐项比对;异常路径用 `assert.throws`。

### OVF-02 `VirtualFS` 读写与清空
- 维度:边界 · 权重:1
- 输入:`write("main.py", X)` → `has` → `read` → `list` → `delete` → `clear`。
- 预期:read 返回原内容;list 有序;read 缺失文件抛 `文件不存在`;delete 返回布尔;clear 后 list 为空。

### OTL-01 工具链路:write_file → run_code → 讲解(端到端)
- 维度:工具纪律 · 权重:3
- 输入:faux 三步——
  1) `write_file({path:"fib.py", content:"print(\"斐波那契前 10 项:\")\nprint(\"0 1 1 2 3 5 8 13 21 34\")"})`(stopReason = `toolUse`);
  2) `run_code({sandbox:"python", entry:"fib.py"})`(toolUse);
  3) 纯文本总结(stop)。
- 预期:write_file 后 `vfs.list()` 含 `fib.py`;run_code 工具结果 stdout 含 mock 提取的斐波那契子串;最终 assistant 文本存在。
- 判定:工具调用序列恰为 `["write_file", "run_code"]`;两个工具结果 `isError=false`;run_code 结果文本含 `0 1 1 2 3`;对话文本非空。

### OTL-02 `run_code` 空工作区报错
- 维度:工具纪律 · 权重:2
- 输入:faux 直接喂 `run_code({sandbox:"python", entry:"main.py"})`,VFS 无任何文件。
- 预期:工具结果 `isError=true`,错误含 `工作区为空`(模型据此自纠)。

### OTL-03 `run_code` 入口文件不存在
- 维度:工具纪律 · 权重:1
- 前置:先 `write_file("main.py")`;再喂 `run_code({sandbox:"python", entry:"nope.py"})`。
- 预期:isError 含 `工作区不存在 nope.py`。

### OTL-04 `read_file` 存在 / 缺失
- 维度:工具纪律 · 权重:1
- 前置:写 `a.txt`;faux 依次 `read_file({path:"a.txt"})` → `read_file({path:"missing.txt"})`。
- 预期:第一个成功且内容一致;第二个 isError 含 `文件不存在`。

### OPR-01 `adopt_persona` 追加方法论 + 固定 systemPrompt
- 维度:教学行为 · 权重:3
- 输入:faux:1) `adopt_persona({persona:"socrates"})`(toolUse);2) 纯文本。
- 预期:切换后 `session.persona.key === "socrates"`;systemPrompt 仍为自动路由基座；`adopt_persona` toolResult 含 Persona 方法论与当前进度；persona 事件 source = `model` 且只出现一次。
- 判定:activePersona、固定 systemPrompt、toolResult 方法论、事件序列中 persona 事件恰 1 次且值 `socrates`。

### OPR-02 `update_teaching` 维护与跨 persona 隔离
- 维度:教学行为 · 权重:2
- 输入:faux:1) adopt socrates;2) `update_teaching({stage:"讲解", topic:"闭包", covered:["闭包定义"]})`;3) adopt oris;4) `update_teaching({stage:"拆解"})`。
- 预期:Socrates 记忆含 topic=闭包;Oris 记忆独立(stage=拆解,topic≠闭包);结束在 oris。
- 判定:`edu.shared.getTeaching()` 按 key 校验。注:同一轮 adopt 至多 2 次(护栏),「切回后进度仍在」由 `tests/unit/shared-state.test.ts` 单测覆盖。

### OPR-03 未激活时 `update_teaching` 报错
- 维度:教学行为 · 权重:1
- 输入:faux 直接喂 `update_teaching({stage:"x"})`,无 persona 激活。
- 预期:isError 提示先 adopt_persona。

### OGD-01 同轮 3 次切换被拦截
- 维度:护栏 · 权重:3
- 输入:faux 连续 1)socrates 2)oris 3)feynman(均为 toolUse,同一轮)。
- 预期:第 3 次 isError 含 `上限`;最终 `activePersona` = oris。

### OGD-02 同 key 重复声明被拦截
- 维度:护栏 · 权重:2
- 输入:faux:1) socrates;2) socrates。
- 预期:第 2 次 isError 含 `重复`。

### OGD-03 用户 `@老师` 路径不受限(会话层)
- 维度:护栏 · 权重:2
- 输入:`session.setPersona("feynman")`(不走工具),连切 5 次,再 `setPersona(null)`。
- 预期:每次 `session.persona` 即时更新且不被护栏拦截;null 清空回自动路由。

### OSS-01 一轮事件序列(EduEvent 协议)
- 维度:会话协议 · 权重:3
- 输入:OTL-01 相同的 faux 脚本。
- 预期:按序收到 `start` → `persona?` → `tool_start(write_file)` → `tool_end` → `tool_start(run_code)` → `tool_end` → `text_delta` → `message_end` → `done`;`done.errorMessage` 为空。
- 判定:收集事件数组,校验顺序子序列与字段。

### OSS-02 persona 事件单发且与状态一致
- 维度:会话协议 · 权重:2
- 输入:见 OPR-01。
- 预期:persona 事件恰好 1 次(model 来源),且与结束后 `session.persona` 一致。

### OSS-03 busy 互斥
- 维度:会话协议 · 权重:2
- 输入:一次 prompt 未结束时再次调用 `prompt`。
- 预期:第二次 prompt 抛 `上一轮对话还在进行…`；busy 时 `setPersona` 同样拒绝；第一轮结束后再调用成功。

### OSS-04 abort 后可重发
- 维度:会话协议 · 权重:2
- 输入:用 faux `deferred` 挂起的响应;prompt 后立即 `agent.abort()`;等待 resolve;再 `prompt`。
- 预期:abort 后 prompt 正常 resolve(不抛);`agent.state.errorMessage` 被写(含 `aborted`);第二次 prompt 可成功。

### OEX-01 mock `simulate` 三分支
- 维度:执行后端 · 权重:2
- 输入:`{"main.py":"print(\"a\") \n print(\"b\")"}`;`{"m.py":"print(x)"}`;`{"m.py":"print('a')"→ 无 print }`(三种)。
- 预期:字面量→ stdout 为 `a\nb`;非字面量→ 文案含 `参数不是字符串字面量`;无 print→ `hello`;stderr 恒为空。

### OEX-02 `exec-client` 成功路径(与 mock 集成)
- 维度:执行后端 · 权重:2
- 输入:随机端口 mock `POST /v1/exec`;`execCode({ sandbox:"python", command:"run", files })`。
- 预期:resolve 对象含 `ok/id/duration/stdout`;stdout 与 `simulate` 一致。

### OEX-03 `exec-client` 错误路径
- 维度:执行后端 · 权重:1
- 输入:非 200(404)与连接失败(指向未监听端口)。
- 预期:非 200 抛 `HTTP 404 …`;连接失败抛 `无法连接代码执行服务 …`。

### OIN-01 自定义 personas 集合可注入
- 维度:教学行为 · 权重:2
- 输入:用 `parsePersona` 从内嵌字符串构造自定义老师(`guide`),经 `agentOptions: { personas }` 注入;faux 依次 adopt `guide` → `update_teaching` → 文本。
- 预期:`edu.shared.activePersona.key === "guide"`;`adopt_persona` toolResult 含自定义方法论正文;`getTeaching("guide")` 有进度;`edu.personas` 恰为注入的数组。
- 判定:全部断言不经 agent-design/ 磁盘文件,纯内存构造。

### OIN-02 自定义 ExecClient 可注入
- 维度:执行后端 · 权重:2
- 输入:自实现 `ExecClient`(记录调用、返回固定 stdout `INJECTED_OUTPUT`),经 `agentOptions: { exec }` 注入;faux write_file → run_code → 文本。
- 预期:注入后端恰被调用 1 次且请求 files 完整;run_code 工具结果文本含 `INJECTED_OUTPUT`(不依赖 EXEC_API_BASE / 网络)。

### SNP-01 会话快照 V2 导出、恢复与 V1 惰性迁移（`npm test`）
- 输入：含 persona context、教学进度、VFS 和消息历史的 `EduSessionSnapshotV2` 经 JSON 往返；另将 V1 注入 `createEduSession({ snapshot })`。
- 预期：状态完整恢复且导出副本不反向修改会话；V1 规范化为 V2 并补入内部 Persona 上下文；未知版本、未知 persona、非法路径和损坏消息明确失败。

### TEL-01 请求级缓存观测与脱敏（`npm test`）
- 输入：模拟同一逻辑调用先返回 HTTP 503、再返回 200，并给最终 assistant usage。
- 预期：记录 1 次 logical request、2 次 HTTP attempt、最终 usage 与成功 request ID；事件不含 system prompt、学生消息、认证信息或 URL query 明文。

### TEL-02 Persona 上下文确定性转换（`npm test`）
- 输入：内部 Persona context 后跟 user 消息，重复执行 `convertPiLoreMessages`。
- 预期：两次转换字节语义一致，只生成一个 provider user message；未配对的末尾内部上下文不发送。

### CRY-01 AES-256-GCM 加密兼容层（`npm test`）
- 输入：32 字节主密钥、多 keyId、固定 CryptoContext(AAD)，以及篡改密文/错误 revision/错误密钥。
- 预期：正常密文可往返；密文不含明文；篡改、AAD 不匹配、错误 key 和非法密钥长度全部失败。

### PGS-01 PostgreSQL 会话生命周期（`npm run test:postgres`）
- 输入：在随机临时 schema 中重复执行 migration，create/load → beginRun → completeRun → delete。
- 预期：migration 幂等；快照与审计字段不含明文；active run 拦截并发；完成后 revision +1；旧 revision 冲突；删除级联运行记录。

### PGS-02 PostgreSQL 失败恢复（`npm run test:postgres`）
- 输入：beginRun 后调用 failRun，再次 beginRun。
- 预期：运行标记 failed、错误码落库、active_run_id 清空，原 revision 下允许重试；测试结束删除临时 schema。

### PGS-03 PostgreSQL 会话列表与标题（`npm run test:postgres`）
- 输入：同一身份建两个会话（一空快照、一含用户消息）+ 另一身份一个会话；空快照会话完成首轮运行。
- 预期：`list` 只返回匹配身份、按 updatedAt 降序；标题两条派生路径——空快照创建时为空、首轮 completeRun 后由首条用户消息派生，含消息创建时 create 即派生；未知身份返回空数组。

### MEM-01 内存版 SessionStore 与标题派生（`npm test`）
- 输入：`createInMemorySessionStore` 全生命周期 + `deriveSessionTitle`（空白/超长/块内容）。
- 预期：与 PostgreSQL 版同语义——revision/互斥/冲突/不存在错误、failRun 解锁、快照深拷贝隔离、list 按身份与 courseId 过滤且 updatedAt 降序、标题派生规则一致。

---

## 3. 在线测试用例(真实模型,行为达成度)

在线用例使用**行为达成度**评分——不追求字面命中,每条规则按达成程度给 0 / 0.5 / 1,再按权重汇总。全部经 `createEduSession`(复用产品会话路径)跑;`maxTurns` 护栏默认 8;默认 3 轮取平均(受 `--iterations` 控制)。全部规则均可由程序判定(基于 evidence:toolCall 序列、toolResult 文本、persona 状态、teaching 快照、最终文本)。

示例规则引用 `evidence` 字段定义见 [§5.4](#54-evidence-字段)。

### ORT-01 路由:抽象话题 → Feynman
- 维度:在线路由 · 权重:3
- 输入:`"太抽象了,完全听不懂,能打个比方给我讲讲什么是闭包吗?"`
- 规则:
  - R1 调用了 `adopt_persona`(0.5)且值恰为 `feynman`(1);未调用 = 0。
  - R2 最终文本出现 Feynman 风格特征(类比/**复述**/**费曼**/「讲给小朋友听」等)0/0.5/1。
  - R3 教学结束调用 `adopt_persona("auto")` 交还 = 1,否则 0。
- 优秀表现 0.9~1.0;一般 0.5~0.7。

### ORD-02 原理辨析 → Socrates
- 维度:在线路由 · 权重:3
- 输入:`"== 和 is 有什么区别?给我讲透原理,并辨析易混淆点。"`
- 规则:
  - R1 adopt 恰为 `socrates`(1)/ 其它方法(0.5)/ 未调用(0)。
  - R2 文本含「是什么/为什么/怎么用/易错点|容易混」结构特征 0/0.5/1。
  - R3 结尾含自测/练习题问句 = 1,否则 0。

### ORD-03 前置补基础 → Oris
- 维度:在线路由 · 权重:3
- 输入:`"我想学 Django,但连 HTTP 都不太懂,该从哪开始?"`
- 规则:
  - R1 adopt 恰为 `oris` 1 / 其它方法 0.5 / 未调用 0。
  - R2 文本出现「拆解/依赖/脚手架/步骤」等搭脚手架特征 0/0.5/1。
  - R3 结语有「跟得上吗/要不要展开」等收口 0/0.5/1。

### ORD-04 事实问答不触发 persona
- 维度:在线路由 · 权重:2
- 输入:`"Python 里怎么读一个 txt 文件?"`(简单事实)
- 规则:R1 未调用任何 adopt_persona = 1;调用了 = 0.5 且按内容是否简洁扣分。

### ORD-05 执行纪律:写码必运行
- 维度:工具纪律 · 权重:3
- 输入:`"帮我写个斐波那契前 10 项的程序,并运行给我看。"`
- 规则:
  - R1 `write_file` 出现 ≥1 = 1。
  - R2 `run_code` 出现 ≥1 = 1。
  - R3 最终文本含真实 stdout(准则字串如 `1 1 2 3`) = 1;若结果文本为 isError 的解释算 0.5。
  - R4 无虚造输出(文本未把 stdout 写成不含 mock/真实输出的猜测)= 否 0.5。

### ORD-06 不凭空猜输出(bug 代码)
- 维度:工具纪律 · 权重:3
- 输入:给一段会在运行时抛错的代码(`print(1/0)`),要求「别运行,直接说输出」。
- 规则:
  - R1 仍然调用了 run_code = 0.5;且结果含错误信息 = 1。
  - R2 文本没编造「输出为 0」等假输出 = 1。
  - R3 依实际错误解释原因 = 1。

### ORD-07 多轮:教学进度维护
- 维度:教学行为 · 权重:3
- 输入:第 1 问(见 ORD-03)→ 第 2 问 `"那 GET 和 POST 有区别吗?"` → 第 3 问 `"懂了,我们继续。"`
- 规则:
  - R1 第 2 轮保持同一条 persona(未切走)= 1;切换了 = 0.5。
  - R2 期间 `update_teaching` 至少 1 次(stage 或 topic 变化)= 1。
  - R3 第 3 轮触发 `adopt_persona("auto")` 交还 = 1,否则 0。

### ORD-08 收尾自测
- 维度:教学行为 · 权重:2
- 输入:`"用 Python 讲一下装饰器,并出一个自测题。"`
- 规则:R1 结尾含问句/题目 = 1;R2 全程使用同一方法未乱换 = 1。

---

## 4. 运行方式

```
npm test                    # 状态、快照、加密组件单测
npm run test:postgres       # PostgreSQL 集成（读 PILORE_TEST_DATABASE_URL 或 .env DB_*，临时 schema）
npm run test:agent          # 离线:faux + mock,默认 3 轮
npm run test:agent:real     # 在线:真实模型,默认 3 轮
npm run test:agent:all      # 两者都跑
npx tsx tests/run.ts --mode offline --iterations 5 --filter "OVF"
npx tsx tests/run.ts --mode real --provider deepseek --model deepseek-v4-pro --thinking off --iterations 3 --max-turns 8
```

| 参数 | 说明 | 默认 |
| --- | --- | --- |
| `--mode` | `offline` / `real` / `all` | `offline` |
| `--iterations` | 循环轮数(在线取平均) | 离线 3 / 在线 3 |
| `--filter` | 用例 ID 子串过滤 | 全跑 |
| `--provider` | 在线覆盖 provider | 读 `.env` `PROVIDER` |
| `--model` | 在线覆盖 model | 读 `.env` `MODEL_ID`(缺省该 provider 默认) |
| `--thinking` | 在线覆盖思考级别 | 读 `.env` `THINKING_LEVEL` |
| `--max-turns` | 单 prompt LLM 回合护栏 | 8(在线) |
| `--report-dir` | 报告目录 | `tests/report` |

**模型切换**:改 `.env`(`PROVIDER` / `MODEL_ID` / `THINKING_LEVEL`)或运行时加参数。示例:

```bash
PROVIDER=moonshotai-cn MODEL_ID=kimi-k2-0905-preview npm run test:agent:real
npx tsx tests/run.ts --mode real --provider longcat --model LongCat-2.0 --thinking off
```

离线不依赖网络/key;在线依赖已配置的 key,缺失时用例标记 `skipped:no-key` 并出口。

---

## 5. 评分模型

### 5.1 离线(确定性)
- 子断言 0/1;用例得分 = 通过子断言数 / 子断言总数(0~1)。
- 维度得分 = Σ(维度内用例得分 × 权重) / Σ(维度内权重)。
- 总分 = Σ(所有用例得分 × 权重) / Σ(所有权重) × 100。
- 输出:逐用例得分表 + 维度达成率 + 总分与等级。

### 5.2 在线(行为达成度,3 轮平均)
- 规则得分 0 / 0.5 / 1;用例得分 = Σ(规则得分 × 规则权重)/Σ(规则权重)。
- 每轮重复后取**均值 ± 方差**(`mean ± std`);总分同理。
- 未配置 key 的用例标记 `skipped:no-key`,不参与总分。

### 5.3 等级
```
S: 90-100  A: 80-89  B: 70-79  C: 60-69  D: <60
```

### 5.4 Evidence 字段
在线规则的可编程判据,统一由 `harness/evidence.ts` 从一次会话运行提取:

| 字段 | 说明 |
| --- | --- |
| `toolCalls` | `{name, args, isError?}[]`,按执行序 |
| `assistantText` | 最终文本全量 |
| `personaEvents` | persona 事件(值 + source) |
| `activePersona` | 结束时 `session.persona` |
| `teaching` | `update_teaching` 累积快照(若走该工具) |
| `files` | 会话 `listFiles()` |
| `runResults` | 每次 run_code 的 stdout/stderr 汇总 |

### 5.5 报告
- 终端:用例表(用例、得分、权重、均值±σ)+ 维度表 + 总分与等级。
- 文件:`tests/report/latest.offline.json`;`tests/report/real.{provider}.{model}.json`(含 header:date/provider/model/thinking/iterations/total/grade)。

---

## 6. 结果解读对照表

| 现象 | 含义 | 处理 |
| --- | --- | --- |
| 离线全 PASS | 核心逻辑与协议稳定 | — |
| 离线某用例 FAIL | 回归/边界被破坏 | 修复移植 |
| 在线某用例 <70 | 该模型对该教学行为不足 | 换模型或调 prompt |
| 在线 ORD-01/R1 == 0.5 | 路由选了别的方法 | 看最终文本确认是否合理 |
| 全部 skipped | key 或 provider 配置缺失 | 检查 `.env` / 环境变量 |

---

*文档结束。实际运行结果与规格差异时,应回到本文件对齐。*
