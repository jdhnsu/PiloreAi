import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { EnglishMentorState, PracticeItem, PracticeRecord } from "../state.js";
import { addPracticeRecord } from "../state.js";
import type { EnglishEvaluator } from "../evaluator.js";
const PRACTICE_TYPES = ["vocabulary", "grammar", "translation", "cloze", "dialogue", "reading"] as const;
export function createPracticeTools(state: EnglishMentorState, evaluator?: EnglishEvaluator): AgentTool<any>[] {
	const startParams = Type.Object({ type: Type.Union(PRACTICE_TYPES.map((t) => Type.Literal(t))), count: Type.Optional(Type.Number()) });
	const submitParams = Type.Object({ type: Type.String(), items: Type.Array(Type.Object({ item: Type.String(), answer: Type.String() })) });
	return [
		{ name: "start_practice", label: "发起练习", description: "发起一次指定类型的英语练习（词汇/语法/翻译/完形/对话/阅读），随后给出题目并让学习者作答。", parameters: startParams, execute: async (_id, raw) => { const p = raw as { type: string; count?: number }; if (p.count !== undefined && (!Number.isInteger(p.count) || p.count < 1 || p.count > 20)) throw new Error("count 需为 1~20 的整数"); return { content: [{ type: "text", text: `已开始 ${p.type} 练习${p.count ? `（${p.count} 题）` : ""}` }], details: { type: p.type, count: p.count } }; } },
		{ name: "submit_answer", label: "提交答案", description: "提交学习者的练习答案，记录到练习日志；若注入了评估器则逐题批改并返回对错与反馈。", parameters: submitParams, execute: async (_id, raw) => { const p = raw as { type: string; items: { item: string; answer: string }[] }; const checked: PracticeItem[] = []; for (const entry of p.items) { let result: { correct: boolean | null; feedback: string } = { correct: null, feedback: "" }; if (evaluator) { const res = await evaluator.check({ type: p.type, item: entry.item, answer: entry.answer }); result = { correct: res.correct, feedback: res.feedback ?? "" }; } checked.push({ ...entry, ...result }); } const record: PracticeRecord = { type: p.type, ts: new Date().toISOString(), items: checked }; addPracticeRecord(state, record); return { content: [{ type: "text", text: JSON.stringify(checked) }], details: { count: checked.length, evaluated: !!evaluator, practice: record.ts } }; } },
	];
}
