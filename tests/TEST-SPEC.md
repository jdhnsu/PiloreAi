# PiLore 测试规格

## 确定性测试

`npm test` 覆盖：

- Core：无 Domain Pack 的纯对话、Snapshot 校验、架构依赖边界。
- Code Pack：默认 Profiles、动态工具组、VFS、Profile 状态、Snapshot 恢复。
- English Pack：默认 Profiles、词汇/练习工具、评估记录、Snapshot 恢复。
- Infrastructure：AES-256-GCM、内存 SessionStore、Telemetry。

`npm run test:agent` 只运行 Core 与两个 Pack 的离线 Agent 测试，使用 faux provider，不访问网络。

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

## 验收命令

```bash
npm run typecheck
npm test
npm run test:agent
```
