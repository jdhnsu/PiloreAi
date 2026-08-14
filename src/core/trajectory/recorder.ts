import type { Agent, AgentEvent, AgentTool } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, TextContent, Usage } from "@earendil-works/pi-ai";
import { INTERNAL_TOOL_NAMES } from "../tool-runtime/index.js";
import type { CoreState } from "../state/index.js";
import type { ProfileChangeSource } from "../events/index.js";
import type { TrajectoryRunDraft, TrajectoryStep, TrajectoryToolSchema, TrajectoryToolStep, TrajectoryTurn } from "./types.js";

/** Plain-text tool result cap, aligned with the SessionEvent transport limit. */
const TOOL_RESULT_TEXT_LIMIT = 8000;

function toolResultText(result: { content?: Array<{ type: string; text?: string }> } | undefined): { text: string; truncated: boolean } {
	const text = (result?.content ?? [])
		.filter((block) => block.type === "text")
		.map((block) => block.text ?? "")
		.join("\n");
	return text.length > TOOL_RESULT_TEXT_LIMIT
		? { text: text.slice(0, TOOL_RESULT_TEXT_LIMIT), truncated: true }
		: { text, truncated: false };
}

function assistantText(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("");
}

/** JSON-safe projection of a TypeBox schema; null when serialization fails. */
function serializeParameters(parameters: unknown): unknown {
	try {
		const json = JSON.stringify(parameters);
		return json === undefined ? null : JSON.parse(json);
	} catch {
		return null;
	}
}

/** Call-time model-visible schema of one tool. */
function toolSchema(tool: AgentTool<any>): TrajectoryToolSchema {
	return {
		name: tool.name,
		label: tool.label,
		description: tool.description,
		parameters: serializeParameters(tool.parameters),
	};
}

interface ToolDraft {
	callId: string;
	toolName: string;
	args: unknown;
	startedAt: number;
	schema?: TrajectoryToolSchema;
}

interface TurnDraft {
	turn: number;
	startedAt: number;
	steps: TrajectoryStep[];
	provider: string | null;
	model: string | null;
	systemPrompt?: string;
	tools?: TrajectoryToolSchema[];
	usage?: Usage;
}

/**
 * Run-scoped trajectory recorder: folds agent lifecycle events into one
 * `TrajectoryRunDraft` per `prompt()` while a run is active.
 */
export interface TrajectoryRecorder {
	/** Start recording one run; resets any previous recording state. */
	begin(input: string): void;
	/** Finalize and clear the active run; returns null when no run was begun. */
	finish(errorMessage?: string): TrajectoryRunDraft | null;
	/** Unsubscribe from the agent and state listeners. */
	dispose(): void;
}

/**
 * Create a recorder bound to an Agent and CoreState. Events observed before
 * the first `turn_start` land in a turn-0 prelude so no step is lost.
 *
 * @param options - the Agent to subscribe and the CoreState for profile facts.
 * @returns the recorder; call `dispose()` when the owning Session is discarded.
 */
