import { randomUUID } from "node:crypto";
import type {
	GoJudgeClient,
	GoJudgeExecutionInput,
	GoJudgeExecutionResult,
	GoJudgeLanguage,
} from "./go-judge-client.js";
import {
	publicProblem,
	type JudgeDifficulty,
	type JudgeMentorState,
	type JudgeProblemCard,
	type JudgeProblemExample,
	type JudgeProblemRecord,
	type JudgeProblemTestCase,
	type JudgeSubmission,
	type JudgeSubmissionCase,
} from "./state.js";

export type JudgeOutputComparison = "exact" | "trimmed";

export interface JudgeProblemDraft {
	title: string;
	difficulty: JudgeDifficulty;
	description: string;
	inputFormat: string;
	outputFormat: string;
	constraints: string[];
	examples: JudgeProblemExample[];
	language: string;
	starterCode: string;
	referenceSolution: string;
	hiddenTests: Array<{ name: string; input: string; expectedOutput: string }>;
}

export interface JudgeEvaluationCase {
	name: string;
	input: string;
	expectedOutput: string;
	outcome: "passed" | "failed" | "infrastructure_error";
	result: GoJudgeExecutionResult;
}

export interface JudgeEvaluation {
	passed: number;
	failed: number;
	infrastructureErrors: number;
	allPassed: boolean;
	comparison: JudgeOutputComparison;
	cases: JudgeEvaluationCase[];
}

export interface JudgeService {
	listLanguages(): Promise<GoJudgeLanguage[]>;
	runCode(input: GoJudgeExecutionInput): Promise<GoJudgeExecutionResult>;
	judgeCode(input: Omit<GoJudgeExecutionInput, "stdin">, cases: Array<{ name: string; input: string; expectedOutput: string }>, comparison?: JudgeOutputComparison): Promise<JudgeEvaluation>;
	verifyProblem(draft: JudgeProblemDraft): Promise<{ verificationId: string; problemId: string; verifiedCaseCount: number; language: string }>;
	publishProblem(verificationId: string): JudgeProblemCard;
	submitSolution(sourceCode: string, language: string): Promise<JudgeSubmission>;
	getProblem(): JudgeProblemCard | null;
	getLastSubmission(): JudgeSubmission | null;
}

function normalizeOutput(value: string, comparison: JudgeOutputComparison): string {
	if (comparison === "exact") return value;
	return value.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trimEnd();
}

export function judgeOutputsMatch(actual: string, expected: string, comparison: JudgeOutputComparison = "trimmed"): boolean {
	return normalizeOutput(actual, comparison) === normalizeOutput(expected, comparison);
}

function isInfrastructureError(result: GoJudgeExecutionResult): boolean {
	return result.status === "Internal Error" || result.status === "File Error";
}

function boundedString(value: string, name: string, min: number, max: number): string {
	const clean = value.trim();
	if (clean.length < min || clean.length > max) throw new Error(`${name} 长度必须在 ${min}–${max} 字符之间`);
	return clean;
}

