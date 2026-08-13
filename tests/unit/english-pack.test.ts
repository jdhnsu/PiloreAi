import assert from "node:assert/strict";
import test from "node:test";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { CoreState, createEnglishToolManifest, createEnglishMentorSession, getDefaultEnglishProfiles, toolsForState, VocabBank } from "../../src/index.js";

test("English Pack owns its three default profiles", () => {
	assert.deepEqual(getDefaultEnglishProfiles().map((profile) => profile.key), ["owen", "rina", "wren"]);
});

test("English tools are absent until their toolsets are activated", () => {
	const state = new CoreState();
	const manifest = createEnglishToolManifest(new VocabBank(), { progressByProfile: {}, practiceLog: [] });
	assert.deepEqual(toolsForState(manifest, state, []).map((tool) => tool.name), []);
	state.activateToolset("vocabulary");
	assert.deepEqual(toolsForState(manifest, state, []).map((tool) => tool.name), ["learn_word", "list_words", "forget_word"]);
	state.activateToolset("practice");
	assert.deepEqual(toolsForState(manifest, state, []).map((tool) => tool.name), ["learn_word", "list_words", "forget_word", "start_practice", "submit_answer"]);
});

test("VocabBank normalizes words and refuses empty meaning", () => {
	const bank = new VocabBank();
	bank.add({ word: "Hello", meaning: "你好", phonetic: "həˈloʊ", pos: "int.", example: "Hello, nice to meet you." });
	assert.equal(bank.get("hello")?.word, "hello");
	assert.deepEqual(bank.list().map((entry) => entry.word), ["hello"]);
	assert.throws(() => bank.add({ word: "world", meaning: " " }), /缺少释义/);
	assert.equal(bank.remove("HELLO"), true);
	assert.equal(bank.count(), 0);
});

test("English Mentor dynamically activates vocabulary tools", async () => {
	const { faux, models } = setup();
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("activate_toolset", { toolset: "vocabulary" })]),
		fauxAssistantMessage([fauxToolCall("learn_word", { word: "persistent", meaning: "坚持不懈的", pos: "adj.", example: "Be persistent and you will succeed." })]),
		fauxAssistantMessage([fauxText("完成")]),
	]);
	const session = createEnglishMentorSession({ models, providerId: "faux", modelId: "faux-1" }); const events: string[] = [];
	await session.prompt("教我一个单词", (event) => events.push(event.type));
	assert.equal(session.getWord("persistent")?.meaning, "坚持不懈的");
	assert.deepEqual(session.listWords().map((entry) => entry.word), ["persistent"]);
	assert.ok(events.includes("toolset"));
	assert.ok(events.includes("tool_start"));
	assert.deepEqual(session.exportSnapshot(0).activeToolsetKeys, ["vocabulary"]);
});

test("English Mentor records evaluated answers through submit_answer", async () => {
	const { faux, models } = setup();
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("activate_toolset", { toolset: "practice" })]),
		fauxAssistantMessage([fauxToolCall("submit_answer", { type: "translation", items: [{ item: "把「你好」翻成英语", answer: "Hello" }] })]),
		fauxAssistantMessage([fauxText("批改好了")]),
	]);
	const session = createEnglishMentorSession({
		models, providerId: "faux", modelId: "faux-1",
		evaluator: { check: async (request) => ({ correct: request.answer.toLowerCase() === "hello", feedback: request.answer.toLowerCase() === "hello" ? "完全正确" : "再想想" }) },
	});
	await session.prompt("练一下翻译", () => {});
	const record = session.englishState.practiceLog[0];
	assert.equal(record?.type, "translation");
	assert.equal(record?.items[0]?.correct, true);
	assert.equal(record?.items[0]?.feedback, "完全正确");
});

test("English Mentor manual profile and snapshot restore carries vocabulary", () => {
	const vocab = new VocabBank();
	vocab.add({ word: "resilient", meaning: "有韧性的" });
	const first = setup(); const session = createEnglishMentorSession({ models: first.models, providerId: "faux", modelId: "faux-1", vocab });
	session.setProfile("wren");
	const snapshot = session.exportSnapshot(0);
	const second = setup(); const restored = createEnglishMentorSession({ models: second.models, providerId: "faux", modelId: "faux-1", snapshot });
	assert.equal(restored.profile, "wren");
	assert.equal(restored.getWord("resilient")?.meaning, "有韧性的");
});

function setup() { const faux = fauxProvider(); const models = createModels(); models.setProvider(faux.provider); return { faux, models }; }
