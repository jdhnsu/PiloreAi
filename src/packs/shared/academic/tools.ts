import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { ToolManifest } from "../../../core/types.js";
import type { AcademicEvaluator } from "./evaluator.js";
import type { AcademicMentorState, AcademicPracticeItem, AcademicPracticeRecord } from "./state.js";
import { addAcademicPracticeRecord } from "./state.js";
import type { StudyCardBank } from "./study-card-bank.js";

export interface AcademicToolSpec<TSubject extends string = string> {
	subjectId: TSubject;
	subjectName: string;
	cardKinds: readonly string[];
	practiceTypes: readonly string[];
}

function literalUnion(values: readonly string[]) {
	if (!values.length) throw new Error("工具枚举不能为空");
	return Type.Union(values.map((value) => Type.Literal(value)));
}

function createStudyCardTools<TSubject extends string>(
	bank: StudyCardBank,
	spec: AcademicToolSpec<TSubject>,
): AgentTool<any>[] {
	const saveParams = Type.Object({
		id: Type.Optional(Type.String()),
		kind: literalUnion(spec.cardKinds),
		title: Type.String(),
		summary: Type.String(),
		details: Type.Optional(Type.String()),
		tags: Type.Optional(Type.Array(Type.String())),
	});
	const listParams = Type.Object({ query: Type.Optional(Type.String()), kind: Type.Optional(Type.String()) });
	const removeParams = Type.Object({ id: Type.String() });
	return [
		{
			name: "save_study_card",
			label: "保存学习卡片",
			description: `把值得复习的${spec.subjectName}定义、方法、证据或易错点保存为结构化学习卡片。`,
			parameters: saveParams,
			execute: async (_id, raw) => {
				const input = raw as { id?: string; kind: string; title: string; summary: string; details?: string; tags?: string[] };
				const card = bank.add(input);
				return {
					content: [{ type: "text", text: `已保存卡片 ${card.id}：${card.title}（共 ${bank.count()} 张）` }],
					details: { card },
				};
			},
		},
		{
			name: "list_study_cards",
			label: "查看学习卡片",
			description: `列出${spec.subjectName}学习卡片，可按关键词或类型过滤。`,
			parameters: listParams,
			execute: async (_id, raw) => {
				const input = raw as { query?: string; kind?: string };
				const query = input.query?.trim().toLowerCase();
				const kind = input.kind?.trim();
				if (kind && !spec.cardKinds.includes(kind)) throw new Error(`kind 需为 ${spec.cardKinds.join("/")}`);
				const cards = bank.list().filter((card) => {
					if (kind && card.kind !== kind) return false;
					if (!query) return true;
					return [card.id, card.kind, card.title, card.summary, card.details, ...card.tags]
						.some((value) => value.toLowerCase().includes(query));
				});
				const text = cards.length
					? cards.map((card) => `- [${card.id}] ${card.title}（${card.kind}）：${card.summary}`).join("\n")
					: "学习卡片为空或没有匹配项";
				return { content: [{ type: "text", text }], details: { count: cards.length, cards } };
			},
		},
		{
			name: "remove_study_card",
			label: "移除学习卡片",
			description: "按 id 移除一张学习卡片。",
			parameters: removeParams,
			execute: async (_id, raw) => {
				const { id } = raw as { id: string };
				if (!bank.remove(id)) throw new Error(`没有找到卡片 ${id}`);
				return { content: [{ type: "text", text: `已移除卡片 ${id}（剩 ${bank.count()} 张）` }], details: { id } };
			},
		},
	];
}

function createAcademicPracticeTools<TSubject extends string>(
	state: AcademicMentorState,
	spec: AcademicToolSpec<TSubject>,
	evaluator?: AcademicEvaluator<TSubject>,
): AgentTool<any>[] {
	const startParams = Type.Object({ type: literalUnion(spec.practiceTypes), count: Type.Optional(Type.Number()) });
	const submitParams = Type.Object({
		type: literalUnion(spec.practiceTypes),
		items: Type.Array(Type.Object({
			prompt: Type.String(),
			answer: Type.String(),
			reference: Type.Optional(Type.String()),
		})),
	});
	return [
		{
			name: "start_academic_practice",
			label: "发起学科练习",
			description: `发起一次${spec.subjectName}练习；给题后等待学习者独立作答。`,
			parameters: startParams,
			execute: async (_id, raw) => {
				const input = raw as { type: string; count?: number };
				if (input.count !== undefined && (!Number.isInteger(input.count) || input.count < 1 || input.count > 20)) {
					throw new Error("count 需为 1~20 的整数");
				}
				return {
					content: [{ type: "text", text: `已开始 ${spec.subjectName} ${input.type} 练习${input.count ? `（${input.count} 题）` : ""}` }],
					details: { type: input.type, count: input.count },
				};
			},
		},
		{
			name: "submit_academic_answer",
			label: "提交学科答案",
			description: "提交学习者答案并写入练习日志；注入评估器时逐题批改。",
			parameters: submitParams,
			execute: async (_id, raw) => {
				const input = raw as { type: string; items: Array<{ prompt: string; answer: string; reference?: string }> };
				const checked: AcademicPracticeItem[] = [];
				for (const item of input.items) {
					let correct: boolean | null = null;
					let feedback = "";
					if (evaluator) {
						const result = await evaluator.check({
							subject: spec.subjectId,
							type: input.type,
							prompt: item.prompt,
							answer: item.answer,
							...(item.reference ? { reference: item.reference } : {}),
						});
						correct = result.correct;
						feedback = result.feedback ?? "";
					}
					checked.push({ prompt: item.prompt, answer: item.answer, reference: item.reference ?? "", correct, feedback });
				}
				const record: AcademicPracticeRecord = { type: input.type, ts: new Date().toISOString(), items: checked };
				addAcademicPracticeRecord(state, record);
				return {
					content: [{ type: "text", text: JSON.stringify(checked) }],
					details: { count: checked.length, evaluated: !!evaluator, practice: record.ts },
				};
			},
		},
	];
}

export function createAcademicToolManifest<TSubject extends string>(
	bank: StudyCardBank,
	state: AcademicMentorState,
	spec: AcademicToolSpec<TSubject>,
	evaluator?: AcademicEvaluator<TSubject>,
): ToolManifest {
	return {
		groups: [
			{ key: "study_cards", description: `管理${spec.subjectName}学习卡片`, load: () => createStudyCardTools(bank, spec) },
			{ key: "practice", description: `发起并记录${spec.subjectName}练习`, load: () => createAcademicPracticeTools(state, spec, evaluator) },
		],
		capabilities: {
			save_study_card: ["study_cards.write"],
			list_study_cards: ["study_cards.read"],
			remove_study_card: ["study_cards.write"],
			start_academic_practice: ["practice.run"],
			submit_academic_answer: ["practice.run"],
		},
		resolveCapability(toolName) {
			if (toolName === "save_study_card" || toolName === "remove_study_card") return "study_cards.write";
			if (toolName === "list_study_cards") return "study_cards.read";
			if (toolName === "start_academic_practice" || toolName === "submit_academic_answer") return "practice.run";
			return undefined;
		},
	};
}
