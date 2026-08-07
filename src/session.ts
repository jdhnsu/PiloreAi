import { createAgent, type CreateAgentOptions } from "./agent.js";
import { getPersona, resolveMention, type Persona, type PersonaKey } from "./personas.js";

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
	| { type: "persona"; persona: PersonaKey | null; name: string | null; source: "model" | "user" }
	| { type: "error"; message: string }
	| { type: "done"; errorMessage?: string };

export type EduSessionOptions = Omit<CreateAgentOptions, "vfs">;

export interface EduSession {
	/** 发送一条用户消息；事件通过 onEvent 流式回调，整轮结束后 resolve。 */
	prompt(text: string, onEvent: (event: EduEvent) => void): Promise<void>;
	abort(): void;
	/** 直接设置/清除当前老师（null = 切回 PiLore 自动路由），无需经过对话。 */
	setPersona(key: PersonaKey | null): void;
	listFiles(): string[];
	readFile(path: string): string | undefined;
	readonly busy: boolean;
	readonly persona: Persona | undefined;
	readonly modelInfo: string;
}

/** 创建一个教学会话。不依赖任何传输层，可直接嵌入其它项目。 */
export function createEduSession(options: EduSessionOptions = {}): EduSession {
	const { agent, vfs, model } = createAgent(options);
	let busy = false;
	let currentPersona: Persona | undefined;
	let emit: ((event: EduEvent) => void) | undefined;

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
					const key = String(event.result?.details?.persona ?? "");
					// auto = 模型判断教学阶段结束，交还 PiLore 自动路由
					if (key === "auto") {
						if (currentPersona) {
							currentPersona = undefined;
							emit({ type: "persona", persona: null, name: null, source: "model" });
						}
						break;
					}
					const persona = getPersona(key);
					if (persona) {
						currentPersona = persona;
						emit({ type: "persona", persona: persona.key, name: persona.name, source: "model" });
					}
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
			return currentPersona;
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
		abort: () => agent.abort(),
		setPersona: (key) => {
			currentPersona = key ? getPersona(key) : undefined;
		},
		async prompt(text, onEvent) {
			if (busy) throw new Error("上一轮对话还在进行，请先等待或中止");
			busy = true;
			emit = onEvent;
			let message = text;
			try {
				const mention = resolveMention(text);
				if (mention) {
					currentPersona = mention.persona ?? undefined;
					onEvent({
						type: "persona",
						persona: mention.persona?.key ?? null,
						name: mention.persona?.name ?? null,
						source: "user",
					});
					// @pilore 只清除指定，不注入教学方法前缀
					message = mention.persona ? `【指定教学方法：${mention.persona.name}】${mention.rest}` : mention.rest;
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
