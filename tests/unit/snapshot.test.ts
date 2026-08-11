import { test } from "node:test";
import assert from "node:assert/strict";
import { createModels, fauxProvider, type UserMessage } from "@earendil-works/pi-ai";
import {
	EDU_SESSION_SNAPSHOT_VERSION,
	InvalidSessionSnapshotError,
	createPersonaContextMessage,
	createEduSession,
	getPersona,
	getDefaultPersonas,
	type EduSessionSnapshotV1,
	type EduSessionSnapshotV2,
} from "../../src/index.js";

function modelsForRestore() {
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	return models;
}

function validSnapshot(): EduSessionSnapshotV2 {
	const message: UserMessage = { role: "user", content: "解释闭包", timestamp: 123 };
	const socrates = getPersona("socrates", getDefaultPersonas())!;
	const teaching = { stage: "辨析", topic: "闭包", covered: ["定义"], pending: ["变量捕获"] };
	return {
		version: EDU_SESSION_SNAPSHOT_VERSION,
		revision: 7,
		activePersonaKey: "socrates",
		teachingByPersona: { socrates: teaching },
		files: { "main.py": "print('snapshot')" },
		messages: [message, createPersonaContextMessage(socrates, teaching, 124)],
	};
}

test("session snapshot JSON 往返并恢复 persona、教学进度、VFS 与消息", () => {
	const snapshot = JSON.parse(JSON.stringify(validSnapshot())) as EduSessionSnapshotV2;
	const session = createEduSession({ models: modelsForRestore(), providerId: "faux", modelId: "faux-1", snapshot });
	assert.equal(session.persona?.key, "socrates");
	assert.equal(session.readFile("main.py"), "print('snapshot')");
	assert.deepEqual(session.exportSnapshot(), snapshot);

	const exported = session.exportSnapshot();
	exported.files["main.py"] = "mutated";
	assert.equal(session.readFile("main.py"), "print('snapshot')", "导出快照必须与会话内部状态隔离");
});

test("snapshot 拒绝未知版本、未知 persona 和损坏消息", () => {
	const models = modelsForRestore();
	const base = { models, providerId: "faux", modelId: "faux-1", personas: getDefaultPersonas() } as const;
	assert.throws(
		() => createEduSession({ ...base, snapshot: { ...validSnapshot(), version: 99 } as unknown as EduSessionSnapshotV1 }),
		InvalidSessionSnapshotError,
	);
	assert.throws(
		() => createEduSession({ ...base, snapshot: { ...validSnapshot(), activePersonaKey: "missing" } }),
		/未知教学方法/,
	);
	assert.throws(
		() => createEduSession({ ...base, snapshot: { ...validSnapshot(), messages: [{ role: "user" }] as never } }),
		/timestamp/,
	);
	const corrupted = validSnapshot();
	const context = corrupted.messages.find((message) => message.role === "pilorePersonaContext")!;
	context.methodology = `${context.methodology}\n被篡改`;
	assert.throws(() => createEduSession({ ...base, snapshot: corrupted }), /personaHash 与方法论内容不匹配/);
});

test("V1 snapshot 恢复时惰性迁移为带 Persona 上下文的 V2", () => {
	const legacy: EduSessionSnapshotV1 = {
		version: 1,
		revision: 3,
		activePersonaKey: "socrates",
		teachingByPersona: { socrates: { stage: "提问", topic: "闭包", covered: [], pending: ["作用域"] } },
		files: {},
		messages: [{ role: "user", content: "继续", timestamp: 10 }],
	};
	const session = createEduSession({ models: modelsForRestore(), providerId: "faux", modelId: "faux-1", snapshot: legacy });
	const migrated = session.exportSnapshot();
	assert.equal(migrated.version, 2);
	assert.equal(migrated.revision, 3);
	assert.equal(migrated.messages.at(-1)?.role, "pilorePersonaContext");
});

test("exportSnapshot 剥离运行时非序列化字段（deferred）", () => {
	const models = modelsForRestore();
	const session = createEduSession({ models, providerId: "faux", modelId: "faux-1" });

	// 直接断言：exportSnapshot 产物必须可 JSON 序列化，且消息不携带 deferred。
	const exported = session.exportSnapshot() as EduSessionSnapshotV2 & {
		messages: Array<{ deferred?: unknown }>;
	};
	for (const m of exported.messages) {
		assert.equal("deferred" in m, false, "快照消息不得携带 deferred 运行时字段");
	}
	assert.doesNotThrow(() => JSON.stringify(exported), "快照必须可 JSON 序列化");
});
