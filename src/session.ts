import { createAgent } from "./agent.js";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { EduAgentConfig } from "./interfaces.js";
import { getDefaultPersonas, getPersona, resolveMention, type Persona } from "./personas.js";
import type { PersonaSource } from "./shared-state.js";
import {
	EDU_SESSION_SNAPSHOT_VERSION,
	cloneSessionSnapshot,
	validateSessionSnapshot,
	type EduSessionSnapshot,
	type EduSessionSnapshotV2,
} from "./snapshot.js";

/** 递归删除值为 undefined 的属性：运行时临时字段（如 assistant 的 deferred）不进入持久化快照。 */
function stripUndefined(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stripUndefined);
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value)) {
			if (item === undefined) continue;
			out[key] = stripUndefined(item);
		}
		return out;
	}
	return value;
}

/**
 * PiLore 会话组件的对外事件协议（纯 JSON，可跨 SSE/WebSocket/进程边界传输）。
 * 适配层（CLI / Web / 其它项目）只需消费这些事件即可渲染 UI。
 */
export type EduEvent =
	| { type: "start" }
	| { type: "text_delta"; delta: string }
	| { type: "message_end" }
	| { type: "tool_start"; toolName: string; args: unknown }
	| { type: "tool_end"; toolName: string; isError: boolean; text: string }
	// persona/name 为 null 表示切回 PiLore 自动路由
	| { type: "persona"; persona: string | null; name: string | null; source: PersonaSource }
	| { type: "error"; message: string }
	| { type: "done"; errorMessage?: string };

export type EduSessionOptions = EduAgentConfig & { snapshot?: EduSessionSnapshot };

export interface EduSession {
	/** 发送一条用户消息；事件通过 onEvent 流式回调，整轮结束后 resolve。 */
	prompt(text: string, onEvent: (event: EduEvent) => void): Promise<void>;
	abort(): void;
	/** 直接设置/清除当前老师（null = 切回 PiLore 自动路由），无需经过对话。 */
	setPersona(key: string | null): void;
	listFiles(): string[];
	readFile(path: string): string | undefined;
	/** 导出纯 JSON 会话快照；临时运行状态不会进入快照。 */
	exportSnapshot(): EduSessionSnapshotV2;
	readonly busy: boolean;
	readonly persona: Persona | undefined;
	readonly modelInfo: string;
}

/** 创建一个教学会话。不依赖任何传输层，可直接嵌入其它项目。 */
export function createEduSession(config: EduSessionOptions = {}): EduSession {
	// personas 只解析一次：createAgent、@ 解析、setPersona 全部以它为准（支持自定义集合）
	const personas = config.personas ?? getDefaultPersonas();
	const restored = config.snapshot ? validateSessionSnapshot(config.snapshot, personas) : undefined;
	const edu = createAgent({ ...config, personas });
	const { agent, vfs, model } = edu;
	if (restored) {
		vfs.clear();
		for (const [path, content] of Object.entries(restored.files)) vfs.write(path, content);
		const persona = restored.activePersonaKey ? getPersona(restored.activePersonaKey, personas) : undefined;
		edu.shared.restore(persona, restored.teachingByPersona);
		agent.state.messages = restored.messages.slice();
	}
	let busy = false;
	let emit: ((event: EduEvent) => void) | undefined;

	// persona 状态唯一源在 edu.shared：切换（工具 / @指定 / setPersona）都会触发该监听，
	// 会话层据此发 persona 事件，不再各自维护副本或解析工具结果
	edu.shared.onPersonaChange((persona, source) => {
		if (!emit) return;
		emit({ type: "persona", persona: persona?.key ?? null, name: persona?.name ?? null, source });
	});

	agent.subscribe((event) => {
		if (!emit) return;
		switch (event.type) {
			case "message_update": {
				const ev = event.assistantMessageEvent;
				if (ev.type === "text_delta") emit({ type: "text_delta", delta: ev.delta });
				break;
			}
			case "message_end":
				emit({ type: "message_end" });
				break;
			case "tool_execution_start":
				// adopt_persona 是内部工具，只以 persona 事件对外暴露
				if (event.toolName !== "adopt_persona") {
					emit({ type: "tool_start", toolName: event.toolName, args: event.args });
				}
				break;
			case "tool_execution_end": {
				if (event.toolName === "adopt_persona") {
					// persona 变化已由 onPersonaChange 发出，这里只跳过工具卡渲染
					break;
				}
				const text = (event.result?.content ?? [])
					.filter((block: { type: string }) => block.type === "text")
					.map((block: { text: string }) => block.text)
					.join("\n")
					.slice(0, 8000);
				emit({ type: "tool_end", toolName: event.toolName, isError: event.isError, text });
				break;
			}
			default:
				break;
		}
	});

	return {
		get busy() {
			return busy;
		},
		get persona() {
			return edu.shared.activePersona;
		},
		get modelInfo() {
			return `${model.provider}/${model.id}`;
		},
		listFiles: () => vfs.list(),
		readFile: (path) => {
			try {
				return vfs.read(path);
			} catch {
				return undefined;
			}
		},
		exportSnapshot: () =>
			cloneSessionSnapshot({
				version: EDU_SESSION_SNAPSHOT_VERSION,
				revision: restored?.revision ?? 0,
				activePersonaKey: edu.shared.activePersona?.key ?? null,
				teachingByPersona: edu.shared.exportTeaching(),
				files: vfs.toRecord(),
				messages: agent.state.messages.map((m) => stripUndefined(m) as AgentMessage),
			}),
		abort: () => agent.abort(),
		setPersona: (key) => {
			if (busy) throw new Error("对话进行中不能切换教学方法，请先等待或中止");
			// 结构性激活：共享状态 + 追加式内部上下文；system prompt 始终保持基座值。
			const persona = key ? getPersona(key, personas) : undefined;
			edu.setActivePersona(persona);
		},
		async prompt(text, onEvent) {
			if (busy) throw new Error("上一轮对话还在进行，请先等待或中止");
			busy = true;
			emit = onEvent;
			// 用户查询是切换预算的边界:同一查询内模型多次 adopt 才受护栏约束
			edu.shared.resetUserTurn();
			let message = text;
			try {
				const mention = resolveMention(text, personas);
				if (mention) {
					// @指定：结构性激活（追加内部上下文），persona 事件由 onPersonaChange 发出
					const persona = mention.persona ?? undefined;
					edu.setActivePersona(persona);
					message = mention.rest;
				}
				onEvent({ type: "start" });
				await agent.prompt(message);
				const errorMessage = agent.state.errorMessage;
				if (errorMessage) onEvent({ type: "error", message: errorMessage });
				onEvent({ type: "done", errorMessage });
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				onEvent({ type: "error", message: msg });
				onEvent({ type: "done", errorMessage: msg });
			} finally {
				busy = false;
				emit = undefined;
			}
		},
	};
}
