import {
	createCodeMentorSession,
	getDefaultCodeProfiles,
	type CodeMentorConfig,
	type MentorProgress,
	type ProfileDefinition,
	type SessionEvent,
} from "../../src/index.js";

export interface OnlineRule {
	name: string;
	weight: number;
	judge: (evidence: OnlineEvidence) => number;
}

export interface OnlineCaseDef {
	id: string;
	name: string;
	dimension: Dimension;
	weight: number;
	prompts: string[];
	maxTurns?: number;
	rules: OnlineRule[];
}

export type Dimension = "工具纪律" | "教学行为" | "护栏" | "会话协议" | "执行后端" | "边界" | "在线路由";

export interface OnlineEvidence {
	events: SessionEvent[];
	profileEvents: { profile: string | null; name: string | null; source: string }[];
	finalProfile: ProfileDefinition | undefined;
	toolCalls: { name: string; args: unknown }[];
	profileStateUpdates: MentorProgress[];
	files: string[];
	runResults: string[];
	allText: string;
	error: string | undefined;
}

export async function runOnlineEvidence(options: CodeMentorConfig & { prompts: string[] }): Promise<OnlineEvidence> {
	const session = createCodeMentorSession({ ...options, maxTurns: options.maxTurns ?? 8 });
	const profiles = options.profiles ?? getDefaultCodeProfiles();
	const events: SessionEvent[] = [];
	const runResults: string[] = [];
	let allText = "";

	for (const text of options.prompts) {
		await session.prompt(text, (event) => {
			events.push(event);
			if (event.type === "tool_start" && event.toolName === "run_code") runResults.push("");
			if (event.type === "tool_end" && event.toolName === "run_code") runResults[runResults.length - 1] = event.text;
			if (event.type === "text_delta") allText += event.delta;
		});
	}

	const profileEvents = events.flatMap((event) =>
		event.type === "profile"
			? [{ profile: event.profile, name: event.name, source: event.source }]
			: [],
	);
	const toolCalls = events.flatMap((event) => event.type === "tool_start" ? [{ name: event.toolName, args: event.args }] : []);
	const error = events.find((event): event is Extract<SessionEvent, { type: "error" }> => event.type === "error")?.message;

	return {
		events,
		profileEvents,
		finalProfile: profiles.find((profile) => profile.key === session.profile),
		toolCalls,
		profileStateUpdates: Object.values(session.codeState.progressByProfile),
		files: session.listFiles(),
		runResults,
		allText,
		error,
	};
}

export function profileNameOf(evidence: OnlineEvidence): string | null {
	return evidence.finalProfile?.name ?? null;
}
