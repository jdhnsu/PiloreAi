// faux 证据:构造脚本化 faux 模型,跑完一轮 agent,并抽出「实际发生的证据」供断言。
// 工具结果由 agent-core 对真实工具执行后自动回写,因此证据反映的是真实执行序列,而非脚本本身。
import { createModels, fauxProvider, type FauxResponseStep, type ToolResultMessage } from "@earendil-works/pi-ai";
import { createAgent, type CreateAgentOptions, type EduAgent } from "../../src/agent.js";

/** 一次运行中实际执行过的工具(按 assistant 消息里的 toolCall 顺序)。 */
export interface ToolCallEvidence {
	name: string;
	args: Record<string, unknown>;
	isError: boolean;
	resultText: string;
}

/** 由一次 faux 驱动运行抽取的全部证据(供断言)。 */
export interface FauxEvidence {
	/** 实际执行过的工具序列(顺序=执行顺序) */
	toolCalls: ToolCallEvidence[];
	/** agent.state.messages 中全部 toolResult 消息(含 isError/text) */
	toolResults: ToolResultMessage[];
	/** agent.state.messages 中最后一条 assistant 消息的纯文本 */
	assistantText: string;
	/** 结束时 systemPrompt(验证 persona / 教学进度换入) */
	systemPrompt: string;
	/** 结束时的错误(abort / provider 错误时存在) */
	errorMessage: string | undefined;
}

/** 组装一个可注入 createAgent 的 faux 模型集合。 */
export function makeFauxModels() {
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	return { models, faux, providerId: "faux", modelId: "faux-1" };
}

/** 从 toolResult 消息的 content 抽 text 块。 */
export function textOfToolResult(tr: ToolResultMessage): string {
	const blocks = Array.isArray(tr.content) ? (tr.content as Array<{ type?: string; text?: string }>) : [];
	return blocks
		.filter((b) => b.type === "text")
		.map((b) => b.text ?? "")
		.join("\n");
}

/** 从 assistant 消息抽文本(toolCall 之外的 text 块拼接)。 */
function assistantTextOf(content: Array<{ type?: string; text?: string }> | undefined): string {
	if (!Array.isArray(content)) return "";
	return content
		.filter((b) => b.type === "text")
		.map((b) => b.text ?? "")
		.join("");
}

/**
 * 用 faux 脚本驱动一轮运行并收集证据:
 *  - 新建 models + faux,注入响应队列
 *  - createAgent({...options, models, providerId:"faux", modelId:"faux-1"})
 *  - agent.prompt(userMsg)
 *  - 从 agent.state.messages 抽取工具序列/结果文本/assistant 文本/systemPrompt/errorMessage
 * 返回 { evidence, edu }(edu 内含 vfs 与 shared,便于进一步断言)。
 */
export async function runFauxCase(opts: {
	responses: FauxResponseStep[];
	systemPrompt?: string;
	prompt?: string;
	agentOptions?: CreateAgentOptions;
}): Promise<{ evidence: FauxEvidence; edu: EduAgent }> {
	const { models, faux, providerId, modelId } = makeFauxModels();
	faux.setResponses(opts.responses);

	const edu = createAgent({
		...opts.agentOptions,
		models,
		providerId,
		modelId,
		systemPrompt: opts.systemPrompt,
	});
	const agent = edu.agent;

	await agent.prompt(opts.prompt ?? "你好，请开始教学。");

	const toolCalls: ToolCallEvidence[] = [];
	const toolResults: ToolResultMessage[] = [];
	for (const m of agent.state.messages) {
		if (m.role === "assistant") {
			const content = (m as { content?: Array<{ type?: string; name?: string; arguments?: unknown }> }).content;
			if (Array.isArray(content)) {
				for (const block of content) {
					if (block.type === "toolCall" && typeof block.name === "string") {
						toolCalls.push({
							name: block.name,
							args: (block.arguments ?? {}) as Record<string, unknown>,
							isError: false,
							resultText: "",
						});
					}
				}
			}
		} else if (m.role === "toolResult") {
			const tr = m as ToolResultMessage & { content?: Array<{ type?: string; text?: string }> };
			toolResults.push(tr);
			// 将结果附着到「下一个未填结果的工具调用」上(工具执行是按 assistant 消息顺序的)
			const pending = toolCalls.find((c) => !c.resultText);
			if (pending) {
				pending.isError = tr.isError ?? false;
				pending.resultText = textOfToolResult(tr as ToolResultMessage);
			}
		}
	}

	let assistantText = "";
	for (let i = agent.state.messages.length - 1; i >= 0; i--) {
		const m = agent.state.messages[i];
		if (m.role === "assistant") {
			const content = (m as { content?: Array<{ type?: string; text?: string }> }).content;
			const t = assistantTextOf(content);
			if (t) {
				assistantText = t;
				break;
			}
		}
	}

	return {
		evidence: {
			toolCalls,
			toolResults,
			assistantText,
			systemPrompt: agent.state.systemPrompt,
			errorMessage: agent.state.errorMessage,
		},
		edu,
	};
}

export type { FauxResponseStep };