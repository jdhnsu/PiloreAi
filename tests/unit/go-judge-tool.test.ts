import assert from "node:assert/strict";
import test from "node:test";
import {
	CoreState,
	createCodeToolManifest,
	createGoJudgeTools,
	createHttpGoJudgeClient,
	toolsForState,
	type GoJudgeClient,
	type GoJudgeExecutionInput,
	type GoJudgeExecutionResult,
	type GoJudgeLanguage,
	VirtualFS,
} from "../../src/index.js";

function json(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

const cLanguage: GoJudgeLanguage = {
	id: "c",
	name: "C (GCC)",
	sourceFile: "main.c",
	compile: { args: ["/usr/bin/gcc", "main.c", "-o", "main"], outputFile: "main" },
	runArgs: ["main"],
	env: ["PATH=/usr/bin:/bin"],
};

function result(overrides: Partial<GoJudgeExecutionResult> = {}): GoJudgeExecutionResult {
	return {
		id: "run-id",
		language: cLanguage,
		phase: "run",
		status: "Accepted",
		sandboxStatus: "Accepted",
		stdout: "42\n",
		stderr: "",
		compileOutput: null,
		error: null,
		timeSeconds: 0.012,
		wallTimeSeconds: 0.02,
		memoryKilobytes: 4096,
		exitCode: 0,
		processPeak: 1,
		compilation: null,
		...overrides,
	};
}

test("HTTP go-judge client compiles, runs cached executable, reports metrics, and cleans cache", async () => {
	const requests: Array<{ url: string; init?: RequestInit; body?: any }> = [];
	let runCalls = 0;
	const fetchMock: typeof fetch = async (input, init) => {
		const url = String(input);
		const body = init?.body ? JSON.parse(String(init.body)) : undefined;
		requests.push({ url, init, body });
		if (url.endsWith("/version")) return json({ buildVersion: "test" });
		if (url.endsWith("/run") && init?.method === "POST") {
			runCalls += 1;
			if (runCalls === 1) {
				assert.deepEqual(body.cmd[0].args, ["/usr/bin/gcc", "main.c", "-o", "main", "-Wall"]);
				assert.equal(body.cmd[0].copyIn["main.c"].content, "int main(void) { return 0; }");
				return json([{
					status: "Accepted", exitStatus: 0, time: 20_000_000, memory: 8_388_608, runTime: 30_000_000,
					files: { stdout: "", stderr: "" }, fileIds: { main: "cached-main" },
				}]);
			}
			assert.deepEqual(body.cmd[0].args, ["main", "arg-1"]);
			assert.equal(body.cmd[0].files[0].content, "input\n");
			assert.equal(body.cmd[0].copyIn.main.fileId, "cached-main");
			return json([{
				status: "Accepted", exitStatus: 0, time: 12_000_000, memory: 4_194_304, runTime: 20_000_000, procPeak: 1,
				files: { stdout: "42\n", stderr: "" },
			}]);
		}
		if (url.endsWith("/file/cached-main") && init?.method === "DELETE") return json({});
		throw new Error(`unexpected request: ${url}`);
	};
	const client = createHttpGoJudgeClient({
		baseUrl: "http://go-judge.test/",
		fetch: fetchMock,
		languages: [cLanguage],
	});
	assert.deepEqual((await client.listLanguages()).map((language) => language.id), ["c"]);
	const execution = await client.run({
		sourceCode: "int main(void) { return 0; }",
		language: "c",
		stdin: "input\n",
		arguments: ["arg-1"],
		compilerOptions: ["-Wall"],
	});
	assert.equal(execution.status, "Accepted");
	assert.equal(execution.stdout, "42\n");
	assert.equal(execution.timeSeconds, 0.012);
	assert.equal(execution.wallTimeSeconds, 0.02);
	assert.equal(execution.memoryKilobytes, 4096);
	assert.equal(execution.compilation?.timeSeconds, 0.02);
	assert.ok(requests.some((request) => request.url.endsWith("/file/cached-main") && request.init?.method === "DELETE"));
});

test("HTTP go-judge client surfaces compiler failures without starting the program", async () => {
	let runCalls = 0;
	const fetchMock: typeof fetch = async (input, init) => {
		const url = String(input);
		if (url.endsWith("/run") && init?.method === "POST") {
			runCalls += 1;
			return json([{
				status: "Nonzero Exit Status",
				exitStatus: 1,
				time: 10_000_000,
				memory: 2_097_152,
				runTime: 12_000_000,
				files: { stdout: "", stderr: "main.c:1: error: expected declaration" },
			}]);
		}
		throw new Error(`unexpected request: ${url}`);
	};
	const client = createHttpGoJudgeClient({ baseUrl: "http://go-judge.test", fetch: fetchMock, languages: [cLanguage] });
	const execution = await client.run({ sourceCode: "broken", language: "c" });
	assert.equal(runCalls, 1);
	assert.equal(execution.phase, "compile");
	assert.equal(execution.status, "Compilation Error");
	assert.match(execution.compileOutput ?? "", /expected declaration/);
});

test("go-judge tools read VFS source, compare output, and report per-case verdicts", async () => {
	const vfs = new VirtualFS();
	vfs.write("answer.c", "int main(void) { return 0; }");
	const inputs: GoJudgeExecutionInput[] = [];
	const client: GoJudgeClient = {
		listLanguages: async () => [cLanguage],
		run: async (input) => {
			inputs.push(input);
			if (input.stdin === "infra") return result({ status: "Internal Error", sandboxStatus: "Internal Error", stdout: "", error: "runner unavailable" });
			return result();
		},
		runCases: async (input, cases) => {
			inputs.push(input);
			return cases.map((item, index) => index === 0
				? result({ id: `case-${index}`, stdout: "4\n" })
				: result({ id: `case-${index}`, stdout: "8\n" }));
		},
	};
	const tools = createGoJudgeTools(vfs, client);
	const runTool = tools.find((tool) => tool.name === "run_go_judge_code")!;
	const runResponse = await runTool.execute("run-1", {
		entry: "answer.c", language: "c", stdin: "2", expected_output: "42", comparison: "trimmed",
	});
	assert.match(runResponse.content[0]!.type === "text" ? runResponse.content[0].text : "", /判定: 通过/);
	assert.equal(inputs[0]!.sourceCode, "int main(void) { return 0; }");
	const infrastructureResponse = await runTool.execute("run-2", { entry: "answer.c", language: "c", stdin: "infra", expected_output: "anything" });
	assert.match(infrastructureResponse.content[0]!.type === "text" ? infrastructureResponse.content[0].text : "", /基础设施错误（不计为答案错误）/);
	assert.equal((infrastructureResponse.details as { passed: boolean | null }).passed, null);

	const judgeTool = tools.find((tool) => tool.name === "judge_go_judge_code")!;
	const judgeResponse = await judgeTool.execute("judge-1", {
		entry: "answer.c",
		language: "c",
		test_cases: [
			{ name: "basic", stdin: "2", expected_output: "4" },
			{ name: "failing", stdin: "3", expected_output: "6" },
		],
	});
	const text = judgeResponse.content[0]!.type === "text" ? judgeResponse.content[0].text : "";
	assert.match(text, /判定汇总: 1\/2 通过/);
	assert.equal((judgeResponse.details as { allPassed: boolean }).allPassed, false);
});

test("go-judge toolset remains hidden until activated", () => {
	const state = new CoreState();
	const goJudge: GoJudgeClient = {
		listLanguages: async () => [],
		run: async () => result(),
		runCases: async (_input, cases) => cases.map(() => result()),
	};
	const manifest = createCodeToolManifest(
		new VirtualFS(),
		{ exec: async () => ({ id: "x", ok: true, duration: 0, stdout: "", stderr: "" }) },
		undefined,
		goJudge,
	);
	assert.deepEqual(toolsForState(manifest, state, []).map((tool) => tool.name), []);
	state.activateToolset("go_judge");
	assert.deepEqual(toolsForState(manifest, state, []).map((tool) => tool.name), [
		"list_go_judge_languages",
		"run_go_judge_code",
		"judge_go_judge_code",
	]);
});
