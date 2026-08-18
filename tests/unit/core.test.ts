import assert from "node:assert/strict";
import test from "node:test";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText } from "@pilore/pi-ai";
import { ContextPolicyError, createSession, createRuntime, resolveContextPolicy, validateCoreSnapshot, CORE_SESSION_SNAPSHOT_VERSION } from "../../src/index.js";

test("Core session works without a Domain Pack", async () => {
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	faux.setResponses([fauxAssistantMessage([fauxText("hello from core")])]);
	const model = models.getModel("faux", "faux-1");
	assert.ok(model);
	const session = createSession({ models, model });
	let text = "";
	await session.prompt("hello", (event) => {
		if (event.type === "text_delta") text += event.delta;
	});
	assert.equal(text, "hello from core");
	assert.deepEqual(session.exportSnapshot(0).extensions, {});
});

test("Core snapshot validates namespaced extension JSON", () => {
	const snapshot = validateCoreSnapshot({
		version: CORE_SESSION_SNAPSHOT_VERSION,
		revision: 0,
		activeProfileKey: null,
		activeToolsetKeys: [],
		messages: [],
		extensions: { example: { enabled: true } },
	});
	assert.deepEqual(snapshot.extensions, { example: { enabled: true } });
});

test("Core snapshot rejects unsupported version", () => {
	assert.throws(() => validateCoreSnapshot({ version: 2, revision: 0, activeProfileKey: null, activeToolsetKeys: [], messages: [], extensions: {} }), /不支持/);
});

test("Core snapshot validates persisted agent and PiLore context messages", () => {
	const snapshot = validateCoreSnapshot({
		version: 1, revision: 3, activeProfileKey: null, activeToolsetKeys: [], extensions: {},
		messages: [
			{ role: "piloreProfileContext", profileKey: null, profileName: null, profileHash: null, methodology: null, timestamp: 1 },
			{ role: "user", content: "hello", timestamp: 2 },
			fauxAssistantMessage([fauxText("world")], { timestamp: 3 }),
		],
	});
	assert.equal(snapshot.messages.length, 3);
	assert.throws(() => validateCoreSnapshot({ ...snapshot, messages: [{ role: "assistant", content: [], timestamp: 1 }] }), /api 必须是字符串/);
	assert.throws(() => validateCoreSnapshot({ ...snapshot, messages: [{ role: "unknown", timestamp: 1 }] }), /不受支持/);
});

test("ContextPolicy rejects oversized input before a provider request", async () => {
	const faux = fauxProvider();
	const models = createModels(); models.setProvider(faux.provider);
	const model = models.getModel("faux", "faux-1"); assert.ok(model);
	const session = createSession({ models, model, contextPolicy: { contextWindow: 10_000, maxInputTokens: 100 } });
	await assert.rejects(
		session.prompt("x".repeat(1_000), () => {}),
		(error: unknown) => error instanceof ContextPolicyError && error.code === "INPUT_TOO_LARGE",
	);
	assert.equal(session.exportSnapshot(0).messages.length, 0);
});

test("ContextPolicy reads shared context limits from .env", () => {
	const faux = fauxProvider();
	const models = createModels(); models.setProvider(faux.provider);
	const model = models.getModel("faux", "faux-1"); assert.ok(model);
	const previousInput = process.env.PILORE_MAX_INPUT_TOKENS;
	const previousWindow = process.env.PILORE_CONTEXT_WINDOW;
	process.env.PILORE_MAX_INPUT_TOKENS = "1234";
	process.env.PILORE_CONTEXT_WINDOW = "8000";
	try {
		assert.equal(resolveContextPolicy(model, {}).contextWindow, 8000);
		assert.equal(resolveContextPolicy(model, {}).maxInputTokens, 1234);
		assert.equal(resolveContextPolicy(model, { contextWindow: 10_000 }).contextWindow, 10_000);
		assert.equal(resolveContextPolicy(model, { contextWindow: 10_000, maxInputTokens: 321 }).maxInputTokens, 321);
	} finally {
		if (previousInput === undefined) delete process.env.PILORE_MAX_INPUT_TOKENS;
		else process.env.PILORE_MAX_INPUT_TOKENS = previousInput;
		if (previousWindow === undefined) delete process.env.PILORE_CONTEXT_WINDOW;
		else process.env.PILORE_CONTEXT_WINDOW = previousWindow;
	}
});

