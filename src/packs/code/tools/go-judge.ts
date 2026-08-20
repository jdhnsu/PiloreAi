import { Type } from "@pilore/pi-ai";
import type { AgentTool } from "@pilore/pi-agent-core";
import type { GoJudgeClient, GoJudgeExecutionInput, GoJudgeExecutionResult } from "../go-judge-client.js";
import type { VirtualFS } from "../vfs.js";

interface CommonGoJudgeParams {
	entry: string;
	language: string;
	arguments?: string[];
	compiler_options?: string[];
	cpu_time_limit?: number;
	wall_time_limit?: number;
	memory_limit?: number;
	output_limit?: number;
}

type OutputComparison = "exact" | "trimmed";

interface RunGoJudgeParams extends CommonGoJudgeParams {
	stdin?: string;
	expected_output?: string;
	comparison?: OutputComparison;
}

interface GoJudgeTestCase {
	name?: string;
	stdin: string;
	expected_output: string;
}

interface JudgeCodeParams extends CommonGoJudgeParams {
	comparison?: OutputComparison;
	test_cases: GoJudgeTestCase[];
}

type CaseOutcome = "passed" | "failed" | "infrastructure_error";

const TEXT_LIMIT = 12_000;
const CASE_TEXT_LIMIT = 4_000;

function truncate(value: string, limit: number): string {
	if (value.length <= limit) return value;
	const half = Math.floor((limit - 80) / 2);
	return `${value.slice(0, half)}\n... 已截断 ${value.length - half * 2} 个字符 ...\n${value.slice(-half)}`;
}

function display(value: string | null, limit = TEXT_LIMIT): string {
	if (value === null) return "（无）";
	if (value === "") return "（空字符串）";
	return truncate(value, limit);
}

function metric(value: number, unit: string): string {
	return Number.isFinite(value) ? `${Number(value.toFixed(6))} ${unit}` : "未知";
}

function normalizeOutput(value: string, comparison: OutputComparison): string {
	if (comparison === "exact") return value;
	return value.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trimEnd();
}

function outputsMatch(actual: string, expected: string, comparison: OutputComparison): boolean {
	return normalizeOutput(actual, comparison) === normalizeOutput(expected, comparison);
}

function isInfrastructureError(result: GoJudgeExecutionResult): boolean {
	return result.status === "Internal Error" || result.status === "File Error";
}

function outcome(result: GoJudgeExecutionResult, expectedOutput: string, comparison: OutputComparison): CaseOutcome {
	if (isInfrastructureError(result)) return "infrastructure_error";
	if (result.status !== "Accepted") return "failed";
	return outputsMatch(result.stdout, expectedOutput, comparison) ? "passed" : "failed";
}

function outcomeLabel(value: CaseOutcome): string {
	if (value === "passed") return "通过";
	if (value === "infrastructure_error") return "基础设施错误（不计为答案错误）";
	return "未通过";
}

function toExecutionInput(sourceCode: string, params: CommonGoJudgeParams): Omit<GoJudgeExecutionInput, "stdin"> {
	return {
		sourceCode,
		language: params.language,
		arguments: params.arguments,
		compilerOptions: params.compiler_options,
		cpuTimeLimit: params.cpu_time_limit,
		wallTimeLimit: params.wall_time_limit,
		memoryLimit: params.memory_limit,
		outputLimit: params.output_limit,
	};
}

function validateCommon(params: CommonGoJudgeParams): void {
	if (!params.language) throw new Error("language 不能为空；不确定时先调用 list_go_judge_languages");
	for (const [name, value, max] of [
		["cpu_time_limit", params.cpu_time_limit, 30],
		["wall_time_limit", params.wall_time_limit, 60],
		["memory_limit", params.memory_limit, 1024 * 1024],
		["output_limit", params.output_limit, 4 * 1024 * 1024],
	] as const) {
		if (value !== undefined && (!Number.isFinite(value) || value <= 0 || value > max)) throw new Error(`${name} 必须大于 0 且不超过 ${max}`);
	}
}

