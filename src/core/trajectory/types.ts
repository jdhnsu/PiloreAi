import type { Usage } from "@earendil-works/pi-ai";
import type { ProfileChangeSource } from "../events/index.js";

/** One executed tool call inside a trajectory turn. */
export interface TrajectoryToolStep {
	kind: "tool";
	callId: string;
	toolName: string;
	args: unknown;
	/** Plain-text result, truncated to the 2000-character audit cap. */
	resultText: string;
	isError: boolean;
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