test("ContextPolicy compacts confirmed history into a durable checkpoint", async () => {
	const faux = fauxProvider();
	const models = createModels(); models.setProvider(faux.provider);
	faux.setResponses(Array.from({ length: 20 }, () => fauxAssistantMessage("## 目标\n持续学习\n\n## 学习进度\n- 已完成：基础练习\n\n## 关键事实与状态\n- 保留近期内容\n\n## 待办\n- 继续")));
	const model = models.getModel("faux", "faux-1"); assert.ok(model);
	const messages = Array.from({ length: 7 }, (_, index) => [
		{ role: "user", content: `问题 ${index}\n${"学习材料 ".repeat(500)}`, timestamp: index * 2 + 1 },
		fauxAssistantMessage(`回答 ${index}\n${"讲解内容 ".repeat(500)}`, { timestamp: index * 2 + 2 }),
	]).flat();
	const session = createSession({
		models,
		model,
		contextPolicy: { contextWindow: 10_000, keepRecentTokens: 1_000, maxInputTokens: 2_000, summaryMaxTokens: 200 },
		snapshot: { version: 1, revision: 0, activeProfileKey: null, activeToolsetKeys: [], messages, extensions: {} },
	});
	assert.equal(session.inspectContext("继续").status, "requires_compaction");
	const result = await session.compactContext();
	assert.equal(result.compacted, true);
	const snapshot = session.exportSnapshot(0);
	assert.equal((snapshot.messages[0] as { role: string }).role, "piloreContextSummary");
	assert.ok(snapshot.messages.length < messages.length);
	assert.equal(session.inspectContext("继续").status, "ok");
});

test("Compiled tool registry loads each group once and validates capabilities", () => {
	let loads = 0;
	const tool = { name: "example", label: "Example", description: "Example", parameters: {} as any, execute: async () => ({ content: [], details: {} }) };
	const models = createModels(); const faux = fauxProvider(); models.setProvider(faux.provider);
	const model = models.getModel("faux", "faux-1"); assert.ok(model);
	const runtime = createRuntime({
		models, model,
		domain: { id: "example", router: { profiles: [{ key: "mentor", name: "Mentor", description: "x", methodology: "x", capabilities: { "example.run": "allow" } }] }, toolManifest: { groups: [{ key: "group", description: "x", load: () => { loads += 1; return [tool]; } }], capabilities: { example: ["example.run"] }, resolveCapability: () => "example.run" } },
	});
	assert.equal(loads, 1);
	runtime.state.activateToolset("group"); runtime.refreshTools(); runtime.refreshTools();
	assert.equal(loads, 1);
	assert.throws(() => createRuntime({ models, model, domain: { id: "bad", router: { profiles: [{ key: "mentor", name: "Mentor", description: "x", methodology: "x", capabilities: { "missing.run": "deny" } }] }, toolManifest: { groups: [{ key: "group", description: "x", load: () => [tool] }], capabilities: { example: ["example.run"] }, resolveCapability: () => "example.run" } } }), /未知 capability/);
});

test("Core source does not depend on domain or code-pack modules", async () => {
	const fs = await import("node:fs/promises");
	const files = [
		"src/core/runtime/index.ts",
		"src/core/session/index.ts",
		"src/core/state/index.ts",
		"src/core/snapshot/index.ts",
		"src/core/router/index.ts",
		"src/core/tool-runtime/index.ts",
		"src/core/types.ts",
	];
	for (const file of files) {
		const source = await fs.readFile(file, "utf8");
		assert.doesNotMatch(source, /from\s+["']\.\.\/(domains|packs)\/|from\s+["']\.\.\/(vfs|exec-client)\.js/, file);
	}
});
