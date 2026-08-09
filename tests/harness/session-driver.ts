// 会话驱动器:真实驱动 createEduSession(在线用例),按序发送多条用户消息,
// 收集 EduEvent 与最终状态,建成评委可判定的 evidence。
import { createEduSession, type EduEvent, type EduSessionOptions } from "../../src/session.js";
import { getPersona, type Persona } from "../../src/personas.js";

export interface OnlineRule {
	name: string;
	/** 规则权重 1~3 */
	weight: number;
	/** 行为达成度评分:0 / 0.5 / 1 */
	judge: (ev: OnlineEvidence) => number;
}

export interface OnlineCaseDef {
	id: string;
	name: string;
	dimension: Dimension;
	weight: number;
	/** 按序发送的用户消息(多轮对话就放多条) */
	prompts: string[];
	/** LLM run 安全上限 */
	maxTurns?: number;
	rules: OnlineRule[];
}

export type Dimension =
	| "工具纪律"
	| "教学行为"
	| "护栏"
	| "会话协议"
	| "执行后端"
	| "边界"
	| "在线路由";

/** 一次在线评测抽取的证据(评委判定的唯一依据)。 */
export interface OnlineEvidence {
	/** 全部 EduEvent(跨轮累积) */
	events: EduEvent[];
	/** persona 事件序列(值 + source) */
	personaEvents: { persona: string | null; name: string | null; source: string }[];
	/** 最终 persona(会话结束状态) */
	finalPersona: Persona | undefined;
	/** 出现过的工具调用(名称 + args) */
	toolCalls: { name: string; args: unknown }[];
	/** update_teaching 的原始参数列表 */
	teachingCalls: Record<string, unknown>[];
	/** 工作区文件列表(最终) */
	files: string[];
	/** run_code 的文本结果(依次) */
	runResults: string[];
	/** 所有 text_delta 拼接成的最终文本内容 */
	allText: string;
	/** 是否出现 error 事件 */
	error: string | undefined;
}

/** 跑一轮(可多步)在线评测,产出 evidence。 */
export async function runOnlineEvidence(
	opts: EduSessionOptions & { prompts: string[]; maxTurns?: number },
): Promise<OnlineEvidence> {
	const session = createEduSession({ ...opts, maxTurns: opts.maxTurns ?? 8 });
	const events: EduEvent[] = [];
	const teachingCalls: Record<string, unknown>[] = [];
	const runResults: string[] = [];
	let allText = "";

	for (const text of opts.prompts) {
		await session.prompt(text, (ev) => {
			events.push(ev);
			if (ev.type === "tool_start") {
				if (ev.toolName === "update_teaching") teachingCalls.push((ev.args ?? {}) as Record<string, unknown>);
				if (ev.toolName === "run_code") runResults.push("");
			}
			if (ev.type === "tool_end" && ev.toolName === "run_code") {
				runResults[runResults.length - 1] = ev.text;
			}
			if (ev.type === "text_delta") allText += ev.delta;
		});
	}

	const personaEvents = events.flatMap((e) =>
		e.type === "persona"
			? [
					{
						persona: e.persona,
						name: e.persona ? getPersona(e.persona)?.name ?? null : null,
						source: e.source,
					},
				]
			: [],
	);

	// 忽略 adopt_persona(它以 persona 事件体现),保留其余工具
	const toolCalls = events
		.filter((e) => e.type === "tool_start" && e.toolName !== "adopt_persona")
		.map((e) => ({ name: (e as Extract<EduEvent, { type: "tool_start" }>).toolName, args: (e as Extract<EduEvent, { type: "tool_start" }>).args }));

	const errorEvent = events.find((e): e is Extract<EduEvent, { type: "error" }> => e.type === "error");

	return {
		events,
		personaEvents,
		finalPersona: session.persona,
		toolCalls,
		teachingCalls,
		files: session.listFiles(),
		runResults,
		allText,
		error: errorEvent?.message,
	};
}

/** 便捷:读取会话当前 persona 名。 */
export function personaNameOf(ev: OnlineEvidence): string | null {
	return ev.finalPersona?.name ?? null;
}