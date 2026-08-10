import { test } from "node:test";
import assert from "node:assert/strict";
import {
	createInMemorySessionStore,
	deriveSessionTitle,
	EDU_SESSION_SNAPSHOT_VERSION,
	SessionBusyError,
	SessionNotFoundError,
	SessionRevisionConflictError,
	type EduSessionSnapshotV1,
} from "../../src/index.js";

function snapshot(revision = 0, userMessage: string | null = "hello world"): EduSessionSnapshotV1 {
	return {
		version: EDU_SESSION_SNAPSHOT_VERSION,
		revision,
		activePersonaKey: null,
		teachingByPersona: {},
		files: { "main.py": "print(1)" },
		messages: userMessage ? [{ role: "user", content: userMessage, timestamp: 1 }] : [],
	};
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("deriveSessionTitle：首条用户消息、空白折叠、截断、块内容", () => {
	assert.equal(deriveSessionTitle(snapshot(0, "  what   is a closure  ")), "what is a closure");
	assert.equal(deriveSessionTitle(snapshot(0, "")), "");
	assert.equal(deriveSessionTitle(snapshot(0, null)), "");
	assert.equal(deriveSessionTitle(snapshot(0, "x".repeat(60))), "x".repeat(40));
	const blockContent = { ...snapshot(0, null), messages: [{ role: "user", content: [{ type: "text", text: "block text" }], timestamp: 1 }] };
	assert.equal(deriveSessionTitle(blockContent as unknown as EduSessionSnapshotV1), "block text");
});

test("InMemorySessionStore 生命周期：create/load/complete/delete，快照深拷贝隔离", async () => {
	const store = createInMemorySessionStore();
	const created = await store.create({ identity: { tenantId: "t", userId: "u" }, snapshot: snapshot() });
	assert.equal(created.revision, 0);
	assert.equal(created.title, "hello world");

	const loaded = await store.load(created.id);
	assert.deepEqual(loaded?.snapshot, snapshot());
	// 修改返回值不应污染存储内部状态
	loaded!.snapshot.files["main.py"] = "HACKED";
	assert.equal((await store.load(created.id))?.snapshot.files["main.py"], "print(1)");

	const run = await store.beginRun({ sessionId: created.id, expectedRevision: 0, providerId: "p", modelId: "m", audit: { input: "hi" } });
	const completed = await store.completeRun({
		runId: run.id,
		sessionId: created.id,
		expectedRevision: 0,
		snapshot: snapshot(),
		audit: { input: "hi", output: "ok" },
	});
	assert.equal(completed.revision, 1);
	assert.equal(completed.snapshot.revision, 1);

	await store.delete(created.id);
	assert.equal(await store.load(created.id), undefined);
});

test("InMemorySessionStore 护栏：busy / revision 冲突 / 不存在 / failRun 解锁", async () => {
	const store = createInMemorySessionStore();
	const created = await store.create({ identity: { tenantId: "t", userId: "u" }, snapshot: snapshot() });
	const run = await store.beginRun({ sessionId: created.id, expectedRevision: 0, providerId: "p", modelId: "m", audit: { input: "hi" } });
	await assert.rejects(
		store.beginRun({ sessionId: created.id, expectedRevision: 0, providerId: "p", modelId: "m", audit: { input: "x" } }),
		SessionBusyError,
	);
	await assert.rejects(
		store.completeRun({ runId: run.id, sessionId: created.id, expectedRevision: 5, snapshot: snapshot(), audit: { input: "x" } }),
		SessionRevisionConflictError,
	);
	assert.equal(await store.load("missing"), undefined);
	await assert.rejects(
		store.beginRun({ sessionId: "missing", expectedRevision: 0, providerId: "p", modelId: "m", audit: { input: "x" } }),
		SessionNotFoundError,
	);
	await store.failRun({ runId: run.id, sessionId: created.id, errorCode: "X" });
	// failRun 后锁释放，同 revision 可重新 beginRun
	const retry = await store.beginRun({ sessionId: created.id, expectedRevision: 0, providerId: "p", modelId: "m", audit: { input: "retry" } });
	assert.equal(retry.status, "running");
});

test("InMemorySessionStore.list：按身份过滤、courseId 区分、updatedAt 降序", async () => {
	const store = createInMemorySessionStore();
	const a = await store.create({ identity: { tenantId: "t", userId: "u1" }, snapshot: snapshot() });
	const b = await store.create({ identity: { tenantId: "t", userId: "u1" }, snapshot: snapshot() });
	await store.create({ identity: { tenantId: "t", userId: "u2" }, snapshot: snapshot() });
	await store.create({ identity: { tenantId: "t", userId: "u1", courseId: "c" }, snapshot: snapshot() });

	await sleep(2); // 保证 updatedAt 可区分
	const run = await store.beginRun({ sessionId: b.id, expectedRevision: 0, providerId: "p", modelId: "m", audit: { input: "x" } });
	await store.completeRun({ runId: run.id, sessionId: b.id, expectedRevision: 0, snapshot: snapshot(), audit: { input: "x" } });

	const list = await store.list({ tenantId: "t", userId: "u1" });
	assert.deepEqual(list.map((s) => s.id), [b.id, a.id]);
	assert.equal(list[0].revision, 1);
	assert.equal((await store.list({ tenantId: "t", userId: "u1", courseId: "c" })).length, 1);
	assert.deepEqual(await store.list({ tenantId: "t", userId: "nobody" }), []);
});
