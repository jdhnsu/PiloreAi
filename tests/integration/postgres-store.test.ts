import "dotenv/config";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import {
	CORE_SESSION_SNAPSHOT_VERSION,
	SessionBusyError,
	SessionNotFoundError,
	SessionRevisionConflictError,
	SessionStoreError,
	applyPostgresMigrations,
	createAes256GcmCryptoProvider,
	createPostgresSessionStore,
	type SessionSnapshotV1,
	type SessionStore,
	type TrajectoryRun,
} from "../../src/index.js";

const databaseConfig = process.env.PILORE_TEST_DATABASE_URL
	? { connectionString: process.env.PILORE_TEST_DATABASE_URL, ssl: false as const }
	: process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASSWORD && process.env.DB_NAME
		? {
				host: process.env.DB_HOST,
				port: Number(process.env.DB_PORT ?? 5432),
				user: process.env.DB_USER,
				password: process.env.DB_PASSWORD,
				database: process.env.DB_NAME,
				ssl: false as const,
			}
		: undefined;
const schema = `pilore_test_${process.pid}_${Date.now()}`;
let pool: Pool;
let store: SessionStore;

function snapshot(revision = 0): SessionSnapshotV1 {
	return {
		version: CORE_SESSION_SNAPSHOT_VERSION,
		revision,
		activeProfileKey: null,
		activeToolsetKeys: [],
		extensions: { code: { files: { "main.py": "print('PLAINTEXT_SENTINEL')" } } },
		messages: [{ role: "user", content: "PLAINTEXT_STUDENT_MESSAGE", timestamp: 1 }],
	};
}

before(async () => {
	if (!databaseConfig) return;
	pool = new Pool(databaseConfig);
	await applyPostgresMigrations(pool, { schema });
	await applyPostgresMigrations(pool, { schema });
	store = createPostgresSessionStore({
		pool,
		schema,
		crypto: createAes256GcmCryptoProvider({ primaryKeyId: "test-key", keys: { "test-key": randomBytes(32) } }),
	});
});

after(async () => {
	if (!databaseConfig) return;
	await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
	await pool.end();
});

test("PostgreSQL create/load/complete/delete、加密与 revision 冲突", { skip: !databaseConfig }, async () => {
	const created = await store.create({ identity: { tenantId: "t1", userId: "u1", courseId: "c1" }, snapshot: snapshot() });
	assert.equal(created.revision, 0);
	assert.deepEqual((await store.load(created.id))?.snapshot, snapshot());

	const raw = await pool.query<{ body: string }>(
		`SELECT encode(snapshot_ciphertext, 'escape') AS body FROM "${schema}".sessions WHERE id = $1`,
		[created.id],
	);
	assert.doesNotMatch(raw.rows[0].body, /PLAINTEXT_SENTINEL|PLAINTEXT_STUDENT_MESSAGE/);

	const run = await store.beginRun({
		sessionId: created.id,
		expectedRevision: 0,
		providerId: "faux",
		modelId: "faux-1",
		audit: { input: "PLAINTEXT_RUN_INPUT" },
	});
	await assert.rejects(
		store.beginRun({ sessionId: created.id, expectedRevision: 0, providerId: "faux", modelId: "faux-1", audit: { input: "x" } }),
		SessionBusyError,
	);
	const completed = await store.completeRun({
		runId: run.id,
		sessionId: created.id,
		expectedRevision: 0,
		snapshot: snapshot(),
		audit: { input: "PLAINTEXT_RUN_INPUT", output: "done" },
		metrics: { durationMs: 10 },
	});
	assert.equal(completed.revision, 1);
	assert.equal(completed.snapshot.revision, 1);
	const rawRun = await pool.query<{ body: string }>(`SELECT encode(audit_ciphertext, 'escape') AS body FROM "${schema}".runs WHERE id = $1`, [run.id]);
	assert.doesNotMatch(rawRun.rows[0].body, /PLAINTEXT_RUN_INPUT/);
	await assert.rejects(
		store.beginRun({ sessionId: created.id, expectedRevision: 0, providerId: "faux", modelId: "faux-1", audit: { input: "stale" } }),
		SessionRevisionConflictError,
	);
	await store.delete(created.id);
	assert.equal(await store.load(created.id), undefined);
});

