import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ExecClient } from "../../exec-client.js";
import type { VirtualFS } from "../../vfs.js";

/** Code-only tools. Education and Core have no dependency on these tool names. */
export function createCodeTools(vfs: VirtualFS, exec: ExecClient): AgentTool<any>[] {
	const writeParams = Type.Object({ path: Type.String(), content: Type.String() });
	const pathParams = Type.Object({ path: Type.String() });
	const runParams = Type.Object({ sandbox: Type.String(), entry: Type.String() });
	const writeFile: AgentTool<typeof writeParams> = {
		name: "write_file", label: "写入文件", description: "将完整内容写入代码工作区的相对路径。",
		parameters: writeParams,
		execute: async (_id, params) => {
			const path = vfs.write(params.path, params.content);
			return { content: [{ type: "text", text: `已写入 ${path}（${params.content.length} 字符）` }], details: { path } };
		},
	};
	const readFile: AgentTool<typeof pathParams> = {
		name: "read_file", label: "读取文件", description: "读取代码工作区中的文件。", parameters: pathParams,
		execute: async (_id, params) => ({ content: [{ type: "text", text: vfs.read(params.path) }], details: { path: params.path } }),
	};
	const runCode: AgentTool<typeof runParams> = {
		name: "run_code", label: "运行代码", description: "在注入的远程沙箱运行工作区中的入口文件，返回 stdout/stderr。",
		parameters: runParams,
		execute: async (_id, params) => {
			const files = vfs.toRecord();
			if (!Object.keys(files).length) throw new Error("工作区为空，请先写入代码");
			const entry = files[params.entry];
			if (entry === undefined) throw new Error(`工作区不存在 ${params.entry}`);
			const payload = params.sandbox === "python" && params.entry !== "main.py" ? { ...files, "main.py": entry } : files;
			const result = await exec.exec({ sandbox: params.sandbox, command: "run", files: payload });
			if (!result.ok) throw new Error(`沙箱执行失败 (id=${result.id}):\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
			return { content: [{ type: "text", text: `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`.trimEnd() }], details: { id: result.id, duration: result.duration } };
		},
	};
	return [writeFile, readFile, runCode];
}
