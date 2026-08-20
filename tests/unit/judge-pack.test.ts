import assert from "node:assert/strict";
import test from "node:test";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@pilore/pi-ai";
import {
	CoreState,
	createHttpGoJudgeClient,
	createJudgeMentorSession,
	createJudgeMentorState,
	createJudgeService,
	createJudgeToolManifest,
	deriveSessionTitle,
	getDefaultJudgeProfiles,
	toolsForState,
	type GoJudgeClient,
	type GoJudgeExecutionInput,
	type GoJudgeExecutionResult,
	type GoJudgeLanguage,
	type JudgeProblemDraft,
} from "../../src/index.js";

function json(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

const python: GoJudgeLanguage = {
	id: "python",
	name: "Python 3",
	sourceFile: "main.py",
	runArgs: ["/usr/bin/python3", "main.py"],
};

function result(stdout: string, overrides: Partial<GoJudgeExecutionResult> = {}): GoJudgeExecutionResult {
	return {
		id: "run-id",
		language: python,
		phase: "run",
		status: "Accepted",
		sandboxStatus: "Accepted",
		stdout,
		stderr: "",
		compileOutput: null,
		error: null,
		timeSeconds: 0.001,
		wallTimeSeconds: 0.002,
		memoryKilobytes: 1024,
		exitCode: 0,
		processPeak: 1,
		compilation: null,
		...overrides,
	};
}

function outputFor(input: GoJudgeExecutionInput, stdin: string): string {
	const number = Number(stdin.trim());
	if (input.sourceCode.includes("* 2") && Number.isFinite(number)) return `${number * 2}\n`;
	return `${number}\n`;
}

function fakeGoJudge(): GoJudgeClient {
	return {
		listLanguages: async () => [python],
		run: async (input) => result(outputFor(input, input.stdin ?? "")),
		runCases: async (input, cases) => cases.map((item, index) => result(outputFor(input, item.stdin), { id: `case-${index}` })),
	};
}

function draft(): JudgeProblemDraft {
	return {
		title: "数字翻倍",
		difficulty: "easy",
		description: "给定一个整数 n，请输出这个整数的两倍。",
		inputFormat: "一行一个整数 n。",
		outputFormat: "输出整数 2 × n。",
		constraints: ["-1000 <= n <= 1000"],
		examples: [{ input: "2\n", output: "4\n", explanation: "2 的两倍是 4。" }],
		language: "python",
		starterCode: "n = int(input())\n# 输出答案\n",
		referenceSolution: "n = int(input())\nprint(n * 2)\n",
		hiddenTests: [
			{ name: "zero", input: "0\n", expectedOutput: "0\n" },
			{ name: "negative", input: "-3\n", expectedOutput: "-6\n" },
		],
	};
}

test("Judge Pack owns one coach and hides tools until their groups are activated", () => {
	assert.deepEqual(getDefaultJudgeProfiles().map((profile) => profile.key), ["coach"]);
	const state = createJudgeMentorState();
	const manifest = createJudgeToolManifest(createJudgeService(state, fakeGoJudge()));
	const core = new CoreState();
	assert.deepEqual(toolsForState(manifest, core, []).map((tool) => tool.name), []);
	core.activateToolset("problem_cards");
	assert.deepEqual(toolsForState(manifest, core, []).map((tool) => tool.name), ["verify_problem", "publish_problem_card"]);
	core.activateToolset("judge");
	assert.deepEqual(toolsForState(manifest, core, []).map((tool) => tool.name), [
		"list_judge_languages", "run_judge_code", "judge_code", "submit_problem_solution", "verify_problem", "publish_problem_card",
	]);
});

test("Judge service refuses unverified cards, verifies reference solution, and hides private tests", async () => {
	const state = createJudgeMentorState();
	const service = createJudgeService(state, fakeGoJudge());
	assert.throws(() => service.publishProblem("missing"), /必须先成功调用 verify_problem/);
	const verification = await service.verifyProblem(draft());
	assert.equal(verification.verifiedCaseCount, 3);
	const card = service.publishProblem(verification.verificationId);
	assert.equal(card.title, "数字翻倍");
	assert.equal("referenceSolution" in card, false);
	assert.equal("testCases" in card, false);

	const submission = await service.submitSolution("n = int(input())\nprint(n * 2)\n", "python");
	assert.equal(submission.verdict, "accepted");
	assert.equal(submission.passed, 3);
	const hidden = submission.cases.find((item) => item.hidden)!;
	assert.equal(hidden.input, null);
	assert.equal(hidden.expectedOutput, null);
	assert.equal(hidden.actualOutput, null);
});

test("Judge service blocks publication when its own reference solution is wrong", async () => {
	const service = createJudgeService(createJudgeMentorState(), fakeGoJudge());
	const invalid = { ...draft(), referenceSolution: "n = int(input())\nprint(n)\n" };
	await assert.rejects(() => service.verifyProblem(invalid), /参考解答未通过自验证/);
	assert.equal(service.getProblem(), null);
});

test("Judge agent emits a structured problem card only after verification", async () => {
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	const problem = draft();
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("activate_toolset", { toolset: "problem_cards" })]),
		fauxAssistantMessage([fauxToolCall("verify_problem", {
			title: problem.title,
			difficulty: problem.difficulty,
			description: problem.description,
			input_format: problem.inputFormat,
			output_format: problem.outputFormat,
			constraints: problem.constraints,
			examples: problem.examples,
			language: problem.language,
			starter_code: problem.starterCode,
			reference_solution: problem.referenceSolution,
			hidden_tests: problem.hiddenTests.map((item) => ({ name: item.name, input: item.input, expected_output: item.expectedOutput })),
		})]),
		fauxAssistantMessage([fauxToolCall("publish_problem_card", { verification_id: "latest" })]),
		fauxAssistantMessage([fauxText("题目已准备好")]),
	]);
	const session = createJudgeMentorSession({ models, providerId: "faux", modelId: "faux-1", goJudge: fakeGoJudge() });
	const events: any[] = [];
	await session.prompt("给我出题", (event) => events.push(event));
	const cardEvent = events.find((event) => event.type === "tool_end" && event.details?.kind === "judge_problem_card");
	assert.ok(cardEvent);
	assert.equal(cardEvent.details.problem.title, "数字翻倍");
	assert.equal("referenceSolution" in cardEvent.details.problem, false);
	assert.equal(session.getProblem()?.title, "数字翻倍");

	const snapshot = session.exportSnapshot(0);
	assert.ok(snapshot.extensions.judge);
	assert.equal(deriveSessionTitle(snapshot as any), "数字翻倍");
	const restoredFaux = fauxProvider();
	const restoredModels = createModels();
	restoredModels.setProvider(restoredFaux.provider);
	const restored = createJudgeMentorSession({ models: restoredModels, providerId: "faux", modelId: "faux-1", goJudge: fakeGoJudge(), snapshot });
	assert.equal(restored.getProblem()?.title, "数字翻倍");
});

