import type { Usage } from "@pilore/pi-ai";
import type { ProfileChangeSource } from "../events/index.js";

/** Model-visible tool schema captured at call time. */
export interface TrajectoryToolSchema {
	name: string;
	label?: string;
	description: string;
	/** JSON-safe projection of the parameters schema; null when not serializable. */
	parameters: unknown;
}

/** One executed tool call inside a trajectory turn. */
export interface TrajectoryToolStep {
	kind: "tool";
	callId: string;
	toolName: string;
	args: unknown;
	/** Plain-text result, capped at the 8000-character transport limit. */
	resultText: string;
	/** Whether `resultText` was truncated to the cap. */
	resultTruncated: boolean;
	isError: boolean;
	/** Call-time model-visible schema, when the tool was in the request catalog. */
	schema?: TrajectoryToolSchema;
	startedAt: number;
	completedAt: number;
	durationMs: number;
}

/** One trajectory step: text / tool call / profile switch / toolset activation. */
export type TrajectoryStep =
	| { kind: "text"; text: string; time: number }
	| TrajectoryToolStep
	| { kind: "profile"; profile: string | null; name: string | null; source: ProfileChangeSource; time: number }
	| { kind: "toolset"; toolset: string; active: boolean; time: number };

/** One LLM turn inside a run, finalized when the turn closes. */
export interface TrajectoryTurn {
	turn: number;
	profileKey: string | null;
	profileName: string | null;
	provider: string | null;
	model: string | null;
	/** Full system prompt sent with this turn's request. */
	systemPrompt?: string;
	/** Tool catalog visible to this turn's request. */
	tools?: TrajectoryToolSchema[];
	startedAt: number;
	completedAt: number;
	durationMs: number;
	usage?: Usage;
	steps: TrajectoryStep[];
}

/** Recorder-owned run record, completed when one `prompt()` settles. */
export interface TrajectoryRunDraft {
	input: string;
	outputText: string;
	errorMessage?: string;
	startedAt: number;
	completedAt: number;
	turns: TrajectoryTurn[];
}

/** Stored run trajectory: recorder draft plus store-owned identity. */
export interface TrajectoryRun extends TrajectoryRunDraft {
	runId: string;
	sessionId: string;
}