function renderResult(result: GoJudgeExecutionResult, expectedOutput?: string, comparison: OutputComparison = "trimmed"): string {
	const verdict = expectedOutput === undefined
		? null
		: outcome(result, expectedOutput, comparison);
	const executionStatus = expectedOutput !== undefined && result.status === "Accepted" && verdict === "failed"
		? "Wrong Answer（输出不匹配）"
		: result.status;
	const lines = [
		`状态: ${executionStatus}（go-judge: ${result.sandboxStatus}；阶段: ${result.phase}）`,
		...(verdict === null ? [] : [`判定: ${outcomeLabel(verdict)}；输出比较: ${comparison}`]),
		`语言: ${result.language.name} (${result.language.id})`,
		`CPU 时间: ${metric(result.timeSeconds, "s")}`,
		`墙上时间: ${metric(result.wallTimeSeconds, "s")}`,
		`内存: ${metric(result.memoryKilobytes, "KB")}`,
		`退出码: ${result.exitCode}`,
		`进程峰值: ${result.processPeak ?? "未知"}`,
		`运行 ID: ${result.id}`,
		...(result.compilation ? [
			`编译 CPU/墙上时间: ${metric(result.compilation.timeSeconds, "s")} / ${metric(result.compilation.wallTimeSeconds, "s")}`,
			`编译内存: ${metric(result.compilation.memoryKilobytes, "KB")}`,
		] : []),
		`stdout:\n${display(result.stdout)}`,
		`stderr:\n${display(result.stderr)}`,
		`编译输出:\n${display(result.compileOutput)}`,
		`系统错误:\n${display(result.error)}`,
		...(result.cleanupError ? [`缓存清理警告:\n${display(result.cleanupError)}`] : []),
	];
	return lines.join("\n");
}

