import type { JsonValue } from "../../core/types.js";
export interface MentorProgress extends Record<string, JsonValue> { stage: string; topic: string; covered: string[]; pending: string[] }
export interface CodeMentorState extends Record<string, JsonValue> { progressByProfile: Record<string, MentorProgress>; evaluations: JsonValue[] }
export function createCodeMentorState(): CodeMentorState { return { progressByProfile: {}, evaluations: [] }; }
export function updateMentorProgress(state: CodeMentorState, key: string, partial: Partial<MentorProgress>): MentorProgress { const current = state.progressByProfile[key] ?? { stage: "", topic: "", covered: [], pending: [] }; return state.progressByProfile[key] = { stage: partial.stage ?? current.stage, topic: partial.topic ?? current.topic, covered: partial.covered ?? current.covered, pending: partial.pending ?? current.pending }; }
