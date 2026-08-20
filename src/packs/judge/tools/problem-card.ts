import { Type } from "@pilore/pi-ai";
import type { AgentTool } from "@pilore/pi-agent-core";
import type { JudgeDifficulty } from "../state.js";
import type { JudgeProblemDraft, JudgeService } from "../judge-service.js";

interface VerifyProblemParams {
	title: string;
	difficulty: JudgeDifficulty;
	description: string;
	input_format: string;
	output_format: string;
	constraints: string[];
	examples: Array<{ input: string; output: string; explanation?: string }>;
	language: string;
	starter_code: string;
	reference_solution: string;
	hidden_tests: Array<{ name: string; input: string; expected_output: string }>;
}

export function createProblemCardTools(service: JudgeService): AgentTool<any>[] {
	const verifyParameters = Type.Object({
		title: Type.String({ minLength: 2, maxLength: 120 }),
		difficulty: Type.Union([Type.Literal("easy"), Type.Literal("medium"), Type.Literal("hard")]),
		description: Type.String({ minLength: 20, maxLength: 12_000 }),
		input_format: Type.String({ minLength: 2, maxLength: 3_000 }),
		output_format: Type.String({ minLength: 2, maxLength: 3_000 }),
		constraints: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { minItems: 1, maxItems: 20 }),
		examples: Type.Array(Type.Object({
			input: Type.String(),
			output: Type.String(),
			explanation: Type.Optional(Type.String()),
		}), { minItems: 1, maxItems: 5 }),
		language: Type.String({ description: "参考解答语言 ID" }),
		starter_code: Type.String({ maxLength: 100_000 }),
		reference_solution: Type.String({ minLength: 1, maxLength: 200_000 }),
		hidden_tests: Type.Array(Type.Object({
			name: Type.String({ minLength: 1, maxLength: 100 }),
			input: Type.String(),
			expected_output: Type.String(),
		}), { minItems: 2, maxItems: 15 }),
	});
	return [
		{
			name: "verify_problem",
			label: "验证题目",
			description: "发布题目之前，用参考解答实际运行全部示例与隐藏测试。只有全部通过才返回 verification_id；失败时必须修订题目、答案或用例并重试。",
			parameters: verifyParameters,
			execute: async (_id, raw) => {
				const params = raw as VerifyProblemParams;
				const draft: JudgeProblemDraft = {
					title: params.title,
					difficulty: params.difficulty,
					description: params.description,
					inputFormat: params.input_format,
					outputFormat: params.output_format,
					constraints: params.constraints,
					examples: params.examples.map((example) => ({ ...example, explanation: example.explanation ?? "" })),
					language: params.language,
					starterCode: params.starter_code,
					referenceSolution: params.reference_solution,
					hiddenTests: params.hidden_tests.map((item) => ({ name: item.name, input: item.input, expectedOutput: item.expected_output })),
				};
				const verification = await service.verifyProblem(draft);
				return {
					content: [{ type: "text", text: `题目自验证通过：${verification.verifiedCaseCount} 个用例全部通过。verification_id=${verification.verificationId}。现在必须调用 publish_problem_card 发布题目卡。` }],
					details: { kind: "judge_problem_verified", ...verification },
				};
			},
		},
		{
			name: "publish_problem_card",
			label: "发布题目卡",
			description: "把已通过 verify_problem 的题目以结构化题目卡发布给前端；不暴露参考解答和隐藏测试。",
			parameters: Type.Object({ verification_id: Type.String() }),
			execute: async (_id, raw) => {
				const { verification_id: verificationId } = raw as { verification_id: string };
				const problem = service.publishProblem(verificationId);
				return {
					content: [{ type: "text", text: `题目卡已发布：${problem.title}（${problem.difficulty}）。请让学习者先独立作答，不要泄露参考解答或隐藏测试。` }],
					details: { kind: "judge_problem_card", problem },
				};
			},
		},
	];
}
