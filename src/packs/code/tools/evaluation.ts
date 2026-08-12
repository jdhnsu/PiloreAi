import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { VirtualFS } from "../vfs.js";
import type { CodeEvaluator } from "../evaluator.js";
export function createEvaluationTools(vfs: VirtualFS, evaluator?: CodeEvaluator): AgentTool<any>[] {
	if (!evaluator) return []; const parameters = Type.Object({ entry: Type.Optional(Type.String()) });
	return [{ name: "evaluate_code", label: "评估代码", description: "使用注入的评估器评估当前代码。", parameters, execute: async (_id, raw) => { const params = raw as { entry?: string }; const evaluation = await evaluator.evaluate({ files: vfs.toRecord(), entry: params.entry }); return { content: [{ type: "text", text: JSON.stringify(evaluation) }], details: { evaluation } }; } }];
}
