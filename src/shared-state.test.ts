import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_SWITCHES_PER_TURN, SharedState, type Persona } from "./index.js";

function makePersona(key: string, name = key): Persona {
	return {
		key,
		name,
		file: `${key}.md`,
		prompt: `## ${name} 的方法论（测试用）`,
		meta: { name, description: `${name}: 测试用老师`, mode: "primary", capabilities: {} },
	};
}

const SOCRATES = makePersona("socrates", "Socrates");
const ORIS = makePersona("oris", "Oris");

test("setPersona 写入单一状态源并通知监听者", () => {
	const shared = new SharedState();
	const seen: Array<{ persona: Persona | undefined; source: string }> = [];
	shared.onPersonaChange((p, s) => seen.push({ persona: p, source: s }));

	shared.setPersona(SOCRATES, "model");
	shared.setPersona(undefined, "model");
	shared.setPersona(ORIS, "user");

	assert.equal(shared.activePersona?.key, "oris");
	assert.deepEqual(
		seen.map((x) => [x.persona?.key ?? null, x.source]),
		[
			["socrates", "model"],
			[null, "model"],
			["oris", "user"],
		],
	);
});

test("canAdopt:同一方法重复声明被拦截", () => {
	const shared = new SharedState();
	shared.setPersona(SOCRATES, "model");
	const reason = shared.canAdopt("socrates");
	assert.ok(reason, "应返回拦截原因");
	assert.match(reason!, /重复/);
});

test("canAdopt:同轮切换超上限被拦截,resetUserTurn 后重置", () => {
	const shared = new SharedState();
	assert.equal(shared.canAdopt("socrates"), undefined);
	shared.recordSwitch();
	assert.equal(shared.canAdopt("oris"), undefined);
	shared.recordSwitch();
	// 第 3 次切换达到上限
	const reason = shared.canAdopt("feynman");
	assert.ok(reason, "应超出上限被拦截");
	assert.match(reason!, /上限/);

	shared.resetUserTurn();
	assert.equal(shared.canAdopt("feynman"), undefined, "resetUserTurn 后计数清零,应放行");
});

test("canAdopt:MAX_SWITCHES_PER_TURN 为 2", () => {
	assert.equal(MAX_SWITCHES_PER_TURN, 2);
});

test("updateTeaching:合并写入并返回快照", () => {
	const shared = new SharedState();
	shared.setPersona(SOCRATES, "model");

	const first = shared.updateTeaching({ stage: "讲解", topic: "Python 闭包" });
	assert.deepEqual(first, { stage: "讲解", topic: "Python 闭包", covered: [], pending: [] });

	const second = shared.updateTeaching({ covered: ["闭包的定义"], pending: ["变量捕获易错点"] });
	assert.deepEqual(second, {
		stage: "讲解",
		topic: "Python 闭包",
		covered: ["闭包的定义"],
		pending: ["变量捕获易错点"],
	});

	// 当前 persona 的进度可取
	assert.deepEqual(shared.getTeaching(), second);
});

test("updateTeaching:按 persona key 隔离保存,切换不丢", () => {
	const shared = new SharedState();
	shared.setPersona(SOCRATES, "model");
	shared.updateTeaching({ stage: "辨析", topic: "== vs is" });

	shared.setPersona(ORIS, "model");
	assert.equal(shared.getTeaching(), undefined, "切到另一位老师,进度默认空白");

	shared.setPersona(SOCRATES, "model");
	assert.equal(shared.getTeaching()?.topic, "== vs is", "切回 Socrates 恢复原进度");
});

test("updateTeaching:无激活老师时报错", () => {
	const shared = new SharedState();
	assert.throws(() => shared.updateTeaching({ stage: "讲解" }), /adopt_persona/);
});

test("getTeaching:传入 key 与默认当前老师等价", () => {
	const shared = new SharedState();
	shared.setPersona(SOCRATES, "model");
	shared.updateTeaching({ topic: "闭包" });
	assert.equal(shared.getTeaching("socrates")?.topic, "闭包");
	assert.equal(shared.getTeaching("oris"), undefined);
});

test("resetUserTurn 只重置计数,不影响 persona 与进度", () => {
	const shared = new SharedState();
	shared.setPersona(SOCRATES, "model");
	shared.recordSwitch();
	shared.updateTeaching({ stage: "讲解" });
	shared.resetUserTurn();

	assert.equal(shared.switchCount, 0);
	assert.equal(shared.activePersona?.key, "socrates");
	assert.equal(shared.getTeaching()?.stage, "讲解");
});