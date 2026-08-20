import type { ToolManifest } from "../../../core/types.js";
import type { JudgeService } from "../judge-service.js";
import { createJudgeExecutionTools } from "./judge.js";
import { createProblemCardTools } from "./problem-card.js";

export function createJudgeToolManifest(service: JudgeService): ToolManifest {
	return {
		groups: [
			{ key: "judge", description: "运行代码、按用例判题并提交当前题目解答", load: () => createJudgeExecutionTools(service) },
			{ key: "problem_cards", description: "自验证题目并向前端发布结构化题目卡", load: () => createProblemCardTools(service) },
		],
		capabilities: {
			list_judge_languages: ["judge.languages.read"],
			run_judge_code: ["judge.run"],
			judge_code: ["judge.evaluate"],
			submit_problem_solution: ["judge.submit"],
			verify_problem: ["judge.problem.verify"],
			publish_problem_card: ["judge.problem.publish"],
		},
		resolveCapability(toolName) {
			if (toolName === "list_judge_languages") return "judge.languages.read";
			if (toolName === "run_judge_code") return "judge.run";
			if (toolName === "judge_code") return "judge.evaluate";
			if (toolName === "submit_problem_solution") return "judge.submit";
			if (toolName === "verify_problem") return "judge.problem.verify";
			if (toolName === "publish_problem_card") return "judge.problem.publish";
			return undefined;
		},
	};
}