test("HTTP go-judge client compiles once, runs cached executable, and deletes cache", async () => {
	const c: GoJudgeLanguage = {
		id: "c",
		name: "C",
		sourceFile: "main.c",
		compile: { args: ["/usr/bin/gcc", "main.c", "-o", "main"], outputFile: "main" },
		runArgs: ["main"],
	};
	let runCalls = 0;
	let deleted = false;
	const fetchMock: typeof fetch = async (input, init) => {
		const url = String(input);
		if (url.endsWith("/run")) {
			runCalls += 1;
			if (runCalls === 1) return json([{ status: "Accepted", exitStatus: 0, time: 10, memory: 1024, runTime: 20, files: { stdout: "", stderr: "" }, fileIds: { main: "cache-id" } }]);
			return json([{ status: "Accepted", exitStatus: 0, time: 1000, memory: 2048, runTime: 2000, files: { stdout: "ok\n", stderr: "" } }]);
		}
		if (url.endsWith("/file/cache-id") && init?.method === "DELETE") {
			deleted = true;
			return json({});
		}
		throw new Error(`unexpected request ${url}`);
	};
	const client = createHttpGoJudgeClient({ baseUrl: "http://judge.test", fetch: fetchMock, languages: [c] });
	const results = await client.runCases({ sourceCode: "int main(){}", language: "c" }, [{ stdin: "" }, { stdin: "" }]);
	assert.equal(runCalls, 3);
	assert.equal(results.length, 2);
	assert.equal(deleted, true);
});