function validateDraft(draft: JudgeProblemDraft): void {
	boundedString(draft.title, "题目标题", 2, 120);
	boundedString(draft.description, "题目描述", 20, 12_000);
	boundedString(draft.inputFormat, "输入格式", 2, 3_000);
	boundedString(draft.outputFormat, "输出格式", 2, 3_000);
	if (!(["easy", "medium", "hard"] as string[]).includes(draft.difficulty)) throw new Error("difficulty 必须是 easy/medium/hard");
	if (!draft.language) throw new Error("题目 language 不能为空");
	if (!draft.referenceSolution.trim()) throw new Error("参考解答不能为空");
	if (draft.referenceSolution.length > 200_000 || draft.starterCode.length > 100_000) throw new Error("题目代码过长");
	if (!Array.isArray(draft.constraints) || draft.constraints.length < 1 || draft.constraints.length > 20) throw new Error("constraints 数量必须在 1–20 之间");
	for (const constraint of draft.constraints) boundedString(constraint, "约束", 1, 500);
	if (!Array.isArray(draft.examples) || draft.examples.length < 1 || draft.examples.length > 5) throw new Error("examples 数量必须在 1–5 之间");
	for (const [index, example] of draft.examples.entries()) {
		if (typeof example.input !== "string" || typeof example.output !== "string" || typeof example.explanation !== "string") {
			throw new Error(`examples[${index}] 格式非法`);
		}
	}
	if (!Array.isArray(draft.hiddenTests) || draft.hiddenTests.length < 2 || draft.hiddenTests.length > 15) throw new Error("hidden_tests 数量必须在 2–15 之间");
	if (draft.examples.length + draft.hiddenTests.length > 20) throw new Error("示例与隐藏测试总数不能超过 20");
	for (const [index, item] of draft.hiddenTests.entries()) {
		boundedString(item.name, `hidden_tests[${index}].name`, 1, 100);
		if (typeof item.input !== "string" || typeof item.expectedOutput !== "string") throw new Error(`hidden_tests[${index}] 格式非法`);
	}
}

function cloneSubmission(submission: JudgeSubmission | null): JudgeSubmission | null {
	return submission ? structuredClone(submission) : null;
}

