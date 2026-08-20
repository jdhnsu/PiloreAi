import type { ToolManifest } from "../../../core/types.js";
import type { CodeEvaluator } from "../evaluator.js";
import type { ExecClient } from "../exec-client.js";
import type { GoJudgeClient } from "../go-judge-client.js";
import type { VirtualFS } from "../vfs.js";
import { createEvaluationTools } from "./evaluation.js";
import { createExecutionTools } from "./execution.js";
import { createGoJudgeTools } from "./go-judge.js";
import { createWorkspaceTools } from "./workspace.js";

export function createCodeToolManifest(vfs: VirtualFS, exec: ExecClient, evaluator?: CodeEvaluator, goJudge?: GoJudgeClient): ToolManifest {
	return {
		groups: [
			{ key: "workspace", description: "读取和写入虚拟代码工作区", load: () => createWorkspaceTools(vfs) },
			{ key: "execution", description: "在远程沙箱运行代码", load: () => createExecutionTools(vfs, exec) },
			...(goJudge ? [{ key: "go_judge", description: "使用 go-judge 编译运行代码并按测试用例判题", load: () => createGoJudgeTools(vfs, goJudge) }] : []),
			...(evaluator ? [{ key: "evaluation", description: "评估当前代码", load: () => createEvaluationTools(vfs, evaluator) }] : []),
		],
		capabilities: {
			write_file: ["file.write", "file.modify"],
			read_file: ["file.read"],
			run_code: ["exec.run"],
			...(goJudge ? {
				list_go_judge_languages: ["go_judge.languages.read"],
				run_go_judge_code: ["go_judge.run"],
				judge_go_judge_code: ["go_judge.judge"],
			} : {}),
			...(evaluator ? { evaluate_code: ["code.evaluate"] } : {}),
		},
		resolveCapability(toolName, args) {
			if (toolName === "read_file") return "file.read";
			if (toolName === "run_code") return "exec.run";
			if (toolName === "list_go_judge_languages") return "go_judge.languages.read";
			if (toolName === "run_go_judge_code") return "go_judge.run";
			if (toolName === "judge_go_judge_code") return "go_judge.judge";
			if (toolName === "evaluate_code") return "code.evaluate";
			if (toolName === "write_file") {
				const path = (args as { path?: unknown })?.path;
				return typeof path === "string" && vfs.has(path) ? "file.modify" : "file.write";
			}
			return undefined;
		},
	};
}
