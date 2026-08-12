import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createInMemorySessionStore,
	deriveSessionTitle,
	SessionBusyError,
	SessionNotFoundError,
	SessionRevisionConflictError,
	type SessionSnapshotV1,
} from "../../src/index.js";

function snapshot(revision = 0, userMessage: string | null = "hello world"): SessionSnapshotV1 {
	return {
		version: 1,
		revision,
		activeProfileKey: null,
		activeToolsetKeys: [],
		extensions: { code: { files: { "main.py": "print(1)" } } },
		messages: userMessage ? [{ role: "user", content: userMessage, timestamp: 1 }] : [],
	};
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("deriveSessionTitle extracts and normalizes the first user message", () => {
	assert.equal(deriveSessionTitle(snapshot(0, "  what   is a closure  ")), "what is a closure");
	assert.equal(deriveSessionTitle(snapshot(0, null)), "");
	assert.equal(deriveSessionTitle(snapshot(0, "x".repeat(60))), "x".repeat(40));
	const blocks = { ...snapshot(0, null), messages: [{ role: "user", content: [{ type: "text", text: "block text" }] }] };
	assert.equal(deriveSessionTitle(blocks), "block text");
});

test("InMemorySessionStore lifecycle and snapshot isolation", async () => {
	const store = createInMemorySessionStore();
	const created = await store.create({ identity: { tenantId: "t", userId: "u" }, snapshot: snapshot() });
	const loaded = await store.load(created.id);
	assert.deepEqual(loaded?.snapshot, snapshot());
	(loaded!.snapshot.extensions.code as { files: Record<string, string> }).files["main.py"] = "HACKED";
	const persisted = await store.load(created.id);
	assert.equal((persisted!.snapshot.extensions.code as { files: Record<string, string> }).files["main.py"], "print(1)");

	const run = await store.beginRun({ sessionId: created.id, expectedRevision: 0, providerId: "p", modelId: "m", audit: { input: "hi" } });
	const completed = await store.completeRun({ runId: run.id, sessionId: created.id, expectedRevision: 0, snapshot: snapshot(), audit: { input: "hi" } });
	assert.equal(completed.revision, 1);
	assert.equal(completed.snapshot.revision, 1);
	await store.delete(created.id);
	assert.equal(await store.load(created.id), undefined);
});

test("InMemorySessionStore guards busy, revision and missing sessions", async () => {
	const store = createInMemorySessionStore();
	const created = await store.create({ identity: { tenantId: "t", userId: "u" }, snapshot: snapshot() });
	const run = await store.beginRun({ sessionId: created.id, expectedRevision: 0, providerId: "p", modelId: "m", audit: { input: "hi" } });
	await assert.rejects(store.beginRun({ sessionId: created.id, expectedRevision: 0, providerId: "p", modelId: "m", audit: { input: "x" } }), SessionBusyError);
	await assert.rejects(store.completeRun({ runId: run.id, sessionId: created.id, expectedRevision: 5, snapshot: snapshot(), audit: { input: "x" } }), SessionRevisionConflictError);
	await assert.rejects(store.beginRun({ sessionId: "missing", expectedRevision: 0, providerId: "p", modelId: "m", audit: { input: "x" } }), SessionNotFoundError);
	await store.failRun({ runId: run.id, sessionId: created.id, errorCode: "X" });
	assert.equal((await store.beginRun({ sessionId: created.id, expectedRevision: 0, providerId: "p", modelId: "m", audit: { input: "retry" } })).status, "running");
});

test("InMemorySessionStore.list filters identity and sorts by update time", async () => {
	const store = createInMemorySessionStore();
	const a = await store.create({ identity: { tenantId: "t", userId: "u" }, snapshot: snapshot() });
	const b = await store.create({ identity: { tenantId: "t", userId: "u" }, snapshot: snapshot() });
	await store.create({ identity: { tenantId: "t", userId: "other" }, snapshot: snapshot() });
	await sleep(2);
	const run = await store.beginRun({ sessionId: b.id, expectedRevision: 0, providerId: "p", modelId: "m", audit: { input: "x" } });
	await store.completeRun({ runId: run.id, sessionId: b.id, expectedRevision: 0, snapshot: snapshot(), audit: { input: "x" } });
	assert.deepEqual((await store.list({ tenantId: "t", userId: "u" })).map((item) => item.id), [b.id, a.id]);
});
