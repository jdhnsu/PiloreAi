import type { Agent } from "@earendil-works/pi-agent-core";
import { getPersona, type Persona } from "./personas.js";

const MAGENTA = "\x1b[35m";
const RESET = "\x1b[0m";

export function personaBanner(persona: Persona, note?: string): string {
	return `${MAGENTA}[老师] ${persona.name}${note ? `（${note}）` : ""}${RESET}`;
}

export interface ConsoleRendererOptions {
	/** adopt_persona 生效后回调，CLI 用它维护"当前老师"状态 */
	onPersonaChange?: (persona: Persona) => void;
}

function summarizeArgs(args: unknown): string {
	if (!args || typeof args !== "object") return "";
	return Object.entries(args as Record<string, unknown>)
		.map(([key, value]) => {
			let text = typeof value === "string" ? value : JSON.stringify(value);
			if (text.length > 60) text = `${text.slice(0, 57)}...`;
			return `${key}=${text}`;
		})
		.join(" ");
}

/** 订阅 agent 事件并把流式文本、工具调用/结果渲染到终端。返回取消订阅函数。 */
export function attachConsoleRenderer(agent: Agent, options: ConsoleRendererOptions = {}): () => void {
	let streamingText = false;
	let currentPersonaKey: string | undefined;
	const endTextBlock = () => {
		if (streamingText) {
			streamingText = false;
			process.stdout.write("\n");
		}
	};

	return agent.subscribe((event) => {
		switch (event.type) {
			case "message_update": {
				const ev = event.assistantMessageEvent;
				if (ev.type === "text_delta") {
					if (!streamingText) {
						streamingText = true;
						process.stdout.write("\n");
					}
					process.stdout.write(ev.delta);
				}
				break;
			}
			case "message_end":
				endTextBlock();
				break;
			case "tool_execution_start":
				endTextBlock();
				if (event.toolName === "adopt_persona") break; // 内部工具，只在结果处显示老师横幅
				process.stdout.write(`\n[工具] ${event.toolName} ${summarizeArgs(event.args)}\n`);
				break;
			case "tool_execution_end": {
				if (event.toolName === "adopt_persona") {
					const persona = getPersona(String(event.result?.details?.persona ?? ""));
					if (persona && persona.key !== currentPersonaKey) {
						currentPersonaKey = persona.key;
						process.stdout.write(`\n${personaBanner(persona)}\n`);
						options.onPersonaChange?.(persona);
					}
					break;
				}
				const texts: string[] = (event.result?.content ?? [])
					.filter((block: { type: string }) => block.type === "text")
					.map((block: { text: string }) => block.text);
				let body = texts.join("\n") || "(无输出)";
				if (body.length > 1500) body = `${body.slice(0, 1500)}\n...（已截断）`;
				const header = event.isError ? "  ↳ [错误]" : "  ↳";
				process.stdout.write(`${header} ${event.toolName} 结果:\n`);
				for (const line of body.split("\n")) process.stdout.write(`      ${line}\n`);
				break;
			}
			default:
				break;
		}
	});
}
