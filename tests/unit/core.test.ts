import assert from "node:assert/strict";
import test from "node:test";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai";
import { createSession, validateCoreSnapshot, CORE_SESSION_SNAPSHOT_VERSION } from "../../src/index.js";

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
	assert.deepEqual(session.exportSnapshot().extensions, {});
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
