# Packs

Pack 是 PiLore 的领域插件单元。一个 Pack 将教学 Prompt、Profiles、领域状态、动态工具、Snapshot 扩展和可选评估器组装为一个可创建的 Mentor / MentorSession。每个 Session 只拥有一个主 Pack，领域数据只写入自己的 `extensions.<pack-id>`。

## 现有 Pack

| Pack | 工厂 | 主要状态 | 动态工具组 | Snapshot |
| --- | --- | --- | --- | --- |
| Code | `createCodeMentorSession()` | VFS、Profile 进度、评估记录 | `workspace`、`execution`、可选 `evaluation` | `code` |
| English | `createEnglishMentorSession()` | 词汇本、Profile 进度、练习日志 | `vocabulary`、`practice` | `english` |
| Math | `createMathMentorSession()` | 学习卡片、Profile 进度、练习日志 | `study_cards`、`practice` | `math` |
| Physics | `createPhysicsMentorSession()` | 学习卡片、Profile 进度、练习日志 | `study_cards`、`practice` | `physics` |
| History | `createHistoryMentorSession()` | 学习卡片、Profile 进度、练习日志 | `study_cards`、`practice` | `history` |

大学数学、物理、历史三包共用 `src/packs/shared/academic/` 的本地卡片、练习、快照和可选评估器实现，但各自仍有独立 Prompt、Profile、卡片类型、练习类型和 extension namespace。详细的学科设计见 [大学学科 Packs](academic-packs.md)。

## Pack 的组成

一个完整 Pack 通常包含：

```text
src/packs/<id>/
├─ agent-design/
│  ├─ base-prompt.ts          常驻 Prompt：角色、目录、工具约束、教学纪律
│  ├─ profiles.ts             Profile Markdown 的懒加载/解析入口
│  └─ profiles/*.md           frontmatter + 仅激活后注入的方法论
├─ create-<id>-mentor.ts      公开工厂与 Pack 专用 Session 快捷方法
├─ state.ts                   领域内存状态（可由 shared 实现）
├─ snapshot-extension.ts      extension 导出、校验与恢复（可由 shared 实现）
├─ tools/                     Tool Group 与 Manifest
├─ evaluator.ts               可选外部评估接口
└─ index.ts                   Pack 公共导出
```

Code / English Pack 的目录较早建立，大学学科 Pack 为减少重复使用了 `shared/academic`；两种组织都通过同一个 `DomainPack` 运行时契约工作。

## Profiles

每个 `agent-design/profiles/*.md` 有 YAML frontmatter 和正文：

```md
---
name: Example
description: >-
  供自动路由判断的简明适用场景、触发词和用法示例。
mode: primary
capabilities:
  study_cards.write: allow
  practice.run: deny
---

只在 Profile 激活后注入的完整教学方法论。
```

`description` 是模型在基础 Prompt 中可见的路由目录；正文 `methodology` 则在 Profile 激活后，经可信内部上下文与下一条用户消息合并。frontmatter 的 `capabilities` 是 deny-list：未写能力默认允许，写成 `deny` 才会在运行时阻断该能力。`allow` 可用于声明意图，但不会赋予 Core 不存在的能力。

默认 loader 只在首次创建 Pack 时调用 `readdirSync()` 和 `readFileSync()`。自定义 Profile 可通过每包导出的 `parse*Profile()` 解析，再传入创建工厂的 `profiles`。

## 工具与 capability

Pack 通过 `ToolManifest` 暴露 Tool Group。每个具体工具必须在 `resolveCapability()` 中映射为稳定的能力名，避免在 Profile Markdown 中绑定工具实现细节。

示例：Code Pack 将 `read_file` 映射为 `file.read`，将是否已有路径的 `write_file` 区分为 `file.write` 或 `file.modify`；Academic Pack 将保存/删除卡片映射为 `study_cards.write`，将练习映射为 `practice.run`。

Profile 的 capability 只有在该 Profile 激活时生效，Core 会在实际工具执行前检查。工具组本身仍必须先通过 `activate_toolset` 加载。

## 领域状态与恢复

领域状态不应塞入 `CoreState` 的常驻字段。Pack 用 `SnapshotExtension` 把自己的状态导出为 JSON，并在恢复时验证后写回自己的对象。验证至少应覆盖：

- extension 对象整体形状；
- 已知 Profile key、Tool Group key、枚举类型；
- 领域实体的必填字段与 JSON 可序列化性；
- 任何会影响安全或行为的标识符。

`createSession()` 在恢复前先验证 Core Snapshot，随后恢复 extension、工具组、Profile 和消息历史。Pack 不需要自行管理 Core 的 `revision`。

## 可选基础设施

Pack 不能假设外部执行器、计算机代数、检索、仿真或判题服务存在。需要时定义一个小型可注入接口：

- Code：`ExecClient` 和 `CodeEvaluator`
- English：`EnglishEvaluator`
- Academic：`AcademicEvaluator<TSubject>`

没有注入时应保持可用，并在工具结果中准确说明“已记录但未自动评估”。涉及需要新部署的后端，应先确定宿主环境、数据边界、认证和失败策略。

## 下一步

新建或维护 Pack 的标准流程在 [开发新的 Pack](pack-development.md)；宿主如何创建与持久化 Pack Session 见 [嵌入与 Session API](embedding.md)。
