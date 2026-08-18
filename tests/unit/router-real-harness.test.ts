import assert from "node:assert/strict";
import test from "node:test";
import { createModels, fauxProvider } from "@pilore/pi-ai";
import { createCodeMentorSession, getDefaultCodeProfiles } from "../../src/index.js";
import { evaluateRouterTurn, type RouterTurnEvidence } from "../harness/router-real-driver.js";

function setupSession() {
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	return createCodeMentorSession({ models, providerId: "faux", modelId: "faux-1" });
}

function evidence(overrides: Partial<Omit<RouterTurnEvidence, "passed">> = {}): Omit<RouterTurnEvidence, "passed"> {
	return {
		prompt: "q",
		expectedStartProfile: null,
		expectedEndProfile: "socrates",
		actualStartProfile: null,
		actualEndProfile: "socrates",
		modelProfileEvents: [{ profile: "socrates", name: "Socrates" }],
		switchCount: 1,
		...overrides,
	};
}

test("Code Pack prompt defines balanced routing and direct switching", () => {
	const prompt = setupSession().runtime.agent.state.systemPrompt;
	assert.match(prompt, /依据完整语义判断/);
	assert.match(prompt, /更换编程主题本身不是换 Profile 的理由/);
	assert.match(prompt, /不要先切 auto 再切目标/);
	assert.match(prompt, /先调用 adopt_profile 切回 auto/);
	assert.match(prompt, /已激活不代表永久固定/);
	for (const profile of getDefaultCodeProfiles()) assert.match(prompt, new RegExp(`@${profile.key}`));
});

test("real router evaluator requires an exact single transition", () => {
	const expected = { prompt: "q", startProfile: null, endProfile: "socrates" };
	assert.equal(evaluateRouterTurn(expected, evidence()), true);
	assert.equal(evaluateRouterTurn(expected, evidence({
		modelProfileEvents: [{ profile: null, name: null }, { profile: "socrates", name: "Socrates" }],
		switchCount: 2,
	})), false);
	assert.equal(evaluateRouterTurn(expected, evidence({ actualEndProfile: "feynman" })), false);
});

test("real router evaluator treats an unchanged profile as stable only without a route event", () => {
	const expected = { prompt: "q", startProfile: "feynman", endProfile: "feynman" };
	const stable = evidence({
		expectedStartProfile: "feynman",
		expectedEndProfile: "feynman",
		actualStartProfile: "feynman",
		actualEndProfile: "feynman",
		modelProfileEvents: [],
		switchCount: 0,
	});
	assert.equal(evaluateRouterTurn(expected, stable), true);
	assert.equal(evaluateRouterTurn(expected, {
		...stable,
		modelProfileEvents: [{ profile: "feynman", name: "Feynman" }],
		switchCount: 1,
	}), false);
});
