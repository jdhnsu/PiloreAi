import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ExecClient } from "./exec-client.js";
import { getPersona, getPersonaKeys, type Persona } from "./personas.js";
import { createPersonaContextMessage, hashPersona, renderPersonaContext } from "./persona-context.js";
import type { SharedState } from "./shared-state.js";
import type { VirtualFS } from "./vfs.js";

/** createTools 的可注入依赖：执行后端与老师集合均由外部解析后传入（核心不做缺省猜测）。 */
export interface ToolDeps {
	exec: ExecClient;
	personas: Persona[];
}

/** 五个 AgentTool：write_file / read_file / run_code / adopt_persona / update_teaching，全部作用于内存 VFS、注入的执行器与教学状态。 */
export function createTools(vfs: VirtualFS, shared: SharedState, deps: ToolDeps): AgentTool<any>[] {
	const personas = deps.personas;
	// 声明教学方法：写入共享状态，并把方法论作为追加式 toolResult 交给下一次模型调用。
	const adoptParams = Type.Object({
		persona: Type.Union(
			[...getPersonaKeys(personas).map((k) => Type.Literal(k)), Type.Literal("auto")],
			{ description: "要采用的教学方法；auto = 交还 PiLore 自动路由" },
		),
	});
	const adoptPersona: AgentTool<typeof adoptParams> = {
		name: "adopt_persona",
		label: "切换老师",
		description:
			"声明本轮要采用的教学方法。首次需要教学方法或切换方法时必须先调用，再以该方法风格回答；persona=auto 表示当前教学阶段结束，交还 PiLore 自动路由。简单事实问答、用户 @ 指定、同一方法的连续对话不要调用（同一轮内最多切换 2 次）。",
		parameters: adoptParams,
		execute: async (_toolCallId, params) => {
			if (params.persona === "auto") {
				shared.setPersona(undefined, "model");
				// 交还是结算点:清零同轮切换预算,让后续可以直接切到新方法
				shared.resetUserTurn();
				return {
					content: [{ type: "text", text: renderPersonaContext(createPersonaContextMessage(undefined)) }],
					details: { persona: "auto" },
				};
			}
			const blocked = shared.canAdopt(params.persona);
			if (blocked) throw new Error(blocked);
			const persona = getPersona(params.persona, personas);
			if (!persona) throw new Error(`未知教学方法: ${params.persona}`);
			shared.recordSwitch();
			shared.setPersona(persona, "model");
			const teaching = shared.getTeaching(persona.key);
			const context = createPersonaContextMessage(persona, teaching);
			return {
				content: [{ type: "text", text: renderPersonaContext(context) }],
				details: { persona: persona.key, personaHash: hashPersona(persona) },
			};
		},
	};

	// 维护教学阶段工作记忆：只写共享状态（按当前老师 key 保存），不操作 VFS
	const teachingParams = Type.Partial(
		Type.Object({
			stage: Type.String({ description: "当前教学阶段，如「诊断」「分层讲解」「演示」" }),
			topic: Type.String({ description: "当前主线主题，一句话" }),
			covered: Type.Array(Type.String(), { description: "已覆盖 / 已带过的知识点（整体替换该字段）" }),
			pending: Type.Array(Type.String(), { description: "待展开 / 后续可回主线深挖的点（整体替换该字段）" }),
		}),
	);
	const updateTeaching: AgentTool<typeof teachingParams> = {
		name: "update_teaching",
		label: "更新教学进度",
		description:
			"记录当前教学阶段进度（阶段 / 主题 / 已覆盖 / 待展开），供后续轮次记忆。按当前激活的教学方法保存：阶段推进、主题明确、或收口总结时调用，只更新变化的字段。未激活教学方法时不可用（先 adopt_persona）。",
		parameters: teachingParams,
		execute: async (_toolCallId, params) => {
			const progress = shared.updateTeaching(params);
			const text =
				`已记录教学进度（${shared.activePersona?.name ?? ""}）：阶段「${progress.stage}」主题「${progress.topic}」` +
				(progress.covered.length ? `\n已覆盖: ${progress.covered.join(" / ")}` : "") +
				(progress.pending.length ? `\n待展开: ${progress.pending.join(" / ")}` : "");
			return {
				content: [{ type: "text", text }],
				details: { progress },
			};
		},
	};

	const writeParams = Type.Object({
		path: Type.String({ description: "文件相对路径，例如 main.py" }),
		content: Type.String({ description: "文件完整内容" }),
	});
	const writeFile: AgentTool<typeof writeParams> = {
		name: "write_file",
		label: "写入文件",
		description:
			"把学习者的代码写入虚拟工作区（内存文件系统）。path 是相对路径如 main.py；content 是完整文件内容（覆盖写入）.",
		parameters: writeParams,
		execute: async (_toolCallId, params) => {
			const key = vfs.write(params.path, params.content);
			return {
				content: [{ type: "text", text: `已写入 ${key}（${params.content.length} 字符）` }],
				details: { path: key },
			};
		},
	};

	const readParams = Type.Object({
		path: Type.String({ description: "文件相对路径，例如 main.py" }),
	});
	const readFile: AgentTool<typeof readParams> = {
		name: "read_file",
		label: "读取文件",
		description: "读取虚拟工作区中某个文件的内容。",
		parameters: readParams,
		execute: async (_toolCallId, params) => {
			// 文件不存在时抛错 → 自动转为 isError 工具结果，让模型自我纠正
			const content = vfs.read(params.path);
			return {
				content: [{ type: "text", text: content }],
				details: { path: params.path },
			};
		},
	};

	const runParams = Type.Object({
		sandbox: Type.String({ description: "codapi 沙箱名，填具体语言如 python；不要填 default/auto 等含糊值" }),
		entry: Type.String({ description: "要运行的入口文件（须已 write_file），如 fib.py" }),
	});
	const runCode: AgentTool<typeof runParams> = {
		name: "run_code",
		label: "运行代码",
		description:
			"在远程沙箱运行代码，返回 stdout/stderr。用 entry 指定要运行的文件；python 沙箱入口固定 main.py，其它文件名会自动别名挂载。任何代码改动后都必须运行验证，不要凭空猜输出。",
		parameters: runParams,
		execute: async (_toolCallId, params) => {
			const files = vfs.toRecord();
			if (Object.keys(files).length === 0) {
				throw new Error("工作区为空，请先用 write_file 写入代码再运行");
			}
			const entryContent = files[params.entry];
			if (entryContent === undefined) {
				throw new Error(`工作区不存在 ${params.entry}，现有文件: ${Object.keys(files).join(", ")}`);
			}
			// codapi 沙箱入口文件名固定（python 为 main.py），非 main.py 的入口别名挂载
			const payload =
				params.sandbox === "python" && params.entry !== "main.py" ? { ...files, "main.py": entryContent } : files;
			const result = await deps.exec.exec({ sandbox: params.sandbox, command: "run", files: payload });
			if (!result.ok) {
				throw new Error(`沙箱执行失败 (id=${result.id}):\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
			}
			const text = `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`.trimEnd();
			return {
				content: [{ type: "text", text }],
				details: { id: result.id, duration: result.duration },
			};
		},
	};

	return [adoptPersona, updateTeaching, writeFile, readFile, runCode];
}
