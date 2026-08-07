import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { execCode } from "./exec-client.js";
import type { VirtualFS } from "./vfs.js";

/** 三个 AgentTool：write_file / read_file / run_code，全部作用于内存 VFS 与远程沙箱。 */
export function createTools(vfs: VirtualFS): AgentTool<any>[] {
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
		command: Type.String({ default: "run", description: "执行命令，默认 run" }),
	});
	const runCode: AgentTool<typeof runParams> = {
		name: "run_code",
		label: "运行代码",
		description:
			"在远程沙箱运行当前工作区的全部代码文件，返回 stdout/stderr。任何代码改动后都必须运行验证，不要凭空猜输出。",
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

	return [writeFile, readFile, runCode];
}
