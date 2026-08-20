import type { ProfileContextMessage } from "../../core/router/index.js";
import type { JsonValue, ProfileDefinition, RouterConfig } from "../../core/types.js";
import { publicProblem, type JudgeMentorState } from "./state.js";
import { updateJudgeProgress, validateJudgeProgressPatch } from "./state.js";

export function createJudgeRouterConfig(profiles: ProfileDefinition[], state: JudgeMentorState): RouterConfig {
	return {
		profiles,
		maxSwitchesPerTurn: 1,
		getProfileState(key) {
			return {
				progress: state.progressByProfile[key] ?? null,
				problem: publicProblem(state.currentProblem),
				lastSubmission: state.lastSubmission ? structuredClone(state.lastSubmission) : null,
			};
		},
		validateProfileStatePatch: (_key, patch) => validateJudgeProgressPatch(patch) as Record<string, JsonValue>,
		updateProfileState: (key, patch) => updateJudgeProgress(state, key, patch),
		parseMention(text) {
			const match = text.match(/^@([a-zA-Z][a-zA-Z0-9_-]*)/);
			if (!match) return undefined;
			const key = match[1].toLowerCase();
			const rest = text.slice(match[0].length).trim();
			if (!rest) throw new Error(`请在 @${key} 后写下问题`);
			if (key === "pilore") return { profile: null, rest };
			const profile = profiles.find((item) => item.key === key);
			if (!profile) throw new Error(`未知 Judge 导师: @${key}`);
			return { profile, rest };
		},
		renderContext(message: ProfileContextMessage) {
			if (!message.profileKey) return `<pilore_profile_context>\n当前模式：PiLore Judge 自动路由。\n</pilore_profile_context>`;
			const context = message.state as {
				progress?: { stage?: string; topic?: string; covered?: string[]; pending?: string[] } | null;
				problem?: { id?: string; title?: string; difficulty?: string; language?: string } | null;
				lastSubmission?: { id?: string; problemId?: string; verdict?: string; passed?: number; total?: number; compileOutput?: string | null; stderr?: string | null; cases?: Array<{ name?: string; passed?: boolean | null; status?: string }> } | null;
			} | undefined;
			const progress = context?.progress;
			const problem = context?.problem;
			const submission = context?.lastSubmission;
			const submissionCases = submission?.cases?.map((item) => `${item.name}: ${item.passed === null ? "基础设施错误" : item.passed ? "通过" : item.status ?? "未通过"}`).join("；") ?? "";
			return `<pilore_profile_context>\n当前 Judge 导师：${message.profileName}（@${message.profileKey}）。先按基础 Prompt 判断本轮是否仍需要这种教学方式；只有决定保持时才执行下列方法论。\n\n## 教学进度\n阶段：${progress?.stage || "未标注"}\n主题：${progress?.topic || "未标注"}\n已覆盖：${progress?.covered?.join("；") || "无"}\n待展开：${progress?.pending?.join("；") || "无"}\n\n## 当前已发布题目（仅公开信息）\n${problem ? `${problem.title} [${problem.difficulty}]，language=${problem.language}，problemId=${problem.id}` : "无"}\n\n## 最近一次可信判题结果\n${submission ? `submissionId=${submission.id}；verdict=${submission.verdict}；${submission.passed}/${submission.total} 通过\n${submissionCases}\n编译输出：${submission.compileOutput || "无"}\nstderr：${submission.stderr || "无"}` : "无。若用户提交代码，必须先调用 submit_problem_solution。"}\n\n# 方法论\n${message.methodology}\n</pilore_profile_context>`;
		},
	};
}
