import assert from "node:assert/strict";
import test from "node:test";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { createCodeMentorSession } from "../../src/index.js";

function setup() { const faux = fauxProvider(); const models = createModels(); models.setProvider(faux.provider); return { faux, models }; }

test("Code Mentor dynamically activates workspace tools", async () => {
	const { faux, models } = setup();
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("activate_toolset", { toolset: "workspace" })]),
		fauxAssistantMessage([fauxToolCall("write_file", { path: "main.py", content: "print('ok')" })]),
		fauxAssistantMessage([fauxText("完成")]),
	]);
	const session = createCodeMentorSession({ models, providerId: "faux", modelId: "faux-1" }); const events: string[] = [];
	await session.prompt("写一个演示", (event) => events.push(event.type));
	assert.equal(session.readFile("main.py"), "print('ok')");
	assert.ok(events.includes("toolset"));
	assert.ok(events.includes("tool_start"));
	assert.deepEqual(session.exportSnapshot().activeToolsetKeys, ["workspace"]);
});

test("Code Mentor manual profile and snapshot restore", () => {
	const first = setup(); const session = createCodeMentorSession({ models: first.models, providerId: "faux", modelId: "faux-1" });
	session.setProfile("socrates"); const snapshot = session.exportSnapshot(); assert.equal(snapshot.activeProfileKey, "socrates");
	const second = setup(); const restored = createCodeMentorSession({ models: second.models, providerId: "faux", modelId: "faux-1", snapshot }); assert.equal(restored.profile, "socrates");
});

test("Code Mentor records profile-scoped progress through the generic router tool", async () => {
	const { faux, models } = setup();
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("adopt_profile", { profile: "socrates" })]),
		fauxAssistantMessage([fauxToolCall("update_profile_state", { patch: { stage: "讲解", topic: "闭包", covered: ["定义"], pending: [] } })]),
		fauxAssistantMessage([fauxText("继续")]),
	]);
	const session = createCodeMentorSession({ models, providerId: "faux", modelId: "faux-1" });
	await session.prompt("讲讲闭包", () => {});
	assert.equal(session.codeState.progressByProfile.socrates?.topic, "闭包");
});
