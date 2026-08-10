import { test } from "node:test";
import assert from "node:assert/strict";
import { createModels, fauxProvider, type UserMessage } from "@earendil-works/pi-ai";
import {
	EDU_SESSION_SNAPSHOT_VERSION,
	InvalidSessionSnapshotError,
	createEduSession,
	getDefaultPersonas,
	type EduSessionSnapshotV1,
} from "../../src/index.js";

function modelsForRestore() {
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	return models;
}

function validSnapshot(): EduSessionSnapshotV1 {
	const message: UserMessage = { role: "user", content: "解释闭包", timestamp: 123 };
	return {
		version: EDU_SESSION_SNAPSHOT_VERSION,
		revision: 7,
		activePersonaKey: "socrates",
		teachingByPersona: {
			socrates: { stage: "辨析", topic: "闭包", covered: ["定义"], pending: ["变量捕获"] },
		},
		files: { "main.py": "print('snapshot')" },
		messages: [message],
	};
}

test("session snapshot JSON 往返并恢复 persona、教学进度、VFS 与消息", () => {
	const snapshot = JSON.parse(JSON.stringify(validSnapshot())) as EduSessionSnapshotV1;
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
		() => createEduSession({ ...base, snapshot: { ...validSnapshot(), version: 2 } as unknown as EduSessionSnapshotV1 }),
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
});