test("PostgreSQL failRun 解除会话占用", { skip: !databaseConfig }, async () => {
	const created = await store.create({ identity: { tenantId: "t1", userId: "u2" }, snapshot: snapshot() });
	const run = await store.beginRun({
		sessionId: created.id,
		expectedRevision: 0,
		providerId: "faux",
		modelId: "faux-1",
		audit: { input: "will fail" },
	});
	await store.failRun({ runId: run.id, sessionId: created.id, errorCode: "TEST_FAILURE", audit: { input: "will fail" } });
	const next = await store.beginRun({
		sessionId: created.id,
		expectedRevision: 0,
		providerId: "faux",
		modelId: "faux-1",
		audit: { input: "retry" },
	});
	assert.equal(next.status, "running");
	await store.failRun({ runId: next.id, sessionId: created.id, errorCode: "CLEANUP" });
});

test("PostgreSQL list：按身份过滤、updatedAt 降序、标题派生两条路径", { skip: !databaseConfig }, async () => {
	const identity = { tenantId: "t1", userId: "u3" };

	// b：创建时快照已含用户消息，标题在 create 即派生
	const b = await store.create({ identity, snapshot: snapshot() });
	assert.equal(b.title, "PLAINTEXT_STUDENT_MESSAGE");

	// a：空快照创建（标题为空），首轮 completeRun 后由首条用户消息派生
	const a = await store.create({ identity, snapshot: { ...snapshot(), extensions: {}, messages: [] } });
	assert.equal(a.title, "");
	const run = await store.beginRun({ sessionId: a.id, expectedRevision: 0, providerId: "faux", modelId: "faux-1", audit: { input: "x" } });
	await new Promise((r) => setTimeout(r, 5)); // 保证 updatedAt 严格递增
	const done = await store.completeRun({ runId: run.id, sessionId: a.id, expectedRevision: 0, snapshot: snapshot(), audit: { input: "x" } });
	assert.equal(done.title, "PLAINTEXT_STUDENT_MESSAGE");

	await store.create({ identity: { tenantId: "t1", userId: "other" }, snapshot: snapshot() });

	const list = await store.list(identity);
	assert.equal(list.length, 2);
	assert.equal(list[0].id, a.id); // 最近更新的排最前
	assert.equal(list[0].title, "PLAINTEXT_STUDENT_MESSAGE");
	assert.equal(list[1].id, b.id);
	assert.deepEqual(await store.list({ tenantId: "t1", userId: "nobody" }), []);
});

