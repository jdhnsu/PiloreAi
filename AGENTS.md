# AGENTS.md — PiLore

PiLore 是可嵌入的多领域教学 Agent。当前实现由领域无关 Core、Code Pack、English Pack，以及基础设施与适配器组成。

## 依赖方向

`core/ → packs/ → infrastructure/ → adapters/`

- `src/core/`：通用 Runtime、Session、State、Snapshot、Profile Router、动态 Tool Runtime 与事件协议。不得导入任何 Pack、VFS、ExecClient 或领域术语。
- `src/packs/code/`：编程导师设定、Profiles、进度、VFS、执行器、评估器和代码工具。
- `src/packs/english/`：英语导师设定、Profiles、词汇、练习、评估器和领域工具。
- `src/infrastructure/`：模型注册、遥测和持久化。
- `src/adapters/cli/`、`src/adapters/web/`：产品入口，只通过 `src/index.ts` 消费公开 API。
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
