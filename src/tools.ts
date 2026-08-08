import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { execCode } from "./exec-client.js";
import { getPersona } from "./personas.js";
import type { VirtualFS } from "./vfs.js";

/** 三个 AgentTool：write_file / read_file / run_code，全部作用于内存 VFS 与远程沙箱。 */
export function createTools(vfs: VirtualFS): AgentTool<any>[] {
	// 声明教学方法，让 CLI 能显示当前"老师"；不操作 VFS
	const adoptParams = Type.Object({
		persona: Type.Union(
			[Type.Literal("feynman"), Type.Literal("socrates"), Type.Literal("oris"), Type.Literal("auto")],
			{ description: "要采用的教学方法；auto = 交还 PiLore 自动路由" },
		),
	});
	const adoptPersona: AgentTool<typeof adoptParams> = {
		name: "adopt_persona",
		label: "切换老师",
		description:
			"声明本轮要采用的教学方法。首次需要教学方法或切换方法时必须先调用，再以该方法风格回答；persona=auto 表示当前教学阶段结束，交还 PiLore 自动路由。简单事实问答、用户 @ 指定、同一方法的连续对话不要调用。",
		parameters: adoptParams,
		execute: async (_toolCallId, params) => {
			if (params.persona === "auto") {
				return {
					content: [{ type: "text", text: "已交还 PiLore 自动路由，请根据学习者接下来的问题重新判断教学方法或直接回答" }],
					details: { persona: "auto" },
				};
			}
			const persona = getPersona(params.persona);
			if (!persona) throw new Error(`未知教学方法: ${params.persona}`);
			return {
				content: [{ type: "text", text: `已采用 ${persona.name} 教学方法，请以该方法的风格和流程继续回答` }],
				details: { persona: persona.key },
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
		sandbox: Type.String({ description: "沙箱类型，如 python" }),
		// 无默认值：沙箱不会自动找文件，必须由模型显式给出如 python fib.py
		command: Type.String({ description: "执行命令，必须显式指定要运行的文件，如 python fib.py" }),
	});
	const runCode: AgentTool<typeof runParams> = {
		name: "run_code",
		label: "运行代码",
		description:
			"在远程沙箱运行代码，返回 stdout/stderr。沙箱默认不会找文件，一定要在 command 里指定文件名再跑（如 python fib.py）。任何代码改动后都必须运行验证，不要凭空猜输出。",
		parameters: runParams,
		execute: async (_toolCallId, params) => {
			const files = vfs.toRecord();
			if (Object.keys(files).length === 0) {
				throw new Error("工作区为空，请先用 write_file 写入代码再运行");
			}
			const result = await execCode({ sandbox: params.sandbox, command: params.command, files });
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

	return [adoptPersona, writeFile, readFile, runCode];
}
