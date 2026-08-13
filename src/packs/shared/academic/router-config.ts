import type { ProfileContextMessage } from "../../../core/router/index.js";
import type { ProfileDefinition, RouterConfig } from "../../../core/types.js";
import type { AcademicMentorState } from "./state.js";
import { updateAcademicProgress } from "./state.js";

export function createAcademicRouterConfig(
	profiles: ProfileDefinition[],
	state: AcademicMentorState,
	subjectName: string,
): RouterConfig {
	return {
		profiles,
		maxSwitchesPerTurn: 2,
		getProfileState: (key) => state.progressByProfile[key],
		updateProfileState: (key, patch) => updateAcademicProgress(state, key, patch),
		parseMention(text) {
			const match = text.match(/^@([a-zA-Z][a-zA-Z0-9_-]*)/);
			if (!match) return undefined;
			const key = match[1].toLowerCase();
			const rest = text.slice(match[0].length).trim();
			if (!rest) throw new Error(`请在 @${key} 后写下问题`);
			if (key === "pilore") return { profile: null, rest };
			const profile = profiles.find((candidate) => candidate.key === key);
			if (!profile) throw new Error(`未知${subjectName}导师: @${key}`);
			return { profile, rest };
		},
		renderContext(message: ProfileContextMessage) {
			if (!message.profileKey) {
				return "<pilore_profile_context>\n当前模式：PiLore 自动路由。\n</pilore_profile_context>";
			}
			const progress = message.state as { stage?: string; topic?: string; covered?: string[]; pending?: string[] } | undefined;
			const progressText = progress
				? `阶段：${progress.stage || "未标注"}\n主题：${progress.topic || "未标注"}\n已覆盖：${(progress.covered ?? []).join("；")}\n待展开：${(progress.pending ?? []).join("；")}`
				: "尚未记录进度";
			return `<pilore_profile_context>\n当前${subjectName}导师：${message.profileName}（@${message.profileKey}）。严格执行方法论。\n\n## 当前进度\n${progressText}\n\n# 方法论\n${message.methodology}\n</pilore_profile_context>`;
		},
	};
}
