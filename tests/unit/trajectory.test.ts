import assert from "node:assert/strict";
import test from "node:test";
import { Agent } from "@earendil-works/pi-agent-core";
import { Type, createAssistantMessageEventStream, createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { CoreState, createSession, createTrajectoryRecorder } from "../../src/index.js";

test("Session records one trajectory run with turns, tools, text, and usage", async () => {
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("echo", { text: "hi" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("都讲完了。")], { stopReason: "stop" }),
	]);
	const model = models.getModel("faux", "faux-1");
	assert.ok(model);
	const echoTool = {
		name: "echo",
		label: "回声",
		description: "echo the text",
		parameters: Type.Object({ text: Type.String() }),
		execute: async (_id: unknown, rawInput: unknown) => {
			const input = rawInput as { text: string };
			return { content: [{ type: "text" as const, text: `echo:${input.text}` }], details: {} };
		},
	};
	const session = createSession({ models, model, tools: [echoTool] });
	const beforeRun = session.lastRun;
	if (beforeRun !== null) throw new Error("expected no run before the first prompt");
	await session.prompt("讲一下回声", () => {});
	const run = session.lastRun;
	if (run === null) throw new Error("expected a recorded run");
	assert.equal(run.input, "讲一下回声");
	assert.equal(run.outputText, "都讲完了。");
	assert.equal(run.errorMessage, undefined);
	assert.equal(run.turns.length, 2);

	const first = run.turns[0];
	const second = run.turns[1];
	if (first === undefined || second === undefined) throw new Error("expected two turns");
	assert.equal(first.turn, 1);
	assert.equal(second.turn, 2);
	assert.equal(first.profileKey, null);
	assert.equal(first.provider, "faux");
	assert.equal(first.model, "faux-1");
	assert.ok(first.usage);
	assert.ok(first.startedAt <= first.completedAt);
	assert.ok(first.durationMs >= 0);
	assert.equal(typeof first.systemPrompt, "string");
	assert.ok(first.systemPrompt !== "");
	const catalog = first.tools;
	assert.ok(catalog);
	assert.ok(catalog.length > 0);
	assert.equal(catalog[0]?.name, "echo");
	assert.equal(catalog[0]?.description, "echo the text");
	assert.ok(catalog[0]?.parameters !== null);

	const toolStep = first.steps.find((step) => step.kind === "tool");
	if (toolStep === undefined || toolStep.kind !== "tool") throw new Error("expected a tool step");
	assert.equal(toolStep.toolName, "echo");
	assert.equal(typeof toolStep.callId, "string");
	assert.ok(toolStep.callId !== "");
	assert.deepEqual(toolStep.args, { text: "hi" });
	assert.equal(toolStep.resultText, "echo:hi");
	assert.equal(toolStep.resultTruncated, false);
	assert.equal(toolStep.isError, false);
	assert.ok(toolStep.durationMs >= 0);
	assert.equal(toolStep.schema?.name, "echo");
	assert.equal(toolStep.schema?.description, "echo the text");
	assert.ok(toolStep.schema?.parameters !== null);

	const textStep = second.steps.find((step) => step.kind === "text");
	if (textStep === undefined || textStep.kind !== "text") throw new Error("expected a text step");
	assert.equal(textStep.text, "都讲完了。");
});

test("Failing tool execution records an errored tool step", async () => {
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("boom", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("继续。")], { stopReason: "stop" }),
	]);
	const model = models.getModel("faux", "faux-1");
	assert.ok(model);
	const boomTool = {
		name: "boom",
		label: "爆炸",
		description: "always throws",
		parameters: Type.Object({}),
		execute: async () => {
			throw new Error("boom");
		},
	};
	const session = createSession({ models, model, tools: [boomTool] });
	await session.prompt("触发爆炸", () => {});
	const run = session.lastRun;
	if (run === null) throw new Error("expected a recorded run");
	const toolStep = run.turns[0]?.steps.find((step) => step.kind === "tool");
	if (toolStep === undefined || toolStep.kind !== "tool") throw new Error("expected a tool step");
	assert.equal(toolStep.isError, true);
	assert.equal(toolStep.resultTruncated, false);
});

test("Oversized tool results are truncated at the transport cap", async () => {
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("dump", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("完。")], { stopReason: "stop" }),
	]);
	const model = models.getModel("faux", "faux-1");
	assert.ok(model);
	const dumpTool = {
		name: "dump",
		label: "倾倒",
		description: "returns a very long text",
		parameters: Type.Object({}),
		execute: async () => ({ content: [{ type: "text" as const, text: "x".repeat(9000) }], details: {} }),
	};
	const session = createSession({ models, model, tools: [dumpTool] });
	await session.prompt("倒出来", () => {});
	const run = session.lastRun;
	if (run === null) throw new Error("expected a recorded run");
	const toolStep = run.turns[0]?.steps.find((step) => step.kind === "tool");
	if (toolStep === undefined || toolStep.kind !== "tool") throw new Error("expected a tool step");
	assert.equal(toolStep.resultText.length, 8000);
	assert.equal(toolStep.resultTruncated, true);
});

test("Recorder folds profile and toolset events into a turn-0 prelude", () => {
	const agent = new Agent({ streamFn: async () => createAssistantMessageEventStream() });
	const state = new CoreState();
	const recorder = createTrajectoryRecorder({ agent, state });
	if (recorder.finish() !== null) throw new Error("expected no run before begin");
	recorder.begin("hello");
	state.setProfile({ key: "feynman", name: "费曼", description: "物理直觉", methodology: "打比方" }, "user");
	state.activateToolset("execution");
	const run = recorder.finish();
	if (run === null) throw new Error("expected a recorded run");
	assert.equal(run.input, "hello");
	assert.equal(run.turns.length, 1);
	assert.equal(run.turns[0]?.turn, 0);
	assert.equal(run.turns[0]?.profileKey, "feynman");
	assert.deepEqual(run.turns[0]?.steps.map((step) => step.kind), ["profile", "toolset"]);
	if (recorder.finish() !== null) throw new Error("expected finish to clear the run");
	recorder.dispose();
});

test("Recorder finalize carries the run error message and dispose stops recording", () => {
	const agent = new Agent({ streamFn: async () => createAssistantMessageEventStream() });
	const state = new CoreState();
	const recorder = createTrajectoryRecorder({ agent, state });
	recorder.begin("x");
	const failed = recorder.finish("boom");
	if (failed === null) throw new Error("expected a recorded run");
	assert.equal(failed.errorMessage, "boom");

	recorder.begin("y");
	recorder.dispose();
	state.activateToolset("execution");
	const afterDispose = recorder.finish();
	if (afterDispose === null) throw new Error("expected a recorded run");
	assert.equal(afterDispose.input, "y");
	assert.equal(afterDispose.turns.length, 0);
});
