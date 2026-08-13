import type { JsonValue } from "../../../core/types.js";

export interface AcademicProgress extends Record<string, JsonValue> {
	stage: string;
	topic: string;
	covered: string[];
	pending: string[];
}

export interface AcademicPracticeItem extends Record<string, JsonValue> {
	prompt: string;
	answer: string;
	reference: string;
	correct: boolean | null;
	feedback: string;
}

export interface AcademicPracticeRecord extends Record<string, JsonValue> {
	type: string;
	ts: string;
	items: AcademicPracticeItem[];
}

export interface AcademicMentorState extends Record<string, JsonValue> {
	progressByProfile: Record<string, AcademicProgress>;
	practiceLog: AcademicPracticeRecord[];
}

export function createAcademicMentorState(): AcademicMentorState {
	return { progressByProfile: {}, practiceLog: [] };
}

export function updateAcademicProgress(
	state: AcademicMentorState,
	key: string,
	partial: Partial<AcademicProgress>,
): AcademicProgress {
	const current = state.progressByProfile[key] ?? { stage: "", topic: "", covered: [], pending: [] };
	return state.progressByProfile[key] = {
		stage: partial.stage ?? current.stage,
		topic: partial.topic ?? current.topic,
		covered: partial.covered ?? current.covered,
		pending: partial.pending ?? current.pending,
	};
}

export function addAcademicPracticeRecord(state: AcademicMentorState, record: AcademicPracticeRecord): number {
	state.practiceLog.push(record);
	return state.practiceLog.length;
}
