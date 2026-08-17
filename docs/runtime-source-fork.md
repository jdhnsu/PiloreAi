# Pi 运行时源码分叉

PiLore 将原先通过 npm 使用的 Pi 运行时收进同一个源码工作区，以便 Core 与运行时共同演进，同时保留可审计的上游基线。当前只分叉项目实际依赖的三个包：

| 工作区 | 上游目录 | 独立镜像仓库 |
| --- | --- | --- |
| `@pilore/pi-telemetry` | `packages/telemetry` | `jdhnsu/pilore-pi-telemetry` |
| `@pilore/pi-ai` | `packages/ai` | `jdhnsu/pilore-pi-ai` |
| `@pilore/pi-agent-core` | `packages/agent` | `jdhnsu/pilore-pi-agent-core` |

## 基线与所有权

初始基线为 `earendil-works/pi` 的 `v0.84.1`，commit `53fa77ccd8a279eb87e92294ef3687b03ff80112`。每个包都带有 `LICENSE` 和 `UPSTREAM.md`；后者记录包级来源与 PiLore 的初始改动。此后 `@pilore/*` 是 PiLore 自己维护的 API，不承诺与上游同步发布或保持完全兼容。

上游更新不自动合并。维护者应先阅读上游 diff，再通过 cherry-pick 或手工移植引入，并在相应 `UPSTREAM.md` 和变更记录中写明来源 commit。版本采用 `上游版本-pilore.N`，内部依赖始终锁定精确版本。

## 本地工作区

根 `package.json` 使用 npm workspaces 管理 `packages/*`。业务代码继续使用包名导入，不使用跨目录相对路径：

```ts
import { Agent } from "@pilore/pi-agent-core";
import { getModel } from "@pilore/pi-ai";
```

构建顺序固定为 telemetry → ai → agent：

```bash
npm install
npm run build:runtime
npm run verify:runtime-source
npm run test:runtime
```

`pi-ai` 默认用仓库内固定的 provider 数据完成离线构建；只有明确更新模型目录时才运行联网生成命令。
根目录的 `test:runtime` 只运行确定性的离线集合。各包保留的 `test` 命令包含上游真实 Provider、Ollama 或平台相关 shell harness 用例，可能发起请求、下载模型或只适用于特定系统，必须在准备好相应环境后单独运行。

## 给其他项目使用

npm 的 Git dependency 不能引用 monorepo 子目录，因此三个工作区可导出为三个独立 Git 镜像。镜像不是第二开发入口，所有改动都应先进入本仓库。

先构建，再按依赖顺序导出并提交镜像。下游镜像的依赖必须使用已提交镜像的完整 40 位 SHA：

```bash
npm run export:runtime-mirrors -- --package=telemetry --clean
# 提交 telemetry 镜像，得到 TELEMETRY_SHA
npm run export:runtime-mirrors -- --package=ai --telemetry-ref=TELEMETRY_SHA
# 提交 ai 镜像，得到 AI_SHA
npm run export:runtime-mirrors -- --package=agent --telemetry-ref=TELEMETRY_SHA --ai-ref=AI_SHA
```

导出结果位于 `.artifacts/runtime-mirrors/`，包含源码、测试、构建产物和许可证。脚本只生成本地目录，不会创建仓库、提交或推送。外部项目应使用精确 commit，例如：

```json
{
  "dependencies": {
    "@pilore/pi-agent-core": "git+https://github.com/jdhnsu/pilore-pi-agent-core.git#<40位commit>",
    "@pilore/pi-ai": "git+https://github.com/jdhnsu/pilore-pi-ai.git#<40位commit>"
  }
}
```

镜像提交必须包含 `dist/`，这样消费者无需依赖 Git 安装阶段的构建钩子。创建或推送三个外部仓库属于独立发布操作，应由维护者确认权限和仓库状态后执行。
