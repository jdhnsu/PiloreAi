import { createHash } from "node:crypto";
import { Type, type Message, type UserMessage } from "@earendil-works/pi-ai";
import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import type { CoreState } from "../state/index.js";
import type { JsonValue, ProfileDefinition, RouterConfig } from "../types.js";

export interface ProfileContextMessage {
	role: "piloreProfileContext";
	profileKey: string | null;
	profileName: string | null;
	profileHash: string | null;
	methodology: string | null;
	state?: JsonValue;
	timestamp: number;
}

declare module "@earendil-works/pi-agent-core" { interface CustomAgentMessages { piloreProfileContext: ProfileContextMessage } }

export function hashProfile(profile: ProfileDefinition): string {
	return createHash("sha256").update(JSON.stringify({ key: profile.key, name: profile.name, methodology: profile.methodology })).digest("hex");
}
export function createProfileContext(profile: ProfileDefinition | undefined, state: JsonValue | undefined, timestamp = Date.now()): ProfileContextMessage {
	return profile ? { role: "piloreProfileContext", profileKey: profile.key, profileName: profile.name, profileHash: hashProfile(profile), methodology: profile.methodology, ...(state === undefined ? {} : { state }), timestamp } : { role: "piloreProfileContext", profileKey: null, profileName: null, profileHash: null, methodology: null, timestamp };
}
export function isProfileContext(message: { role: string }): message is ProfileContextMessage { return message.role === "piloreProfileContext"; }
export function appendProfileContext(messages: AgentMessage[], context: ProfileContextMessage): AgentMessage[] {
	const next = messages.slice();
	if (next.length && isProfileContext(next[next.length - 1])) next[next.length - 1] = context;
	else next.push(context);
	return next;
}
export function convertProfileMessages(messages: AgentMessage[], config?: RouterConfig): Message[] {
	const out: Message[] = [];
	for (let index = 0; index < messages.length; index += 1) {
		const message = messages[index];
		if (isProfileContext(message)) {
			const user = messages[index + 1];
			if (user?.role === "user") {
				const rendered = config?.renderContext?.(message) ?? `<pilore_profile_context>\n${message.profileKey ? `Active profile: ${message.profileName}\n\n${message.methodology}` : "Automatic profile routing is active."}\n</pilore_profile_context>`;
				out.push({ role: "user", timestamp: user.timestamp, content: typeof user.content === "string" ? `${rendered}\n\n<user_message>\n${user.content}\n</user_message>` : [{ type: "text", text: rendered }, ...user.content] } as UserMessage);
				index += 1;
			}
			continue;
		}
		if (message.role === "user" || message.role === "assistant" || message.role === "toolResult") out.push(message);
	}
	return out;
}
export function createRouterTool(state: CoreState, config: RouterConfig): AgentTool<any> {
	const params = Type.Object({ profile: Type.Union([...config.profiles.map((p) => Type.Literal(p.key)), Type.Literal("auto")]) });
	return {
		name: "adopt_profile", label: "切换 Profile", description: "激活最适合当前问题的 profile；auto 表示交还自动路由。不要重复激活相同 profile。", parameters: params,
		execute: async (_id, rawInput) => {
			const input = rawInput as { profile: string };
			if (input.profile === "auto") { state.setProfile(undefined, "model"); state.switchCount = 0; return { content: [{ type: "text", text: config.renderContext?.(createProfileContext(undefined, undefined)) ?? "已切回自动路由" }], details: { profile: "auto" } }; }
			const profile = config.profiles.find((p) => p.key === input.profile);
			if (!profile) throw new Error(`未知 profile: ${input.profile}`);
			if (state.activeProfile?.key === profile.key) throw new Error(`已经激活 profile: ${profile.key}`);
			const limit = config.maxSwitchesPerTurn ?? 2;
			if (state.switchCount >= limit) throw new Error(`本轮 profile 切换已达上限 ${limit}`);
			state.switchCount += 1; state.setProfile(profile, "model");
			const context = createProfileContext(profile, config.getProfileState?.(profile.key));
			return { content: [{ type: "text", text: config.renderContext?.(context) ?? String(profile.methodology) }], details: { profile: profile.key, profileHash: context.profileHash } };
		},
	};
}
export function createUpdateProfileStateTool(state: CoreState, config: RouterConfig): AgentTool<any> | undefined {
	if (!config.updateProfileState) return undefined;
	const parameters = Type.Object({ patch: Type.Record(Type.String(), Type.Any()) });
	return { name: "update_profile_state", label: "更新 Profile 状态", description: "记录当前 Profile 的领域进度；仅提交发生变化的字段。", parameters, execute: async (_id, raw) => { if (!state.activeProfile) throw new Error("当前未激活 profile"); const patch = (raw as { patch: Record<string, JsonValue> }).patch; const value = config.updateProfileState!(state.activeProfile.key, patch); return { content: [{ type: "text", text: `已更新 ${state.activeProfile.name} 的状态` }], details: { profile: state.activeProfile.key, state: value } }; } };
}