export function createTrajectoryRecorder(options: { agent: Agent; state: CoreState }): TrajectoryRecorder {
	let active = false;
	let runStartedAt = 0;
	let runInput = "";
	let outputText = "";
	let turns: TrajectoryTurn[] = [];
	let prelude: TrajectoryStep[] = [];
	let current: TurnDraft | null = null;
	let tool: ToolDraft | null = null;

	const now = (): number => Date.now();

	const schemaByName = (name: string): TrajectoryToolSchema | undefined => {
		const candidate = options.agent.state.tools.find((item) => item.name === name);
		return candidate === undefined ? undefined : toolSchema(candidate);
	};

	const closeTool = (
		steps: TrajectoryStep[],
		draft: ToolDraft,
		completedAt: number,
		resultText: string,
		resultTruncated: boolean,
		isError: boolean,
	): void => {
		const step: TrajectoryToolStep = {
			kind: "tool",
			callId: draft.callId,
			toolName: draft.toolName,
			args: draft.args,
			resultText,
			resultTruncated,
			isError,
			...(draft.schema === undefined ? {} : { schema: draft.schema }),
			startedAt: draft.startedAt,
			completedAt,
			durationMs: Math.max(0, completedAt - draft.startedAt),
		};
		steps.push(step);
	};

	const finalizeCurrent = (completedAt: number): void => {
		const target = current;
		current = null;
		if (target === null) return;
		if (tool !== null) {
			closeTool(target.steps, tool, completedAt, "", false, true);
			tool = null;
		}
		const profile = options.state.activeProfile;
		const turn: TrajectoryTurn = {
			turn: target.turn,
			profileKey: profile?.key ?? null,
			profileName: profile?.name ?? null,
			provider: target.provider,
			model: target.model,
			...(target.systemPrompt === undefined ? {} : { systemPrompt: target.systemPrompt }),
			...(target.tools === undefined ? {} : { tools: target.tools }),
			startedAt: target.startedAt,
			completedAt,
			durationMs: Math.max(0, completedAt - target.startedAt),
			...(target.usage === undefined ? {} : { usage: target.usage }),
			steps: target.steps,
		};
		turns.push(turn);
	};

	const unsubscribeProfile = options.state.onProfileChange((profile, source: ProfileChangeSource) => {
		if (!active) return;
		const step: TrajectoryStep = {
			kind: "profile",
			profile: profile?.key ?? null,
			name: profile?.name ?? null,
			source,
			time: now(),
		};
		if (current === null) prelude.push(step);
		else current.steps.push(step);
	});

	const unsubscribeToolset = options.state.onToolsetChange((toolset, isActive) => {
		if (!active) return;
		const step: TrajectoryStep = { kind: "toolset", toolset, active: isActive, time: now() };
		if (current === null) prelude.push(step);
		else current.steps.push(step);
	});

	const unsubscribeAgent = options.agent.subscribe((event: AgentEvent) => {
		if (!active) return;
		if (event.type === "turn_start") {
			if (current !== null) finalizeCurrent(now());
			current = {
				turn: turns.length + 1,
				startedAt: now(),
				steps: [],
				provider: null,
				model: null,
				systemPrompt: options.agent.state.systemPrompt,
				tools: options.agent.state.tools.map(toolSchema),
			};
			return;
		}
		if (event.type === "message_update") {
			if (event.assistantMessageEvent.type === "text_delta") outputText += event.assistantMessageEvent.delta;
			return;
		}
		if (event.type === "turn_end") {
			const target = current;
			if (target === null) return;
			const message = event.message;
			if (message.role === "assistant") {
				const text = assistantText(message);
				if (text !== "") target.steps.push({ kind: "text", text, time: now() });
				target.provider = message.provider;
				target.model = message.model;
				target.usage = message.usage;
			}
			finalizeCurrent(now());
			return;
		}
		if (event.type === "tool_execution_start") {
			if (INTERNAL_TOOL_NAMES.has(event.toolName)) return;
			const schema = schemaByName(event.toolName);
			tool = {
				callId: event.toolCallId,
				toolName: event.toolName,
				args: event.args,
				startedAt: now(),
				...(schema === undefined ? {} : { schema }),
			};
			return;
		}
		if (event.type === "tool_execution_end") {
			if (INTERNAL_TOOL_NAMES.has(event.toolName)) return;
			const draft = tool;
			tool = null;
			if (draft === null) return;
			const result = toolResultText(event.result);
			closeTool(
				current === null ? prelude : current.steps,
				draft,
				now(),
				result.text,
				result.truncated,
				event.isError,
			);
		}
	});

	const stepTime = (step: TrajectoryStep): number => (step.kind === "tool" ? step.startedAt : step.time);

	return {
		begin(input: string): void {
			active = true;
			runStartedAt = now();
			runInput = input;
			outputText = "";
			turns = [];
			prelude = [];
			current = null;
			tool = null;
		},
		finish(errorMessage?: string): TrajectoryRunDraft | null {
			if (!active) return null;
			active = false;
			const completedAt = now();
			if (tool !== null) {
				closeTool(prelude, tool, completedAt, "", false, true);
				tool = null;
			}
			if (current !== null) finalizeCurrent(completedAt);
			if (prelude.length > 0) {
				const profile = options.state.activeProfile;
				const preludeTurn: TrajectoryTurn = {
					turn: 0,
					profileKey: profile?.key ?? null,
					profileName: profile?.name ?? null,
					provider: null,
					model: null,
					startedAt: Math.min(...prelude.map(stepTime)),
					completedAt,
					durationMs: Math.max(0, completedAt - Math.min(...prelude.map(stepTime))),
					steps: prelude,
				};
				turns.unshift(preludeTurn);
			}
			const draft: TrajectoryRunDraft = {
				input: runInput,
				outputText,
				...(errorMessage === undefined ? {} : { errorMessage }),
				startedAt: runStartedAt,
				completedAt,
				turns,
			};
			runStartedAt = 0;
			runInput = "";
			outputText = "";
			turns = [];
			prelude = [];
			return draft;
		},
		dispose(): void {
			unsubscribeProfile();
			unsubscribeToolset();
			unsubscribeAgent();
		},
	};
}
