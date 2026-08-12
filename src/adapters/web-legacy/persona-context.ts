import { createHash } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Message, UserMessage } from "@earendil-works/pi-ai";
import type { Persona } from "./personas.js";
import type { TeachingProgress } from "./shared-state.js";

/** PiLore 持久化到会话历史、但不直接展示给学习者的教学方法激活消息。 */
export interface PersonaContextMessage {
	role: "pilorePersonaContext";
	personaKey: string | null;
	personaName: string | null;
	personaHash: string | null;
	methodology: string | null;
	teachingProgress?: TeachingProgress;
	timestamp: number;
}

declare module "@earendil-works/pi-agent-core" {
	interface CustomAgentMessages {
		pilorePersonaContext: PersonaContextMessage;
	}
}

function stableValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stableValue);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, item]) => [key, stableValue(item)]),
		);
	}
	return value;
}

/** 可由快照字段独立复算的方法论哈希，既用于防损坏，也用于检测方法论升级。 */
export function hashPersonaMethodology(personaKey: string, personaName: string, methodology: string): string {
	const definition = { key: personaKey, name: personaName, methodology };
	return createHash("sha256").update(JSON.stringify(stableValue(definition))).digest("hex");
}

/** Persona 方法论的稳定内容哈希；file 路径不参与，便于配置中心与文件来源互换。 */
export function hashPersona(persona: Persona): string {
	return hashPersonaMethodology(persona.key, persona.name, persona.prompt);
}

function cloneTeaching(teaching: TeachingProgress | undefined): TeachingProgress | undefined {
	if (!teaching) return undefined;
	return { ...teaching, covered: [...teaching.covered], pending: [...teaching.pending] };
}

export function createPersonaContextMessage(
	persona: Persona | undefined,
	teaching?: TeachingProgress,
	timestamp = Date.now(),
): PersonaContextMessage {
	return persona
		? {
				role: "pilorePersonaContext",
				personaKey: persona.key,
				personaName: persona.name,
				personaHash: hashPersona(persona),
				methodology: persona.prompt,
				...(teaching ? { teachingProgress: cloneTeaching(teaching) } : {}),
				timestamp,
			}
		: {
				role: "pilorePersonaContext",
				personaKey: null,
				personaName: null,
				personaHash: null,
				methodology: null,
				timestamp,
			};
}

export function isPersonaContextMessage(message: { role: string }): message is PersonaContextMessage {
	return message.role === "pilorePersonaContext";
}

function renderTeaching(teaching: TeachingProgress | undefined): string {
	if (!teaching) return "- 尚未开始记录（随阶段推进用 update_teaching 工具更新）";
	return [
		`- 阶段：${teaching.stage || "（未标注）"}　·　主题：${teaching.topic || "（未标注）"}`,
		teaching.covered.length ? `- 已覆盖：${teaching.covered.join("；")}` : "",
		teaching.pending.length ? `- 待展开：${teaching.pending.join("；")}` : "",
	]
		.filter(Boolean)
		.join("\n");
}

/** 渲染给模型的受信任内部上下文；文本只来自已校验 Persona 与 SharedState。 */
export function renderPersonaContext(message: PersonaContextMessage): string {
	if (message.personaKey === null) {
		return `<pilore_persona_context>\n当前教学模式：PiLore 自动路由。根据下一条学习者问题重新判断教学方法；简单事实问题可直接回答。\n</pilore_persona_context>`;
	}
	return `<pilore_persona_context>\n当前教学模式：${message.personaName}（@${message.personaKey}）。
严格执行下文方法论的流程与输出格式，不要重新判断或擅自换方法；阶段完成或主题明显变化时可调用 adopt_persona 交还或切换。
用 update_teaching 维护教学进度。

## 当前教学进度
${renderTeaching(message.teachingProgress)}

# 教学方法：${message.personaName}

${message.methodology}
</pilore_persona_context>`;
}

function mergeWithUser(context: PersonaContextMessage, user: UserMessage): UserMessage {
	const internal = { type: "text" as const, text: renderPersonaContext(context) };
	return {
		role: "user",
		timestamp: user.timestamp,
		content:
			typeof user.content === "string"
				? `${internal.text}\n\n<learner_message>\n${user.content}\n</learner_message>`
				: [internal, ...user.content],
	};
}

/** 将内部 Persona 消息与其后的学习者消息合并；未配对的末尾上下文暂不发送。 */
export function convertPiLoreMessages(messages: AgentMessage[]): Message[] {
	const converted: Message[] = [];
	for (let index = 0; index < messages.length; index += 1) {
		const message = messages[index];
		if (isPersonaContextMessage(message)) {
			const next = messages[index + 1];
			if (next?.role === "user") {
				converted.push(mergeWithUser(message, next));
				index += 1;
			}
			continue;
		}
		if (message.role === "user" || message.role === "assistant" || message.role === "toolResult") converted.push(message);
	}
	return converted;
}

/** 追加手动切换消息；尚未发送的末尾上下文可安全合并为最后一次选择。 */
export function appendPersonaContext(messages: AgentMessage[], context: PersonaContextMessage): AgentMessage[] {
	const next = messages.slice();
	if (next.length > 0 && isPersonaContextMessage(next[next.length - 1])) next[next.length - 1] = context;
	else next.push(context);
	return next;
}