export function createGoJudgeTools(vfs: VirtualFS, client: GoJudgeClient): AgentTool<any>[] {
	const common = {
		entry: Type.String({ description: "虚拟工作区中的单文件入口路径" }),
		language: Type.String({ description: "list_go_judge_languages 返回的语言 ID，如 c、cpp、python" }),
		arguments: Type.Optional(Type.Array(Type.String(), { maxItems: 32 })),
		compiler_options: Type.Optional(Type.Array(Type.String(), { maxItems: 32 })),
		cpu_time_limit: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 30, description: "运行 CPU 秒数" })),
		wall_time_limit: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 60, description: "运行墙上时间秒数" })),
		memory_limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1024 * 1024, description: "运行内存上限，单位 KB" })),
		output_limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 4 * 1024 * 1024, description: "每个输出流上限，单位 byte" })),
	};
	const comparison = Type.Optional(Type.Union([Type.Literal("trimmed"), Type.Literal("exact")]));
	const listParameters = Type.Object({});
	const runParameters = Type.Object({
		...common,
		stdin: Type.Optional(Type.String()),
		expected_output: Type.Optional(Type.String({ description: "提供后在本地按 comparison 判定输出" })),
		comparison,
	});
	const judgeParameters = Type.Object({
		...common,
		comparison,
		test_cases: Type.Array(Type.Object({
			name: Type.Optional(Type.String()),
			stdin: Type.String(),
			expected_output: Type.String(),
		}), { minItems: 1, maxItems: 20 }),
	});

	return [
		{
			name: "list_go_judge_languages",
			label: "列出 go-judge 语言",
			description: "检查 go-judge 服务并列出当前客户端配置的语言 ID。go-judge 本身不提供语言目录，语言是否可用取决于容器内安装的编译器/运行时。",
			parameters: listParameters,
			execute: async () => {
				const languages = await client.listLanguages();
				return {
					content: [{ type: "text", text: languages.map((language) => `${language.id}: ${language.name}（入口 ${language.sourceFile}）`).join("\n") || "没有配置 go-judge 语言" }],
					details: { languages },
				};
			},
		},
		{
			name: "run_go_judge_code",
			label: "在 go-judge 运行代码",
			description: "把虚拟工作区中的单文件编译并运行，返回 stdout/stderr、编译输出、CPU/墙上时间、内存、退出码和运行 ID；可提供期望输出进行单例判定。",
			parameters: runParameters,
			execute: async (_id, raw) => {
				const params = raw as RunGoJudgeParams;
				validateCommon(params);
				const sourceCode = vfs.read(params.entry);
				const comparisonMode = params.comparison ?? "trimmed";
				const result = await client.run({
					...toExecutionInput(sourceCode, params),
					stdin: params.stdin,
				});
				const verdict = params.expected_output === undefined ? null : outcome(result, params.expected_output, comparisonMode);
				return {
					content: [{ type: "text", text: renderResult(result, params.expected_output, comparisonMode) }],
					details: {
						result,
						comparison: comparisonMode,
						verdict,
						passed: verdict === null || verdict === "infrastructure_error" ? null : verdict === "passed",
					},
				};
			},
		},
		{
			name: "judge_go_judge_code",
			label: "用测试用例判定代码",
			description: "用 1–20 个测试用例判定虚拟工作区中的单文件；编译型语言只编译一次，随后并发运行用例，逐例返回期望/实际输出和资源数据。测试通过只能证明覆盖到的用例通过。",
			parameters: judgeParameters,
			execute: async (_id, raw) => {
				const params = raw as JudgeCodeParams;
				validateCommon(params);
				if (!Array.isArray(params.test_cases) || params.test_cases.length < 1 || params.test_cases.length > 20) {
					throw new Error("test_cases 数量必须在 1–20 之间");
				}
				const comparisonMode = params.comparison ?? "trimmed";
				const sourceCode = vfs.read(params.entry);
				const results = await client.runCases(
					toExecutionInput(sourceCode, params),
					params.test_cases.map((testCase) => ({ stdin: testCase.stdin })),
				);
				if (results.length !== params.test_cases.length) throw new Error("go-judge 返回的用例结果数量不匹配");
				const outcomes = results.map((result, index) => outcome(result, params.test_cases[index]!.expected_output, comparisonMode));
				const passed = outcomes.filter((value) => value === "passed").length;
				const failed = outcomes.filter((value) => value === "failed").length;
				const infrastructureErrors = outcomes.filter((value) => value === "infrastructure_error").length;
				const totalTime = results.reduce((sum, result) => sum + result.timeSeconds, 0);
				const peakMemory = Math.max(...results.map((result) => result.memoryKilobytes));
				const cleanupErrors = [...new Set(results.flatMap((result) => result.cleanupError ? [result.cleanupError] : []))];
				const cases = results.map((result, index) => ({
					name: params.test_cases[index]!.name ?? `用例 ${index + 1}`,
					stdin: params.test_cases[index]!.stdin,
					expectedOutput: params.test_cases[index]!.expected_output,
					outcome: outcomes[index]!,
					passed: outcomes[index] === "passed" ? true : outcomes[index] === "failed" ? false : null,
					result,
				}));
				const renderedCases = cases.map((item, index) => [
					`## ${index + 1}. ${item.name}: ${outcomeLabel(item.outcome)}`,
					`状态: ${item.result.status}（go-judge: ${item.result.sandboxStatus}；阶段: ${item.result.phase}）`,
					`CPU 时间: ${metric(item.result.timeSeconds, "s")}；墙上时间: ${metric(item.result.wallTimeSeconds, "s")}；内存: ${metric(item.result.memoryKilobytes, "KB")}`,
					`输入:\n${display(item.stdin, CASE_TEXT_LIMIT)}`,
					`期望输出:\n${display(item.expectedOutput, CASE_TEXT_LIMIT)}`,
					`实际 stdout:\n${display(item.result.stdout, CASE_TEXT_LIMIT)}`,
					...(item.result.stderr ? [`stderr:\n${display(item.result.stderr, CASE_TEXT_LIMIT)}`] : []),
					...(item.result.compileOutput ? [`编译输出:\n${display(item.result.compileOutput, CASE_TEXT_LIMIT)}`] : []),
					...(item.result.error ? [`系统错误:\n${display(item.result.error, CASE_TEXT_LIMIT)}`] : []),
					`运行 ID: ${item.result.id}`,
				].join("\n")).join("\n\n");
				return {
					content: [{
						type: "text",
						text: `判定汇总: ${passed}/${results.length} 通过；${failed} 个代码用例未通过；${infrastructureErrors} 个基础设施错误${infrastructureErrors ? "（这些用例不能用于判断答案正误）" : ""}\n输出比较: ${comparisonMode}\n总 CPU 时间: ${totalTime.toFixed(6)} s\n峰值内存: ${metric(peakMemory, "KB")}${cleanupErrors.length ? `\n缓存清理警告: ${cleanupErrors.join("；")}` : ""}\n\n${renderedCases}`,
					}],
					details: {
						passed,
						failed,
						infrastructureErrors,
						total: results.length,
						allPassed: passed === results.length,
						conclusive: infrastructureErrors === 0,
						comparison: comparisonMode,
						totalTimeSeconds: totalTime,
						peakMemoryKilobytes: peakMemory,
						cleanupErrors,
						cases,
					},
				};
			},
		},
	];
}
