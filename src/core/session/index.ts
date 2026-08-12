import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { appendProfileContext, createProfileContext } from "../router/index.js";
import { createRuntime, type Runtime } from "../runtime/index.js";
import { cloneCoreSnapshot, validateCoreSnapshot } from "../snapshot/index.js";
import { INTERNAL_TOOL_NAMES } from "../tool-runtime/index.js";
import type { ProfileDefinition, RuntimeConfig, SessionEvent, SessionSnapshotV1 } from "../types.js";

export interface SessionConfig extends RuntimeConfig {
	snapshot?: unknown;
}

export interface Session {
	prompt(text: string, onEvent: (event: SessionEvent) => void): Promise<void>;
	abort(): void;
	setProfile(key: string | null): void;
	exportSnapshot(): SessionSnapshotV1;
	readonly busy: boolean;
	readonly profile: string | null;
	readonly runtime: Runtime;
}

function toolResultText(result: { content?: Array<{ type: string; text?: string }> } | undefined): string {
	return (result?.content ?? [])
		.filter((block) => block.type === "text")
		.map((block) => block.text ?? "")
		.join("\n")
		.slice(0, 8000);
}

export function createSession(config: SessionConfig): Session {
	const runtime = createRuntime(config);
	const { agent, state } = runtime;
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
			emit({ type: "tool_end", toolName: event.toolName, isError: event.isError, text: toolResultText(event.result) });
		}
	});

	const selectProfile = (profile: ProfileDefinition | undefined, source: "user" | "model"): void => {
		state.setProfile(profile, source);
		agent.state.messages = appendProfileContext(
			agent.state.messages,
			createProfileContext(profile, profile ? router?.getProfileState?.(profile.key) : undefined),
		);
	};

	return {
		get busy() { return busy; },
		get profile() { return state.activeProfile?.key ?? null; },
		runtime,
		abort: () => agent.abort(),
		setProfile(key) {
			if (busy) throw new Error("对话进行中不能切换 profile");
			const profile = key ? profiles.find((item) => item.key === key) : undefined;
			if (key && !profile) throw new Error(`未知 profile: ${key}`);
			selectProfile(profile, "user");
		},
		exportSnapshot: () => cloneCoreSnapshot({
			version: 1,
			revision: restored?.revision ?? 0,
			activeProfileKey: state.activeProfile?.key ?? null,
			activeToolsetKeys: [...state.activeToolsets],
			messages: agent.state.messages,
			extensions: extension ? { [extension.key]: extension.export() } : {},
		}),
		async prompt(text, onEvent) {
			if (busy) throw new Error("上一轮对话还在进行");
			busy = true;
			emit = onEvent;
			state.resetUserTurn();
			let message = text;
			try {
				const mention = router?.parseMention?.(text);
				if (mention) {
					selectProfile(mention.profile ?? undefined, "user");
					message = mention.rest;
				}
				onEvent({ type: "start" });
				await agent.prompt(message);
				const errorMessage = agent.state.errorMessage;
				if (errorMessage) onEvent({ type: "error", message: errorMessage });
				onEvent({ type: "done", ...(errorMessage ? { errorMessage } : {}) });
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				onEvent({ type: "error", message: errorMessage });
				onEvent({ type: "done", errorMessage });
			} finally {
				busy = false;
				emit = undefined;
			}
		},
	};
}
