import { createHash } from "node:crypto";
import { Type, type Message, type UserMessage } from "@pilore/pi-ai";
import type { AgentMessage, AgentTool } from "@pilore/pi-agent-core";
import type { CoreState } from "../state/index.js";
import { isContextSummary } from "../context-policy/index.js";
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

declare module "@pilore/pi-agent-core" { interface CustomAgentMessages { piloreProfileContext: ProfileContextMessage } }

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
export interface ProfileContextProvider {
	/** 转换时的权威 Profile；未定义表示自动路由。 */
	activeProfile: ProfileDefinition | undefined;
	getProfileState?(key: string): JsonValue | undefined;
}

function mergeContextIntoUser(config: RouterConfig | undefined, context: ProfileContextMessage, user: UserMessage): UserMessage {
	const rendered = config?.renderContext?.(context) ?? `<pilore_profile_context>\n${context.profileKey ? `Active profile: ${context.profileName}\n\n${context.methodology}` : "Automatic profile routing is active."}\n</pilore_profile_context>`;
	return { role: "user", timestamp: user.timestamp, content: typeof user.content === "string" ? `${rendered}\n\n<user_message>\n${user.content}\n</user_message>` : [{ type: "text", text: rendered }, ...user.content] } as UserMessage;
}

export function convertProfileMessages(messages: AgentMessage[], config?: RouterConfig, provider?: ProfileContextProvider): Message[] {
	const out: Message[] = [];
	let pending: ProfileContextMessage | undefined;
	// 预扫描：最后一个内部 context 的位置，以及历史中是否仍存在与当前权威 profile 匹配的 context。
	let lastContextIndex = -1;
	let hasMatchingContext = false;
	if (provider) {
		for (let index = 0; index < messages.length; index += 1) {
			const message = messages[index];
			if (!isProfileContext(message)) continue;
			lastContextIndex = index;
			if (message.profileKey === (provider.activeProfile?.key ?? null)) hasMatchingContext = true;
		}
	}
	for (let index = 0; index < messages.length; index += 1) {
		const message = messages[index];
		if (isContextSummary(message)) {
			out.push({ role: "user", timestamp: message.timestamp, content: `<pilore_context_checkpoint>\n以下为较早会话的压缩检查点；以此保持教学连续性。\n\n${message.summary}\n</pilore_context_checkpoint>` });
			continue;
		}
		if (isProfileContext(message)) {
			if (!provider) {
				// 无权威 provider 的旧行为：仅合并紧邻的下一条 user 消息。
				const user = messages[index + 1];
				if (user?.role === "user") {
					out.push(mergeContextIntoUser(config, message, user as UserMessage));
					index += 1;
				}
				continue;
			}
			if (message.profileKey === (provider.activeProfile?.key ?? null)) pending = message;
			// 与当前权威 profile 不匹配的孤儿 context（模型已切走）直接丢弃。
			continue;
		}
		if (message.role === "user" || message.role === "assistant" || message.role === "toolResult") {
			if (message.role === "user") {
				let context = pending;
				if (!context && provider?.activeProfile && !hasMatchingContext && index > lastContextIndex) {
					// 权威保底：历史中的 context 已被压缩/修剪移除，按当前权威 profile 合成注入。
					context = createProfileContext(provider.activeProfile, provider.getProfileState?.(provider.activeProfile.key));
				}
				if (context) {
					// 合并时以权威 provider 的最新进度刷新 context 携带的状态。
					const freshState = context.profileKey ? provider?.getProfileState?.(context.profileKey) : undefined;
					out.push(mergeContextIntoUser(config, freshState === undefined ? context : { ...context, state: freshState }, message as UserMessage));
					pending = undefined;
					continue;
				}
			}
			out.push(message);
		}
	}
	return out;
}
export function createRouterTool(state: CoreState, config: RouterConfig, options?: { appendContext?(context: ProfileContextMessage): void }): AgentTool<any> {
	const params = Type.Object({ profile: Type.Union([...config.profiles.map((p) => Type.Literal(p.key)), Type.Literal("auto")]) });
	return {
		name: "adopt_profile", label: "切换 Profile", description: "激活最适合当前问题的 profile；auto 表示交还自动路由。不要重复激活相同 profile。", parameters: params,
		execute: async (_id, rawInput) => {
			const input = rawInput as { profile: string };
			if (input.profile === "auto") {
				state.setProfile(undefined, "model"); state.switchCount = 0;
				const context = createProfileContext(undefined, undefined);
				options?.appendContext?.(context);
				return { content: [{ type: "text", text: config.renderContext?.(context) ?? "已切回自动路由" }], details: { profile: "auto" } };
			}
			const profile = config.profiles.find((p) => p.key === input.profile);
			if (!profile) throw new Error(`未知 profile: ${input.profile}`);
			if (state.activeProfile?.key === profile.key) throw new Error(`已经激活 profile: ${profile.key}`);
			const limit = config.maxSwitchesPerTurn ?? 2;
			if (state.switchCount >= limit) throw new Error(`本轮 profile 切换已达上限 ${limit}`);
			state.switchCount += 1; state.setProfile(profile, "model");
			const context = createProfileContext(profile, config.getProfileState?.(profile.key));
			options?.appendContext?.(context);
			return { content: [{ type: "text", text: config.renderContext?.(context) ?? String(profile.methodology) }], details: { profile: profile.key, profileHash: context.profileHash } };
		},
	};
}
export function createUpdateProfileStateTool(state: CoreState, config: RouterConfig): AgentTool<any> | undefined {
	if (!config.updateProfileState) return undefined;
	if (!config.validateProfileStatePatch) throw new Error("配置 updateProfileState 时必须同时配置 validateProfileStatePatch");
	const parameters = Type.Object({ patch: Type.Record(Type.String(), Type.Any()) });
	return { name: "update_profile_state", label: "更新 Profile 状态", description: "记录当前 Profile 的领域进度；仅提交发生变化的字段。", parameters, execute: async (_id, raw) => { if (!state.activeProfile) throw new Error("当前未激活 profile"); const patch = config.validateProfileStatePatch!(state.activeProfile.key, (raw as { patch: unknown }).patch); const value = config.updateProfileState!(state.activeProfile.key, patch); return { content: [{ type: "text", text: `已更新 ${state.activeProfile.name} 的状态` }], details: { profile: state.activeProfile.key, state: value } }; } };
}
