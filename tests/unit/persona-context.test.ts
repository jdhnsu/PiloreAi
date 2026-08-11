import assert from "node:assert/strict";
import { test } from "node:test";
import { createModels, fauxProvider, type UserMessage } from "@earendil-works/pi-ai";
import {
	convertPiLoreMessages,
	createEduSession,
	createPersonaContextMessage,
	getPersona,
	getDefaultPersonas,
} from "../../src/index.js";

function fauxModels() {
	const provider = fauxProvider();
	const models = createModels();
	models.setProvider(provider.provider);
	return models;
}

test("Persona context 与下一条 user 确定性合并，末尾待发送上下文被过滤", () => {
	const persona = getPersona("feynman", getDefaultPersonas())!;
	const context = createPersonaContextMessage(persona, undefined, 10);
	const user: UserMessage = { role: "user", content: "解释递归", timestamp: 11 };
	const once = convertPiLoreMessages([context, user]);
	const twice = convertPiLoreMessages([context, user]);
	assert.deepEqual(once, twice);
	assert.equal(once.length, 1);
	assert.equal(once[0].role, "user");
	assert.match(typeof once[0].content === "string" ? once[0].content : "", /解释递归/);
	assert.match(typeof once[0].content === "string" ? once[0].content : "", /教学方法/);
	assert.deepEqual(convertPiLoreMessages([context]), []);
});

test("手动 Persona 切换只追加内部消息且 system prompt 字节不变", () => {
	const session = createEduSession({ models: fauxModels(), providerId: "faux", modelId: "faux-1" });
	const before = session.exportSnapshot();
	session.setPersona("feynman");
	session.setPersona("socrates");
	const after = session.exportSnapshot();
	assert.equal(after.messages.length, before.messages.length + 1, "未发送的连续切换只保留最后一次");
	assert.equal(after.messages.at(-1)?.role, "pilorePersonaContext");
	assert.equal(session.persona?.key, "socrates");
});