function trajectoryFixture(runId: string, sessionId: string, input: string, startedAt: number): TrajectoryRun {
	return {
		runId,
		sessionId,
		input,
		outputText: "PLAINTEXT_TRAJECTORY_SENTINEL",
		startedAt,
		completedAt: startedAt + 100,
		turns: [
			{
				turn: 1,
				profileKey: null,
				profileName: null,
				provider: "faux",
				model: "faux-1",
				systemPrompt: "PLAINTEXT_TRAJECTORY_SENTINEL",
				tools: [{ name: "echo", label: "回声", description: "echo the text", parameters: { type: "object", properties: {} } }],
				startedAt,
				completedAt: startedAt + 100,
				durationMs: 100,
				usage: { input: 5, output: 6, cacheRead: 0, cacheWrite: 0, totalTokens: 11, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				steps: [{ kind: "text", text: "PLAINTEXT_TRAJECTORY_SENTINEL", time: startedAt + 50 }],
			},
		],
	};
}

test("PostgreSQL trajectory 保存/加密回读/排序/级联删除", { skip: !databaseConfig }, async () => {
	const created = await store.create({ identity: { tenantId: "t1", userId: "u4" }, snapshot: snapshot() });
	const first = await store.beginRun({ sessionId: created.id, expectedRevision: 0, providerId: "faux", modelId: "faux-1", audit: { input: "第一次" } });
	await store.completeRun({
		runId: first.id,
		sessionId: created.id,
		expectedRevision: 0,
		snapshot: snapshot(),
		audit: { input: "第一次", output: "done" },
		metrics: { durationMs: 1 },
	});
	const second = await store.beginRun({ sessionId: created.id, expectedRevision: 1, providerId: "faux", modelId: "faux-1", audit: { input: "第二次" } });
	await store.completeRun({
		runId: second.id,
		sessionId: created.id,
		expectedRevision: 1,
		snapshot: snapshot(),
		audit: { input: "第二次", output: "done" },
		metrics: { durationMs: 1 },
	});

	await store.saveTrajectory({ runId: first.id, sessionId: created.id, run: trajectoryFixture(first.id, created.id, "第一次", 1000) });
	await store.saveTrajectory({ runId: second.id, sessionId: created.id, run: trajectoryFixture(second.id, created.id, "第二次", 2000) });

	const loaded = await store.loadTrajectory(created.id);
	assert.equal(loaded.length, 2);
	assert.equal(loaded[0]?.runId, first.id);
	assert.equal(loaded[1]?.runId, second.id);
	assert.equal(loaded[0]?.outputText, "PLAINTEXT_TRAJECTORY_SENTINEL");
	assert.equal(loaded[0]?.turns[0]?.steps[0]?.kind, "text");

	const raw = await pool.query<{ body: string }>(
		`SELECT encode(payload_ciphertext, 'escape') AS body FROM "${schema}".trajectory_runs WHERE run_id = $1`,
		[first.id],
	);
	assert.doesNotMatch(raw.rows[0].body, /PLAINTEXT_TRAJECTORY_SENTINEL/);

	await store.delete(created.id);
	await assert.rejects(store.loadTrajectory(created.id), SessionNotFoundError);
});

test("PostgreSQL trajectory 校验会话与 run 存在", { skip: !databaseConfig }, async () => {
	const created = await store.create({ identity: { tenantId: "t1", userId: "u5" }, snapshot: snapshot() });
	const run = await store.beginRun({ sessionId: created.id, expectedRevision: 0, providerId: "faux", modelId: "faux-1", audit: { input: "x" } });
	const missingRun = "00000000-0000-0000-0000-000000000000";
	await assert.rejects(
		store.saveTrajectory({ runId: missingRun, sessionId: created.id, run: trajectoryFixture(missingRun, created.id, "x", 1) }),
		SessionStoreError,
	);
	await assert.rejects(
		store.saveTrajectory({ runId: run.id, sessionId: missingRun, run: trajectoryFixture(run.id, missingRun, "x", 1) }),
		SessionNotFoundError,
	);
	await assert.rejects(store.loadTrajectory(missingRun), SessionNotFoundError);
});

test("PostgreSQL upsertUser/getUserDisplayName 记录登录昵称（migration 003）", { skip: !databaseConfig }, async () => {
	assert.equal(await store.getUserDisplayName("beta-01"), null);
	await store.upsertUser("beta-01", "小明");
	assert.equal(await store.getUserDisplayName("beta-01"), "小明");
	await store.upsertUser("beta-01", null);
	assert.equal(await store.getUserDisplayName("beta-01"), "小明", "displayName 为 null 时保留原值");
	await store.upsertUser("beta-01", "阿明");
	assert.equal(await store.getUserDisplayName("beta-01"), "阿明");
	const row = await pool.query<{ first_login_at: Date; last_login_at: Date }>(
		`SELECT first_login_at, last_login_at FROM "${schema}".users WHERE user_id = $1`,
		["beta-01"],
	);
	assert.ok(row.rows[0].first_login_at instanceof Date);
	assert.ok(row.rows[0].last_login_at instanceof Date);
});

test("PostgreSQL 注册：一次性邀请码核销、邮箱唯一、按邮箱查凭据（migration 004）", { skip: !databaseConfig }, async () => {
	const codeHashA = "a".repeat(64);
	const codeHashB = "b".repeat(64);
	await store.registerUser({ userId: "reg-01", displayName: "甲", email: "reg01@x.com", passwordSalt: "s1", passwordHash: "h1", inviteCodeHash: codeHashA });
	const found = await store.findUserByEmail("reg01@x.com");
	assert.equal(found?.userId, "reg-01");
	assert.equal(found?.displayName, "甲");
	assert.equal(found?.passwordSalt, "s1");
	assert.equal(await store.findUserByEmail("missing@x.com"), undefined);

	await assert.rejects(
		store.registerUser({ userId: "reg-02", displayName: "乙", email: "reg02@x.com", passwordSalt: "s2", passwordHash: "h2", inviteCodeHash: codeHashA }),
		(err: unknown) => err instanceof SessionStoreError && err.code === "INVITE_CODE_REDEEMED",
		"同一邀请码不能二次核销",
	);
	await assert.rejects(
		store.registerUser({ userId: "reg-02", displayName: "乙", email: "reg01@x.com", passwordSalt: "s2", passwordHash: "h2", inviteCodeHash: codeHashB }),
		(err: unknown) => err instanceof SessionStoreError && err.code === "EMAIL_TAKEN",
		"邮箱已被占用",
	);
	const redeemed = await pool.query<{ user_id: string }>(`SELECT user_id FROM "${schema}".invite_codes WHERE code_hash = $1`, [codeHashA]);
	assert.equal(redeemed.rows[0].user_id, "reg-01");
});
