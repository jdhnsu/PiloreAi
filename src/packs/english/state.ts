import type { JsonValue } from "../../core/types.js";
export interface EnglishMentorProgress extends Record<string, JsonValue> { stage: string; topic: string; covered: string[]; pending: string[] }
export interface PracticeItem extends Record<string, JsonValue> { item: string; answer: string; correct: boolean | null; feedback: string }
export interface PracticeRecord extends Record<string, JsonValue> { type: string; ts: string; items: PracticeItem[] }
export interface EnglishMentorState extends Record<string, JsonValue> { progressByProfile: Record<string, EnglishMentorProgress>; practiceLog: PracticeRecord[] }
export function createEnglishMentorState(): EnglishMentorState { return { progressByProfile: {}, practiceLog: [] }; }
export function validateMentorProgressPatch(value: unknown): Partial<EnglishMentorProgress> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("profile state patch 必须是对象");
	const patch = value as Record<string, unknown>;
	const allowed = new Set(["stage", "topic", "covered", "pending"]);
	for (const key of Object.keys(patch)) if (!allowed.has(key)) throw new Error(`不支持的 profile state 字段: ${key}`);
	for (const key of ["stage", "topic"] as const) if (patch[key] !== undefined && typeof patch[key] !== "string") throw new Error(`profile state.${key} 必须是字符串`);
	for (const key of ["covered", "pending"] as const) if (patch[key] !== undefined && (!Array.isArray(patch[key]) || !patch[key].every((item) => typeof item === "string"))) throw new Error(`profile state.${key} 必须是字符串数组`);
	return patch as Partial<EnglishMentorProgress>;
}
export function updateMentorProgress(state: EnglishMentorState, key: string, partial: Partial<EnglishMentorProgress>): EnglishMentorProgress { const current = state.progressByProfile[key] ?? { stage: "", topic: "", covered: [], pending: [] }; return state.progressByProfile[key] = { stage: partial.stage ?? current.stage, topic: partial.topic ?? current.topic, covered: partial.covered ?? current.covered, pending: partial.pending ?? current.pending }; }
export function addPracticeRecord(state: EnglishMentorState, record: PracticeRecord): number { state.practiceLog.push(record); return state.practiceLog.length; }
