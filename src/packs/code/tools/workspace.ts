import { Type } from "@earendil-works/pi-ai"; import type { AgentTool } from "@earendil-works/pi-agent-core"; import type { VirtualFS } from "../vfs.js";
export function createWorkspaceTools(vfs: VirtualFS): AgentTool<any>[] { const write = Type.Object({ path: Type.String(), content: Type.String() }); const read = Type.Object({ path: Type.String() }); return [
	{ name: "write_file", label: "写入文件", description: "写入虚拟代码工作区；覆盖写入。", parameters: write, execute: async (_id, raw) => { const p = raw as { path: string; content: string }; const path = vfs.write(p.path, p.content); return { content: [{ type: "text", text: `已写入 ${path}（${p.content.length} 字符）` }], details: { path } }; } },
	{ name: "read_file", label: "读取文件", description: "读取虚拟代码工作区文件。", parameters: read, execute: async (_id, raw) => { const p = raw as { path: string }; return { content: [{ type: "text", text: vfs.read(p.path) }], details: { path: p.path } }; } },
]; }
