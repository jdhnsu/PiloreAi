import assert from "node:assert/strict";
import test from "node:test";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai";
import { createSession, createRuntime, validateCoreSnapshot, CORE_SESSION_SNAPSHOT_VERSION } from "../../src/index.js";

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
