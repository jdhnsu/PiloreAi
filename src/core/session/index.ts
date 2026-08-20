import type { AgentMessage } from "@pilore/pi-agent-core";
import { appendProfileContext, convertProfileMessages, createProfileContext } from "../router/index.js";
import { createRuntime, type Runtime } from "../runtime/index.js";
import { cloneCoreSnapshot, validateCoreSnapshot } from "../snapshot/index.js";
import { INTERNAL_TOOL_NAMES } from "../tool-runtime/index.js";
import { compactContext, ContextPolicyError, inspectContext, type ContextCompactionResult, type ContextStatus } from "../context-policy/index.js";
import { createTrajectoryRecorder, type TrajectoryRecorder } from "../trajectory/recorder.js";
import type { TrajectoryRunDraft } from "../trajectory/types.js";
import type { ProfileDefinition, RuntimeConfig, SessionEvent, SessionEventJsonValue, SessionSnapshotV1 } from "../types.js";

export interface SessionConfig extends RuntimeConfig {
	snapshot?: unknown;
}

export interface Session {
	prompt(text: string, onEvent: (event: SessionEvent) => void): Promise<void>;
	inspectContext(text: string): ContextStatus;
	compactContext(): Promise<ContextCompactionResult>;
	abort(): void;
	setProfile(key: string | null): void;
	/** revision 由外部持久化层拥有；导出时必须提供其当前乐观锁版本。 */
	exportSnapshot(revision: number): SessionSnapshotV1;
	readonly busy: boolean;
	readonly profile: string | null;
	readonly runtime: Runtime;
	/** 最近一次 `prompt()` 的轨迹记录；尚未运行过时为 null。 */
	readonly lastRun: TrajectoryRunDraft | null;
}

function toolResultText(result: { content?: Array<{ type: string; text?: string }> } | undefined): string {
	return (result?.content ?? [])
		.filter((block) => block.type === "text")
		.map((block) => block.text ?? "")
		.join("\n")
		.slice(0, 8000);
}

function toolResultDetails(result: { details?: unknown } | undefined): SessionEventJsonValue | undefined {
	if (result?.details === undefined) return undefined;
	try {
		const serialized = JSON.stringify(result.details);
		if (!serialized || serialized.length > 256_000) return undefined;
		return JSON.parse(serialized) as SessionEventJsonValue;
	} catch {
		return undefined;
	}
}

