import type { JsonValue } from "../../core/types.js";
export interface WordEntry extends Record<string, JsonValue> { word: string; phonetic: string; meaning: string; example: string; pos: string }
export type WordEntryInput = Pick<WordEntry, "word" | "meaning"> & Partial<Pick<WordEntry, "phonetic" | "example" | "pos">>;
function normalize(word: string): string { return word.trim().toLowerCase(); }
export class VocabBank {
	private words = new Map<string, WordEntry>();
	add(entry: WordEntryInput): WordEntry {
		if (!entry.word?.trim()) throw new Error("单词不能为空");
		if (!entry.meaning?.trim()) throw new Error("缺少释义 meaning");
		const stored: WordEntry = { word: normalize(entry.word), meaning: entry.meaning, phonetic: entry.phonetic ?? "", example: entry.example ?? "", pos: entry.pos ?? "" };
		this.words.set(stored.word, stored); return stored;
	}
	get(word: string): WordEntry | undefined { return this.words.get(normalize(word)); }
	has(word: string): boolean { return this.words.has(normalize(word)); }
	remove(word: string): boolean { return this.words.delete(normalize(word)); }
	list(): WordEntry[] { return [...this.words.values()].sort((a, b) => a.word.localeCompare(b.word)); }
	count(): number { return this.words.size; }
	clear(): void { this.words.clear(); }
	toRecord(): Record<string, WordEntry> { return Object.fromEntries(this.words); }
	restore(entries: Record<string, WordEntry>): void { this.clear(); for (const [word, entry] of Object.entries(entries)) this.words.set(normalize(word), { word: normalize(word), meaning: entry.meaning, phonetic: entry.phonetic ?? "", example: entry.example ?? "", pos: entry.pos ?? "" }); }
}
