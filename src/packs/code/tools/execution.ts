import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { VirtualFS } from "../vfs.js";
import type { ExecClient } from "../exec-client.js";
export function createExecutionTools(vfs: VirtualFS, exec: ExecClient): AgentTool<any>[] {
	const parameters = Type.Object({ sandbox: Type.String(), entry: Type.String() });
	return [{ name: "run_code", label: "运行代码", description: "在远程沙箱运行工作区入口并返回 stdout/stderr。", parameters, execute: async (_id, raw) => {
		const params = raw as { sandbox: string; entry: string }; const files = vfs.toRecord(); if (!Object.keys(files).length) throw new Error("工作区为空，请先写入代码"); const entry = files[params.entry]; if (entry === undefined) throw new Error(`工作区不存在 ${params.entry}`); const payload = params.sandbox === "python" && params.entry !== "main.py" ? { ...files, "main.py": entry } : files; const result = await exec.exec({ sandbox: params.sandbox, command: "run", files: payload }); if (!result.ok) throw new Error(`沙箱执行失败 (id=${result.id}):\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`); return { content: [{ type: "text", text: `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`.trimEnd() }], details: { id: result.id, duration: result.duration } };
	} }];
}