export function createSession(config: SessionConfig): Session {
	const runtime = createRuntime(config);
	const { agent, state } = runtime;
	const recorder: TrajectoryRecorder = createTrajectoryRecorder({ agent, state });
	const router = config.domain?.router;
	const profiles = router?.profiles ?? [];
	const manifest = config.domain?.toolManifest;
	const extension = config.domain?.snapshotExtension;
	const restored = config.snapshot
		? validateCoreSnapshot(config.snapshot, {
				profileKeys: profiles.map((profile) => profile.key),
				toolsetKeys: manifest?.groups.map((group) => group.key),
				extensions: extension ? [extension] : [],
			})
		: undefined;

	if (extension) state.registerExtension(extension.key, extension.export());
	if (restored) {
		const extensionValue = extension ? restored.extensions[extension.key] : undefined;
		if (extension && extensionValue !== undefined) {
			extension.restore(extensionValue);
			state.setExtension(extension.key, extension.export());
		}
		for (const key of restored.activeToolsetKeys) state.activateToolset(key);
		runtime.refreshTools();
		state.activeProfile = restored.activeProfileKey
			? profiles.find((profile) => profile.key === restored.activeProfileKey)
			: undefined;
		agent.state.messages = restored.messages as AgentMessage[];
	}

	let busy = false;
	let emit: ((event: SessionEvent) => void) | undefined;
	let lastRunDraft: TrajectoryRunDraft | null = null;

	state.onProfileChange((profile, source) => {
		emit?.({ type: "profile", profile: profile?.key ?? null, name: profile?.name ?? null, source });
	});
	state.onToolsetChange((toolset, active) => emit?.({ type: "toolset", toolset, active }));
	agent.subscribe((event) => {
		if (!emit) return;
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			emit({ type: "text_delta", delta: event.assistantMessageEvent.delta });
		} else if (event.type === "message_end") {
			emit({ type: "message_end" });
		} else if (event.type === "tool_execution_start" && !INTERNAL_TOOL_NAMES.has(event.toolName)) {
			emit({ type: "tool_start", toolName: event.toolName, args: event.args });
		} else if (event.type === "tool_execution_end" && !INTERNAL_TOOL_NAMES.has(event.toolName)) {
			const details = toolResultDetails(event.result);
			emit({ type: "tool_end", toolName: event.toolName, isError: event.isError, text: toolResultText(event.result), ...(details === undefined ? {} : { details }) });
		}
	});

	const selectProfile = (profile: ProfileDefinition | undefined, source: "user" | "model"): void => {
		state.setProfile(profile, source);
		agent.state.messages = appendProfileContext(
			agent.state.messages,
			createProfileContext(profile, profile ? router?.getProfileState?.(profile.key) : undefined),
		);
	};
	const contextFor = (messages: AgentMessage[]) => ({
		systemPrompt: agent.state.systemPrompt,
		messages: convertProfileMessages(messages, router, { activeProfile: state.activeProfile, getProfileState: router?.getProfileState }),
		tools: agent.state.tools,
	});
	const inspect = (text: string): ContextStatus => inspectContext(
		contextFor([...agent.state.messages, { role: "user", content: text, timestamp: Date.now() }]),
		runtime.contextPolicy,
		text,
	);

	return {
		get busy() { return busy; },
		get profile() { return state.activeProfile?.key ?? null; },
		get lastRun() { return lastRunDraft; },
		runtime,
		inspectContext: inspect,
		async compactContext() {
			if (busy) throw new Error("对话进行中不能压缩上下文");
			if (!runtime.contextPolicy.enabled) throw new ContextPolicyError("COMPACTION_NOT_NEEDED", "当前会话未启用上下文压缩策略");
			busy = true;
			try {
				const compacted = await compactContext({
					messages: agent.state.messages,
					convertToLlm: (messages) => convertProfileMessages(messages, router, { activeProfile: state.activeProfile, getProfileState: router?.getProfileState }),
					models: config.models,
					model: config.model,
					policy: runtime.contextPolicy,
					thinkingLevel: config.thinkingLevel,
					contextFor,
				});
				agent.state.messages = compacted.messages;
				return compacted.result;
			} finally {
				busy = false;
			}
		},
		abort: () => agent.abort(),
		setProfile(key) {
			if (busy) throw new Error("对话进行中不能切换 profile");
			const profile = key ? profiles.find((item) => item.key === key) : undefined;
			if (key && !profile) throw new Error(`未知 profile: ${key}`);
			selectProfile(profile, "user");
		},
		exportSnapshot: (revision) => {
			if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("snapshot revision 必须是非负安全整数");
			return cloneCoreSnapshot({
			version: 1,
			revision,
			activeProfileKey: state.activeProfile?.key ?? null,
			activeToolsetKeys: [...state.activeToolsets],
			messages: agent.state.messages,
			extensions: extension ? { [extension.key]: extension.export() } : {},
			});
		},
		async prompt(text, onEvent) {
			if (busy) throw new Error("上一轮对话还在进行");
			const contextStatus = inspect(text);
			if (contextStatus.status === "input_too_large") throw new ContextPolicyError("INPUT_TOO_LARGE", `本条输入约 ${contextStatus.inputTokens} tokens，超过单条安全上限 ${contextStatus.maxInputTokens} tokens；请拆分后重试。`);
			if (contextStatus.status === "requires_compaction") throw new ContextPolicyError("CONTEXT_COMPACTION_REQUIRED", "对话上下文接近模型上限。请先压缩早期记录，或新建会话后继续。");
			busy = true;
			emit = onEvent;
			state.resetUserTurn();
			recorder.begin(text);
			let message = text;
			let runError: string | undefined;
			try {
				const mention = router?.parseMention?.(text);
				if (mention) {
					selectProfile(mention.profile ?? undefined, "user");
					message = mention.rest;
				}
				onEvent({ type: "start" });
				await agent.prompt(message);
				runError = agent.state.errorMessage;
				if (runError) onEvent({ type: "error", message: runError });
				onEvent({ type: "done", ...(runError ? { errorMessage: runError } : {}) });
			} catch (error) {
				runError = error instanceof Error ? error.message : String(error);
				onEvent({ type: "error", message: runError });
				onEvent({ type: "done", errorMessage: runError });
				throw error;
			} finally {
				busy = false;
				emit = undefined;
				lastRunDraft = recorder.finish(runError);
			}
		},
	};
}
