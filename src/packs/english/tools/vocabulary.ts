import { Type } from "@pilore/pi-ai";
import type { AgentTool } from "@pilore/pi-agent-core";
import type { VocabBank, WordEntry } from "../vocab.js";
function format(entry: WordEntry): string { const head = [entry.word, entry.phonetic ? `/${entry.phonetic}/` : "", entry.pos ? `[${entry.pos}]` : ""].filter(Boolean).join(" "); return `- ${head}：${entry.meaning}${entry.example ? `\n  例：${entry.example}` : ""}`; }
export function createVocabularyTools(bank: VocabBank): AgentTool<any>[] {
	const learnParams = Type.Object({ word: Type.String(), meaning: Type.String(), phonetic: Type.Optional(Type.String()), pos: Type.Optional(Type.String()), example: Type.Optional(Type.String()) });
	const listParams = Type.Object({ query: Type.Optional(Type.String()) });
	const forgetParams = Type.Object({ word: Type.String() });
	return [
		{ name: "learn_word", label: "收录单词", description: "把生词写入学习者的词汇本（词库）。", parameters: learnParams, execute: async (_id, raw) => { const p = raw as { word: string; meaning: string; phonetic?: string; pos?: string; example?: string }; const entry = bank.add({ word: p.word, meaning: p.meaning, ...(p.phonetic ? { phonetic: p.phonetic } : {}), ...(p.pos ? { pos: p.pos } : {}), ...(p.example ? { example: p.example } : {}) }); return { content: [{ type: "text", text: `已收录 ${entry.word}（词汇本共 ${bank.count()} 个词）` }], details: { entry } }; } },
		{ name: "list_words", label: "查看词汇本", description: "列出词汇本中的单词，可按关键词过滤。", parameters: listParams, execute: async (_id, raw) => { const p = raw as { query?: string }; const q = p.query?.trim().toLowerCase(); const words = bank.list().filter((w) => !q || w.word.includes(q) || w.meaning.toLowerCase().includes(q)); if (!words.length) return { content: [{ type: "text", text: "词汇本为空或没有匹配项" }], details: { count: 0 } }; return { content: [{ type: "text", text: `词汇本（${words.length}/${bank.count()}）:\n${words.map(format).join("\n")}` }], details: { count: words.length } }; } },
		{ name: "forget_word", label: "移除单词", description: "从词汇本中移除一个单词。", parameters: forgetParams, execute: async (_id, raw) => { const p = raw as { word: string }; if (!bank.remove(p.word)) throw new Error(`词汇本中没有 ${p.word}`); return { content: [{ type: "text", text: `已移除 ${p.word}（剩 ${bank.count()} 个词）` }], details: { word: p.word } }; } },
	];
}
