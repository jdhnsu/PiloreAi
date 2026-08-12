import type { JsonValue } from "../../core/types.js";
export interface EnglishMentorProgress extends Record<string, JsonValue> { stage: string; topic: string; covered: string[]; pending: string[] }
export interface PracticeItem extends Record<string, JsonValue> { item: string; answer: string; correct: boolean | null; feedback: string }
export interface PracticeRecord extends Record<string, JsonValue> { type: string; ts: string; items: PracticeItem[] }
export interface EnglishMentorState extends Record<string, JsonValue> { progressByProfile: Record<string, EnglishMentorProgress>; practiceLog: PracticeRecord[] }
export function createEnglishMentorState(): EnglishMentorState { return { progressByProfile: {}, practiceLog: [] }; }
export function updateMentorProgress(state: EnglishMentorState, key: string, partial: Partial<EnglishMentorProgress>): EnglishMentorProgress { const current = state.progressByProfile[key] ?? { stage: "", topic: "", covered: [], pending: [] }; return state.progressByProfile[key] = { stage: partial.stage ?? current.stage, topic: partial.topic ?? current.topic, covered: partial.covered ?? current.covered, pending: partial.pending ?? current.pending }; }
export function addPracticeRecord(state: EnglishMentorState, record: PracticeRecord): number { state.practiceLog.push(record); return state.practiceLog.length; }
