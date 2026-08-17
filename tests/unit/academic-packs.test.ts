import assert from "node:assert/strict";
import test from "node:test";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@pilore/pi-ai";
import {
	CoreState,
	StudyCardBank,
	createAcademicMentorState,
	createHistoryMentorSession,
	createMathMentorSession,
	createMathToolManifest,
	createPhysicsMentorSession,
	getDefaultHistoryProfiles,
	getDefaultMathProfiles,
	getDefaultPhysicsProfiles,
	toolsForState,
} from "../../src/index.js";

test("Academic Packs own independent default profiles", () => {
	assert.deepEqual(getDefaultMathProfiles().map((profile) => profile.key), ["euler", "gauss", "noether"]);
	assert.deepEqual(getDefaultPhysicsProfiles().map((profile) => profile.key), ["curie", "feynman", "maxwell"]);
	assert.deepEqual(getDefaultHistoryProfiles().map((profile) => profile.key), ["bloch", "braudel", "sima"]);
});

test("Academic tools stay absent until their toolsets are activated", () => {
	const core = new CoreState();
	const manifest = createMathToolManifest(new StudyCardBank(), createAcademicMentorState());
	assert.deepEqual(toolsForState(manifest, core, []).map((tool) => tool.name), []);
	core.activateToolset("study_cards");
	assert.deepEqual(toolsForState(manifest, core, []).map((tool) => tool.name), [
		"save_study_card",
		"list_study_cards",
		"remove_study_card",
	]);
	core.activateToolset("practice");
	assert.deepEqual(toolsForState(manifest, core, []).map((tool) => tool.name), [
		"save_study_card",
		"list_study_cards",
		"remove_study_card",
		"start_academic_practice",
		"submit_academic_answer",
	]);
});

test("StudyCardBank validates, normalizes and restores cards", () => {
	const bank = new StudyCardBank();
	const card = bank.add({ id: "Chain Rule", kind: "formula", title: "链式法则", summary: "复合函数求导规则", tags: ["微积分", "微积分", "求导"] });
	assert.equal(card.id, "chain-rule");
	assert.deepEqual(card.tags, ["微积分", "求导"]);
	assert.throws(() => bank.add({ kind: "formula", title: "", summary: "x" }), /title 不能为空/);
	const restored = new StudyCardBank();
	restored.restore(bank.toRecord());
	assert.equal(restored.get("CHAIN-RULE")?.summary, "复合函数求导规则");
});

test("Math Mentor saves a study card and restores its own snapshot extension", async () => {
	const first = setup();
	first.faux.setResponses([
		fauxAssistantMessage([fauxToolCall("activate_toolset", { toolset: "study_cards" })]),
		fauxAssistantMessage([fauxToolCall("save_study_card", { id: "derivative", kind: "definition", title: "导数", summary: "函数的瞬时变化率" })]),
		fauxAssistantMessage([fauxText("完成")]),
	]);
	const session = createMathMentorSession({ models: first.models, providerId: "faux", modelId: "faux-1" });
	await session.prompt("帮我整理导数定义", () => {});
	assert.equal(session.getMathCard("derivative")?.kind, "definition");
	const snapshot = session.exportSnapshot(0);
	assert.ok(snapshot.extensions.math);
	assert.equal(snapshot.extensions.physics, undefined);
	assert.equal(snapshot.extensions.history, undefined);

	const second = setup();
	const restored = createMathMentorSession({ models: second.models, providerId: "faux", modelId: "faux-1", snapshot });
	assert.equal(restored.getCard("derivative")?.summary, "函数的瞬时变化率");
});

test("Physics Mentor passes subject-aware requests to an injected evaluator", async () => {
	const { faux, models } = setup();
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("activate_toolset", { toolset: "practice" })]),
		fauxAssistantMessage([fauxToolCall("submit_academic_answer", {
			type: "calculation",
			items: [{ prompt: "2 kg 物体以 3 m/s 运动，动量是多少？", answer: "6 kg·m/s", reference: "6 kg·m/s" }],
		})]),
		fauxAssistantMessage([fauxText("批改完成")]),
	]);
	const subjects: string[] = [];
	const session = createPhysicsMentorSession({
		models,
		providerId: "faux",
		modelId: "faux-1",
		evaluator: {
			check: (request) => {
				subjects.push(request.subject);
				return { correct: request.answer === request.reference, feedback: "单位与数值正确" };
			},
		},
	});
	await session.prompt("批改这道动量题", () => {});
	assert.deepEqual(subjects, ["physics"]);
	assert.equal(session.physicsState.practiceLog[0]?.items[0]?.correct, true);
});

test("History Mentor exports history-only state", () => {
	const { models } = setup();
	const session = createHistoryMentorSession({ models, providerId: "faux", modelId: "faux-1" });
	session.setProfile("bloch");
	const snapshot = session.exportSnapshot(0);
	assert.equal(snapshot.activeProfileKey, "bloch");
	assert.ok(snapshot.extensions.history);
	assert.equal(snapshot.extensions.math, undefined);
});

function setup() {
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	return { faux, models };
}
