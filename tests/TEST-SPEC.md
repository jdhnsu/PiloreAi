# PiLore 测试规格

## 确定性测试

`npm test` 覆盖：

- Core：无 Domain Pack 的纯对话、Snapshot 校验、架构依赖边界。
- Code Pack：默认 Profiles、动态工具组、VFS、Profile 状态、Snapshot 恢复。
- English Pack：默认 Profiles、词汇/练习工具、评估记录、Snapshot 恢复。
- Academic Packs：大学数学、大学物理、大学历史的默认 Profiles、动态卡片/练习工具、学科感知评估与独立 Snapshot namespace。
- Infrastructure：AES-256-GCM、内存 SessionStore、Telemetry。

`npm run test:agent` 运行 Core 与全部 Pack 的离线 Agent 测试，使用 faux provider，不访问网络。

`npm run test:postgres` 使用 `PILORE_TEST_DATABASE_URL` 或 `DB_*`；未配置时跳过。测试在临时 schema 中执行并清理。

## 在线行为评测

`npm run test:agent:real` 经 `createCodeMentorSession()` 运行真实模型，评估：

- Profile 自动路由：Feynman / Socrates / Oris。
- 动态工具纪律：激活工具组、写文件、运行代码、基于真实结果回答。
- 多轮 Profile 状态与自动路由交还。

可用参数：

```bash
npx tsx tests/run.ts --provider deepseek --model deepseek-v4-flash --thinking off --iterations 3
```

在线评测可能产生模型费用，不属于默认验收命令。

### Code Pack 路由灵敏度

`npm run test:router:real` 是独立的真实模型路由评测，使用 `.env` 中目标 provider 的 API key，默认每个场景运行 3 次。它分别统计：

- 应激活命中率：自动模式能否准确选择 Feynman / Socrates / Oris。
- 不过度激活率：简单事实、语法和 API 问题是否保持自动模式。
- 保持稳定率：教学方式未变时是否避免重复激活或因话题变化换人。
- 应切换命中率：学习意图变化时能否直接换到目标 Profile，或在专门讲解结束后交还自动模式。

每个场景至少通过 2/3，四类指标均须达到 80%，并要求零路由抖动、零模型错误。缺少 API key 会直接失败，不会静默跳过。报告以时间戳文件名写入 `tests/report`，不会覆盖 `test:agent:real` 的报告。

```bash
npm run test:router:real
npm run test:router:real -- --provider deepseek --model deepseek-v4-flash --iterations 3
npm run test:router:real -- --filter CRR-10 --iterations 1
```

runner 默认在轮次间隔 1500ms；连接错误会用全新会话最多重试 2 次，只有重试耗尽后才计入模型错误率。可用 `--delay-ms` 和 `--retries` 调整。该命令会产生真实模型费用，不加入默认离线测试。

## 验收命令

```bash
npm run typecheck
npm test
npm run test:agent
```
