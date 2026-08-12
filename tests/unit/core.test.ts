import assert from "node:assert/strict";
import test from "node:test";
import { validateCoreSnapshot, CORE_SESSION_SNAPSHOT_VERSION } from "../../src/index.js";

test("Core snapshot validates namespaced extension JSON", () => {
	const snapshot = validateCoreSnapshot({
		version: CORE_SESSION_SNAPSHOT_VERSION,
		revision: 0,
		activeProfileKey: null,
		messages: [],
		extensions: { example: { enabled: true } },
	});
	assert.deepEqual(snapshot.extensions, { example: { enabled: true } });
});

test("Core snapshot rejects unsupported version", () => {
	assert.throws(() => validateCoreSnapshot({ version: 2, revision: 0, activeProfileKey: null, messages: [], extensions: {} }), /不支持/);
});

test("Core source does not depend on domain or code-pack modules", async () => {
	const fs = await import("node:fs/promises");
	const files = ["src/core/runtime.ts", "src/core/session.ts", "src/core/state.ts", "src/core/snapshot.ts", "src/core/types.ts"];
	for (const file of files) {
		const source = await fs.readFile(file, "utf8");
		assert.doesNotMatch(source, /from\s+["']\.\.\/(domains|packs)\/|from\s+["']\.\.\/(vfs|exec-client)\.js/, file);
	}
});
