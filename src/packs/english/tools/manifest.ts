import type { ToolManifest } from "../../../core/types.js";
import type { VocabBank } from "../vocab.js";
import type { EnglishMentorState } from "../state.js";
import type { EnglishEvaluator } from "../evaluator.js";
import { createVocabularyTools } from "./vocabulary.js";
import { createPracticeTools } from "./practice.js";
export function createEnglishToolManifest(vocab: VocabBank, state: EnglishMentorState, evaluator?: EnglishEvaluator): ToolManifest {
	return { groups: [
		{ key: "vocabulary", description: "管理学习者的词汇本（收录/查看/移除单词）", load: () => createVocabularyTools(vocab) },
		{ key: "practice", description: "发起英语练习并提交批改答案", load: () => createPracticeTools(state, evaluator) },
	], capabilities: { learn_word: ["vocab.write"], forget_word: ["vocab.write"], list_words: ["vocab.read"], start_practice: ["practice.run"], submit_answer: ["practice.run"] }, resolveCapability(toolName) { if (toolName === "learn_word" || toolName === "forget_word") return "vocab.write"; if (toolName === "list_words") return "vocab.read"; if (toolName === "start_practice" || toolName === "submit_answer") return "practice.run"; return undefined; } };
}
