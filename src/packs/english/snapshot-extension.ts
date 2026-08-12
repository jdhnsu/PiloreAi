import type { JsonValue, SnapshotExtension } from "../../core/types.js";
import type { EnglishMentorState, EnglishMentorProgress, PracticeRecord } from "./state.js";
import type { VocabBank, WordEntry } from "./vocab.js";
export interface EnglishSnapshotData extends Record<string, JsonValue> { progressByProfile: Record<string, EnglishMentorProgress>; vocabulary: Record<string, WordEntry>; practiceLog: PracticeRecord[] }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function isWordEntry(value: unknown): value is WordEntry { return record(value) && typeof value.word === "string" && typeof value.meaning === "string" && typeof value.phonetic === "string" && typeof value.example === "string" && typeof value.pos === "string"; }
function isPracticeRecord(value: unknown): value is PracticeRecord { return record(value) && typeof value.type === "string" && typeof value.ts === "string" && Array.isArray(value.items) && value.items.every((it) => record(it) && typeof it.item === "string" && typeof it.answer === "string" && (it.correct === null || typeof it.correct === "boolean") && typeof it.feedback === "string"); }
export function createEnglishSnapshotExtension(state: EnglishMentorState, bank: VocabBank, profileKeys: string[]): SnapshotExtension<EnglishSnapshotData> {
	return { key: "english", export: () => ({ progressByProfile: JSON.parse(JSON.stringify(state.progressByProfile)), vocabulary: bank.toRecord(), practiceLog: JSON.parse(JSON.stringify(state.practiceLog)) }), validate(value) {
		if (!record(value) || !record(value.progressByProfile) || !record(value.vocabulary) || !Array.isArray(value.practiceLog)) throw new Error("extensions.english 非法");
		const progressByProfile: Record<string, EnglishMentorProgress> = {};
		for (const [key, p] of Object.entries(value.progressByProfile)) { if (!profileKeys.includes(key) || !record(p) || typeof p.stage !== "string" || typeof p.topic !== "string" || !Array.isArray(p.covered) || !p.covered.every((x) => typeof x === "string") || !Array.isArray(p.pending) || !p.pending.every((x) => typeof x === "string")) throw new Error(`extensions.english.progressByProfile.${key} 非法`); progressByProfile[key] = p as unknown as EnglishMentorProgress; }
		const vocabulary: Record<string, WordEntry> = {};
		for (const [word, entry] of Object.entries(value.vocabulary)) { if (!isWordEntry(entry) || entry.word !== word) throw new Error(`extensions.english.vocabulary.${word} 非法`); vocabulary[word] = entry; }
		const practiceLog = value.practiceLog.map((item, index) => { if (!isPracticeRecord(item)) throw new Error(`extensions.english.practiceLog[${index}] 非法`); return item; });
		return { progressByProfile, vocabulary, practiceLog };
	}, restore(value) { state.progressByProfile = JSON.parse(JSON.stringify(value.progressByProfile)); state.practiceLog = JSON.parse(JSON.stringify(value.practiceLog)); bank.restore(value.vocabulary); } };
}
