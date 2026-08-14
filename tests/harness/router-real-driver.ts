import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
	createCodeMentorSession,
	createModelCollection,
	type SessionEvent,
} from "../../src/index.js";
import type { RouterRealCase, RouterTurnExpectation } from "../cases/router-real.js";

export interface RouterRealRunOptions {
	providerId: string;
	modelId: string;
	thinkingLevel: ThinkingLevel;
	maxTurns?: number;
}

export interface RouterTurnEvidence {
	prompt: string;
	expectedStartProfile: string | null;
	expectedEndProfile: string | null;
	metric?: RouterTurnExpectation["metric"];
	actualStartProfile: string | null;
	actualEndProfile: string | null;
	modelProfileEvents: Array<{ profile: string | null; name: string | null }>;
	switchCount: number;
	passed: boolean;
	error?: string;
}

export interface RouterCaseRoundEvidence {
	passed: boolean;
	measuredPassed: boolean;
	thrashCount: number;
	errorCount: number;
	turns: RouterTurnEvidence[];
}

function eventError(events: SessionEvent[]): string | undefined {
	return events.find((event): event is Extract<SessionEvent, { type: "error" }> => event.type === "error")?.message;
}

export function evaluateRouterTurn(expected: RouterTurnExpectation, evidence: Omit<RouterTurnEvidence, "passed">): boolean {
	if (evidence.error) return false;
	if (evidence.actualStartProfile !== expected.startProfile || evidence.actualEndProfile !== expected.endProfile) return false;
	if (expected.startProfile === expected.endProfile) return evidence.modelProfileEvents.length === 0;
	return evidence.modelProfileEvents.length === 1
		&& evidence.modelProfileEvents[0]?.profile === expected.endProfile;
}

export async function runRouterCaseRound(
	definition: RouterRealCase,
	options: RouterRealRunOptions,
): Promise<RouterCaseRoundEvidence> {
	const models = createModelCollection();
	const session = createCodeMentorSession({
		models,
		providerId: options.providerId,
		modelId: options.modelId,
		thinkingLevel: options.thinkingLevel,
		maxTurns: options.maxTurns ?? 8,
	});
	const turns: RouterTurnEvidence[] = [];

	for (const expected of definition.turns) {
		const actualStartProfile = session.profile;
		const events: SessionEvent[] = [];
		let thrown: string | undefined;
		try {
			await session.prompt(expected.prompt, (event) => events.push(event));
		} catch (error) {
			thrown = error instanceof Error ? error.message : String(error);
		}
		const modelProfileEvents = events.flatMap((event) =>
			event.type === "profile" && event.source === "model"
				? [{ profile: event.profile, name: event.name }]
				: [],
		);
		const partial: Omit<RouterTurnEvidence, "passed"> = {
			prompt: expected.prompt,
			expectedStartProfile: expected.startProfile,
			expectedEndProfile: expected.endProfile,
			...(expected.metric ? { metric: expected.metric } : {}),
			actualStartProfile,
			actualEndProfile: session.profile,
			modelProfileEvents,
			switchCount: modelProfileEvents.length,
			...(thrown || eventError(events) ? { error: thrown ?? eventError(events) } : {}),
		};
		turns.push({ ...partial, passed: evaluateRouterTurn(expected, partial) });
		if (partial.error) break;
	}

	const measured = turns.find((turn) => turn.metric);
	return {
		passed: turns.length === definition.turns.length && turns.every((turn) => turn.passed),
		measuredPassed: measured?.passed ?? false,
		thrashCount: turns.filter((turn) => turn.switchCount > 1).length,
		errorCount: turns.filter((turn) => Boolean(turn.error)).length,
		turns,
	};
}
