import { Type } from "@pilore/pi-ai";
import type { AgentTool } from "@pilore/pi-agent-core";
import type { GoJudgeExecutionInput, GoJudgeExecutionResult } from "../go-judge-client.js";
import type { JudgeEvaluation, JudgeOutputComparison, JudgeService } from "../judge-service.js";

interface CommonParams {
	source_code: string;
	language: string;
	arguments?: string[];
	compiler_options?: string[];
	cpu_time_limit?: number;
	wall_time_limit?: number;
	memory_limit?: number;
	output_limit?: number;
}

interface RunParams extends CommonParams {
	stdin?: string;
}

interface JudgeParams extends CommonParams {
	comparison?: JudgeOutputComparison;
	test_cases: Array<{ name?: string; input: string; expected_output: string }>;
}

const TEXT_LIMIT = 12_000;

function truncate(value: string, limit = TEXT_LIMIT): string {
	if (value.length <= limit) return value;
	const half = Math.floor((limit - 80) / 2);
	return `${value.slice(0, half)}\n... 已截断 ${value.length - half * 2} 个字符 ...\n${value.slice(-half)}`;
}

function display(value: string | null): string {
	if (value === null) return "（无）";
	if (!value) return "（空字符串）";
	return truncate(value);
}

function metric(value: number, unit: string): string {
	return `${Number(value.toFixed(6))} ${unit}`;
}

function executionInput(params: CommonParams): Omit<GoJudgeExecutionInput, "stdin"> {
	return {
		sourceCode: params.source_code,
		language: params.language,
		arguments: params.arguments,
		compilerOptions: params.compiler_options,
		cpuTimeLimit: params.cpu_time_limit,
		wallTimeLimit: params.wall_time_limit,
		memoryLimit: params.memory_limit,
		outputLimit: params.output_limit,
	};
}

function renderExecution(result: GoJudgeExecutionResult): string {
	return [
		`状态: ${result.status}（阶段: ${result.phase}）`,
		`语言: ${result.language.name} (${result.language.id})`,
		`CPU/墙上时间: ${metric(result.timeSeconds, "s")} / ${metric(result.wallTimeSeconds, "s")}`,
		`内存: ${metric(result.memoryKilobytes, "KB")}；退出码: ${result.exitCode}`,
		`stdout:\n${display(result.stdout)}`,
		`stderr:\n${display(result.stderr)}`,
		`编译输出:\n${display(result.compileOutput)}`,
		`系统错误:\n${display(result.error)}`,
	].join("\n");
}

function renderEvaluation(evaluation: JudgeEvaluation): string {
	const header = `判定汇总: ${evaluation.passed}/${evaluation.cases.length} 通过；${evaluation.failed} 个未通过；${evaluation.infrastructureErrors} 个基础设施错误`;
	const cases = evaluation.cases.map((item, index) => [
		`## ${index + 1}. ${item.name}: ${item.outcome}`,
		`状态: ${item.result.status}`,
		`输入:\n${truncate(item.input, 4_000)}`,
		`期望:\n${truncate(item.expectedOutput, 4_000)}`,
		`实际:\n${truncate(item.result.stdout, 4_000)}`,
		`CPU/墙上时间: ${metric(item.result.timeSeconds, "s")} / ${metric(item.result.wallTimeSeconds, "s")}`,
	].join("\n")).join("\n\n");
	return `${header}\n输出比较: ${evaluation.comparison}\n\n${cases}`;
}

export function createJudgeExecutionTools(service: JudgeService): AgentTool<any>[] {
	const common = {
		source_code: Type.String({ description: "完整单文件源码" }),
		language: Type.String({ description: "list_judge_languages 返回的语言 ID" }),
		arguments: Type.Optional(Type.Array(Type.String(), { maxItems: 32 })),
		compiler_options: Type.Optional(Type.Array(Type.String(), { maxItems: 32 })),
		cpu_time_limit: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 30 })),
		wall_time_limit: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 60 })),
		memory_limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1024 * 1024, description: "KB" })),
		output_limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 4 * 1024 * 1024, description: "byte" })),
	};
	return [
		{
			name: "list_judge_languages",
			label: "列出判题语言",
			description: "检查 go-judge 服务并列出当前配置的语言 ID。",
			parameters: Type.Object({}),
			execute: async () => {
				const languages = await service.listLanguages();
				return {
					content: [{ type: "text", text: languages.map((language) => `${language.id}: ${language.name}`).join("\n") }],
					details: { kind: "judge_languages", languages },
				};
			},
		},
		{
			name: "run_judge_code",
			label: "运行代码",
			description: "在 go-judge 中编译并运行单文件源码，返回完整运行指标；用于出题自检或探索运行。",
			parameters: Type.Object({ ...common, stdin: Type.Optional(Type.String()) }),
			execute: async (_id, raw) => {
				const params = raw as RunParams;
				const result = await service.runCode({ ...executionInput(params), stdin: params.stdin });
				return { content: [{ type: "text", text: renderExecution(result) }], details: { kind: "judge_run", result } };
			},
		},
		{
			name: "judge_code",
			label: "按用例判定代码",
			description: "用 1–20 个明确测试用例判定源码；编译型语言只编译一次。",
			parameters: Type.Object({
				...common,
				comparison: Type.Optional(Type.Union([Type.Literal("trimmed"), Type.Literal("exact")])),
				test_cases: Type.Array(Type.Object({
					name: Type.Optional(Type.String()),
					input: Type.String(),
					expected_output: Type.String(),
				}), { minItems: 1, maxItems: 20 }),
			}),
			execute: async (_id, raw) => {
				const params = raw as JudgeParams;
				const evaluation = await service.judgeCode(
					executionInput(params),
					params.test_cases.map((item, index) => ({ name: item.name ?? `用例 ${index + 1}`, input: item.input, expectedOutput: item.expected_output })),
					params.comparison,
				);
				return { content: [{ type: "text", text: renderEvaluation(evaluation) }], details: { kind: "judge_evaluation", evaluation } };
			},
		},
		{
			name: "submit_problem_solution",
			label: "提交题目解答",
			description: "对当前已发布题目运行全部示例与隐藏测试。收到用户代码后必须先调用本工具，再根据结果讲解。",
			parameters: Type.Object({ source_code: Type.String(), language: Type.String() }),
			execute: async (_id, raw) => {
				const params = raw as { source_code: string; language: string };
				const submission = await service.submitSolution(params.source_code, params.language);
				return {
					content: [{ type: "text", text: `提交结果: ${submission.verdict}；${submission.passed}/${submission.total} 通过；CPU ${submission.totalTimeSeconds.toFixed(6)} s；峰值内存 ${submission.peakMemoryKilobytes} KB` }],
					details: { kind: "judge_submission", submission },
				};
			},
		},
	];
}
