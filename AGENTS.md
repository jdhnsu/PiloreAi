# AGENTS.md — PiLore

PiLore 是可嵌入的多领域教学 Agent。当前实现由领域无关 Core、Code Pack、English Pack、Math Pack、Physics Pack、History Pack，以及基础设施与适配器组成。

## 依赖方向

分层目录 `core/`、`packs/`、`infrastructure/`、`adapters/` 的 import 边界如下（上层可依赖下层；`src/index.ts` 是唯一聚合入口，仓库消费者不得绕过）：

- `src/core/`：通用 Runtime、Session、State、Snapshot、Profile Router、动态 Tool Runtime 与事件协议。只允许依赖 `@pilore/pi-agent-core`、`@pilore/pi-ai`、Node 内置与 `infrastructure/telemetry`（遥测 streamFn 包装属 Runtime 机制，受控例外）。不得导入任何 Pack、VFS、ExecClient 或领域术语。
- `src/packs/code/`：编程导师设定、Profiles、进度、VFS、执行器、评估器和代码工具。
- `src/packs/english/`：英语导师设定、Profiles、词汇、练习、评估器和领域工具。
- `src/packs/math/`：大学数学导师设定、Profiles、学科卡片、练习与评估器。
- `src/packs/physics/`：大学物理导师设定、Profiles、学科卡片、练习与评估器。
- `src/packs/history/`：大学历史导师设定、Profiles、学科卡片、练习与评估器。
- `src/packs/shared/academic/`：三个大学学科 Pack 共用的本地状态、卡片、练习、快照与可选评估接口。
- `src/packs/`（各 Pack）：可依赖 `core/` 与 `infrastructure/models`、`infrastructure/telemetry`（仅类型）；不得依赖 Adapter。数学/物理/历史 Pack 可共享 `src/packs/shared/academic/`。
- `src/infrastructure/`：模型注册、遥测和持久化。可依赖 `@pilore/pi-ai`、`@pilore/pi-telemetry`、Node 内置、`pg` 与 `core/`（仅 `core/types`、`core/snapshot`，供持久化使用）；不得依赖 Pack。
- `packages/`：PiLore 维护的底层运行时源码工作区，依赖顺序固定为 `pi-telemetry` → `pi-ai` → `pi-agent-core`；不得反向依赖 `src/`。
- `src/adapters/cli/`、`src/adapters/web/`：产品入口，只通过 `src/index.ts` 消费公开 API，不得新增深层导入；web 的 faux demo 是唯一例外（引用 `mock/exec-server.ts`）。
- `src/index.ts`：唯一公开入口。仓库消费者不得新增深层导入。

## 核心约定

- ESM 相对导入必须带 `.js`。
- import 不读 env、不扫磁盘、不发请求；默认 Profiles 仅在创建 Pack 时懒加载。
- Core Snapshot V1 固定包含 `version`、`revision`、`messages`、`activeProfileKey`、`activeToolsetKeys`、`extensions`。
- 每个 Session 一个主 Domain Pack；领域状态只写入自己的 extension namespace。
- Profile 方法论只在激活后通过可信内部上下文进入历史，不进入常驻 system prompt。
- 具体工具 schema 通过 `activate_toolset` 动态加载；内部工具不渲染为普通工具事件。
- Code Pack 的学习者文件只存在于 VFS，执行只经注入的 `ExecClient`。
- Python 使用系统的 `uv`。

## 常用命令

```bash
npm run typecheck
npm test
npm run test:agent
npm run test:postgres
npm run test:agent:real
npm run demo
npm run web:demo
```

在线测试和真实沙箱可能需要 `.env`。优先运行确定性的 `typecheck`、`npm test` 和 `test:agent`。