export function createJudgeService(state: JudgeMentorState, client: GoJudgeClient): JudgeService {
	async function judgeCode(
		input: Omit<GoJudgeExecutionInput, "stdin">,
		cases: Array<{ name: string; input: string; expectedOutput: string }>,
		comparison: JudgeOutputComparison = "trimmed",
	): Promise<JudgeEvaluation> {
		if (!cases.length || cases.length > 20) throw new Error("测试用例数量必须在 1–20 之间");
		const results = await client.runCases(input, cases.map((item) => ({ stdin: item.input })));
		if (results.length !== cases.length) throw new Error("go-judge 返回的用例结果数量不匹配");
		const evaluated = results.map((result, index): JudgeEvaluationCase => {
			const spec = cases[index]!;
			const caseOutcome = isInfrastructureError(result)
				? "infrastructure_error"
				: result.status === "Accepted" && judgeOutputsMatch(result.stdout, spec.expectedOutput, comparison)
					? "passed"
					: "failed";
			return { name: spec.name, input: spec.input, expectedOutput: spec.expectedOutput, outcome: caseOutcome, result };
		});
		const passed = evaluated.filter((item) => item.outcome === "passed").length;
		const failed = evaluated.filter((item) => item.outcome === "failed").length;
		const infrastructureErrors = evaluated.filter((item) => item.outcome === "infrastructure_error").length;
		return { passed, failed, infrastructureErrors, allPassed: passed === evaluated.length, comparison, cases: evaluated };
	}

	return {
		listLanguages: () => client.listLanguages(),
		runCode: (input) => client.run(input),
		judgeCode,
		async verifyProblem(draft) {
			validateDraft(draft);
			const languages = await client.listLanguages();
			if (!languages.some((language) => language.id === draft.language)) throw new Error(`未配置语言 ${draft.language}`);
			const testCases: JudgeProblemTestCase[] = [
				...draft.examples.map((example, index) => ({
					name: `示例 ${index + 1}`,
					input: example.input,
					expectedOutput: example.output,
					hidden: false,
				})),
				...draft.hiddenTests.map((item) => ({
					name: item.name,
					input: item.input,
					expectedOutput: item.expectedOutput,
					hidden: true,
				})),
			];
			const evaluation = await judgeCode(
				{ sourceCode: draft.referenceSolution, language: draft.language },
				testCases.map((item) => ({ name: item.name, input: item.input, expectedOutput: item.expectedOutput })),
				"trimmed",
			);
			if (!evaluation.allPassed) {
				const failures = evaluation.cases
					.filter((item) => item.outcome !== "passed")
					.map((item) => `${item.name}: ${item.outcome === "infrastructure_error" ? item.result.status : `${item.result.status}; actual=${JSON.stringify(item.result.stdout)} expected=${JSON.stringify(item.expectedOutput)}`}`)
					.join("；");
				throw new Error(`参考解答未通过自验证，禁止发布题目：${failures}`);
			}
			const now = new Date().toISOString();
			const problemId = randomUUID();
			const verificationId = randomUUID();
			const problem: JudgeProblemRecord = {
				id: problemId,
				title: draft.title.trim(),
				difficulty: draft.difficulty,
				description: draft.description.trim(),
				inputFormat: draft.inputFormat.trim(),
				outputFormat: draft.outputFormat.trim(),
				constraints: [...draft.constraints],
				examples: draft.examples.map((example) => ({ ...example })),
				language: draft.language,
				starterCode: draft.starterCode,
				createdAt: now,
				referenceSolution: draft.referenceSolution,
				testCases,
				verifiedAt: now,
			};
			state.pendingVerification = { verificationId, problem, verifiedCaseCount: testCases.length };
			return { verificationId, problemId, verifiedCaseCount: testCases.length, language: draft.language };
		},
		publishProblem(verificationId) {
			const pending = state.pendingVerification;
			if (!pending || (verificationId !== "latest" && pending.verificationId !== verificationId)) throw new Error("verification_id 无效或已使用；必须先成功调用 verify_problem");
			state.currentProblem = structuredClone(pending.problem);
			state.pendingVerification = null;
			state.lastSubmission = null;
			return publicProblem(state.currentProblem)!;
		},
		async submitSolution(sourceCode, language) {
			const problem = state.currentProblem;
			if (!problem) throw new Error("当前没有已发布题目，请先生成题目卡");
			if (!sourceCode.trim()) throw new Error("提交代码不能为空");
			if (sourceCode.length > 200_000) throw new Error("提交代码过长");
			const evaluation = await judgeCode(
				{ sourceCode, language },
				problem.testCases.map((item) => ({ name: item.name, input: item.input, expectedOutput: item.expectedOutput })),
				"trimmed",
			);
			const cases: JudgeSubmissionCase[] = evaluation.cases.map((item, index) => {
				const spec = problem.testCases[index]!;
				return {
					name: spec.hidden ? `隐藏用例 ${problem.testCases.slice(0, index + 1).filter((test) => test.hidden).length}` : spec.name,
					hidden: spec.hidden,
					passed: item.outcome === "infrastructure_error" ? null : item.outcome === "passed",
					status: item.result.status === "Accepted" && item.outcome === "failed" ? "Wrong Answer" : item.result.status,
					timeSeconds: item.result.timeSeconds,
					memoryKilobytes: item.result.memoryKilobytes,
					input: spec.hidden ? null : spec.input,
					expectedOutput: spec.hidden ? null : spec.expectedOutput,
					actualOutput: spec.hidden ? null : item.result.stdout,
				};
			});
			const firstDiagnostic = evaluation.cases.find((item) => item.result.compileOutput || item.result.stderr);
			const submission: JudgeSubmission = {
				id: randomUUID(),
				problemId: problem.id,
				language,
				verdict: evaluation.infrastructureErrors > 0 ? "infrastructure_error" : evaluation.allPassed ? "accepted" : "rejected",
				passed: evaluation.passed,
				total: evaluation.cases.length,
				totalTimeSeconds: evaluation.cases.reduce((sum, item) => sum + item.result.timeSeconds, 0),
				peakMemoryKilobytes: Math.max(...evaluation.cases.map((item) => item.result.memoryKilobytes)),
				compileOutput: firstDiagnostic?.result.compileOutput ?? null,
				stderr: firstDiagnostic?.result.stderr || null,
				submittedAt: new Date().toISOString(),
				cases,
			};
			state.lastSubmission = submission;
			return structuredClone(submission);
		},
		getProblem: () => publicProblem(state.currentProblem),
		getLastSubmission: () => cloneSubmission(state.lastSubmission),
	};
}
