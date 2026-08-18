import assert from "node:assert/strict";
import test from "node:test";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@pilore/pi-ai";
import type { AgentMessage } from "@pilore/pi-agent-core";
import {
	CoreState,
	convertProfileMessages,
	createContextSummary,
	createProfileContext,
	createRouterTool,
	createSession,
	type ProfileDefinition,
} from "../../src/index.js";

const mentor: ProfileDefinition = { key: "mentor", name: "导师", description: "引导式讲解", methodology: "METHODOLOGY_M" };
const coach: ProfileDefinition = { key: "coach", name: "教练", description: "陪练驱动", methodology: "METHODOLOGY_C" };

function userMessage(content: string, timestamp: number): AgentMessage {
	return { role: "user", content, timestamp };
}

function resultMessage(timestamp: number): AgentMessage {
	return { role: "toolResult", toolCallId: "call-1", toolName: "run", isError: false, content: [{ type: "text", text: "output" }], timestamp };
}

function renderedText(out: Array<{ role?: string; content?: unknown }>, index: number): string {
	const message = out[index];
	assert.equal(message.role, "user");
	return typeof message.content === "string" ? message.content : "";
}

test("adopt_profile appends history context only on successful switches", async () => {
	const state = new CoreState();
	const appended: Array<{ profileKey: string | null; methodology: string | null }> = [];
	const tool = createRouterTool(state, { profiles: [mentor, coach], maxSwitchesPerTurn: 2 }, { appendContext: (context) => appended.push(context) });
	await tool.execute("call-1", { profile: "mentor" });
	assert.equal(state.activeProfile?.key, "mentor");
	assert.equal(appended.length, 1);
	assert.equal(appended[0].profileKey, "mentor");
	assert.equal(appended[0].methodology, "METHODOLOGY_M");
	// 失败分支不写历史：未知 profile、重复激活。
	await assert.rejects(() => tool.execute("call-2", { profile: "missing" }), /未知 profile/);
	await assert.rejects(() => tool.execute("call-3", { profile: "mentor" }), /已经激活/);
	assert.equal(appended.length, 1);
	// 切到 coach 再交还自动路由；auto 分支同样写入 null context。
	await tool.execute("call-4", { profile: "coach" });
	await tool.execute("call-5", { profile: "auto" });
	assert.equal(state.activeProfile, undefined);
	assert.deepEqual(appended.map((item) => item.profileKey), ["mentor", "coach", null]);
});

test("model-driven adoption lands in session history", async () => {
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("adopt_profile", { profile: "mentor" })]),
		fauxAssistantMessage([fauxText("ok")]),
	]);
	const model = models.getModel("faux", "faux-1");
	assert.ok(model);
	const session = createSession({ models, model, domain: { id: "test", basePrompt: "bp", router: { profiles: [mentor, coach], maxSwitchesPerTurn: 2 } } });
	await session.prompt("开始", () => {});
	assert.equal(session.profile, "mentor");
	const contexts = session.runtime.agent.state.messages.filter((message) => message.role === "piloreProfileContext");
	assert.equal(contexts.length, 1);
	assert.equal((contexts[0] as { profileKey: string | null }).profileKey, "mentor");
});

test("orphan context merges into the next user message and stale contexts are dropped", () => {
	const messages: AgentMessage[] = [
		userMessage("q1", 1),
		createProfileContext(mentor, undefined, 2),
		resultMessage(3),
		userMessage("q2", 4),
		createProfileContext(coach, undefined, 5),
		resultMessage(6),
		userMessage("q3", 7),
	];
	const out = convertProfileMessages(messages, undefined, { activeProfile: coach });
	// 顺序：q1、工具结果、q2、工具结果、q3（合并 coach context）。
	assert.equal(out.length, 5);
	assert.equal(renderedText(out, 0), "q1");
	assert.equal(out[1].role, "toolResult");
	assert.equal(renderedText(out, 2), "q2"); // mentor 已过期：q2 不带任何 context
	assert.equal(out[3].role, "toolResult");
	const q3 = renderedText(out, 4);
	assert.ok(q3.includes("METHODOLOGY_C"));
	assert.ok(q3.includes("<user_message>\nq3\n</user_message>"));
	assert.ok(!q3.includes("METHODOLOGY_M"));
});

test("fallback synthesizes the active profile when history lost its context", () => {
	const messages = [
		createContextSummary("更早的检查点", 1234, 1),
		userMessage("q2", 2),
	] as unknown as AgentMessage[];
	const out = convertProfileMessages(
		messages,
		{ profiles: [mentor], renderContext: (context) => `RENDER:${JSON.stringify(context.state)}:${context.methodology}` },
		{ activeProfile: mentor, getProfileState: () => ({ stage: "讲解" }) },
	);
	assert.equal(out.length, 2);
	assert.ok(renderedText(out, 0).includes("更早的检查点"));
	const q2 = renderedText(out, 1);
	assert.ok(q2.includes("METHODOLOGY_M"));
	assert.ok(q2.includes('{"stage":"讲解"}'));
	assert.ok(q2.includes("q2"));
});

test("no fallback context is synthesized without an active profile", () => {
	const out = convertProfileMessages([userMessage("q", 1)], undefined, { activeProfile: undefined });
	assert.equal(out.length, 1);
	assert.equal(renderedText(out, 0), "q");
});

test("adjacent context still merges into the following user message with a provider", () => {
	const messages: AgentMessage[] = [createProfileContext(mentor, undefined, 1), userMessage("q", 2)];
	const out = convertProfileMessages(messages, undefined, { activeProfile: mentor });
	assert.equal(out.length, 1);
	const text = renderedText(out, 0);
	assert.ok(text.includes("METHODOLOGY_M"));
	assert.ok(text.includes("q"));
});

test("legacy conversion without a provider keeps adjacent-only behavior", () => {
	// 非紧邻的孤儿 context 在无 provider 时仍被丢弃（旧行为）。
	const orphaned: AgentMessage[] = [createProfileContext(mentor, undefined, 1), resultMessage(2), userMessage("q", 3)];
	const out = convertProfileMessages(orphaned);
	assert.equal(out.length, 2);
	assert.equal(out[0].role, "toolResult");
	assert.equal(renderedText(out, 1), "q");
	// 紧邻合并保持不变。
	const adjacent: AgentMessage[] = [createProfileContext(mentor, undefined, 1), userMessage("q", 2)];
	const out2 = convertProfileMessages(adjacent);
	assert.equal(out2.length, 1);
	assert.ok(renderedText(out2, 0).includes("METHODOLOGY_M"));
});

test("merged context carries the latest profile state from the provider", () => {
	const messages: AgentMessage[] = [createProfileContext(mentor, { stage: "旧阶段" }, 1), userMessage("q", 2)];
	const out = convertProfileMessages(
		messages,
		{ profiles: [mentor], renderContext: (context) => `RENDER:${JSON.stringify(context.state)}` },
		{ activeProfile: mentor, getProfileState: () => ({ stage: "新阶段" }) },
	);
	const text = renderedText(out, 0);
	assert.ok(text.includes('RENDER:{"stage":"新阶段"}'));
	assert.ok(!text.includes("旧阶段"));
});
