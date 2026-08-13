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

export function validateAcademicProgressPatch(value: unknown): Partial<AcademicProgress> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("profile state patch 必须是对象");
	const patch = value as Record<string, unknown>;
	const allowed = new Set(["stage", "topic", "covered", "pending"]);
	for (const key of Object.keys(patch)) if (!allowed.has(key)) throw new Error(`不支持的 profile state 字段: ${key}`);
	for (const key of ["stage", "topic"] as const) if (patch[key] !== undefined && typeof patch[key] !== "string") throw new Error(`profile state.${key} 必须是字符串`);
	for (const key of ["covered", "pending"] as const) if (patch[key] !== undefined && (!Array.isArray(patch[key]) || !patch[key].every((item) => typeof item === "string"))) throw new Error(`profile state.${key} 必须是字符串数组`);
	return patch as Partial<AcademicProgress>;
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
