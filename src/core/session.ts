import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { cloneCoreSnapshot, CORE_SESSION_SNAPSHOT_VERSION, validateCoreSnapshot } from "./snapshot.js";
import { createRuntime, type Runtime } from "./runtime.js";
import type { RuntimeConfig, SessionEvent, SessionSnapshotV1 } from "./types.js";

export interface SessionConfig extends RuntimeConfig { snapshot?: unknown }
export interface Session {
	prompt(text: string, onEvent: (event: SessionEvent) => void): Promise<void>;
	abort(): void;
	setProfile(key: string | null): void;
	exportSnapshot(): SessionSnapshotV1;
	readonly busy: boolean;
	readonly profile: string | null;
	readonly runtime: Runtime;
}

/** Transport-neutral Core session; it has no education or code-specific state. */
export function createSession(config: SessionConfig): Session {
	const runtime = createRuntime(config);
	const { agent, state } = runtime;
	const profiles = config.domain?.profiles ?? [];
	const restored = config.snapshot ? validateCoreSnapshot(config.snapshot) : undefined;
	if (restored) {
		agent.state.messages = restored.messages as AgentMessage[];
		const profile = restored.activeProfileKey ? profiles.find((item) => item.key === restored.activeProfileKey) : undefined;
		if (restored.activeProfileKey && !profile) throw new Error(`snapshot 引用了未知 profile: ${restored.activeProfileKey}`);
		state.activeProfile = profile;
		if (config.domain?.validateExtension && restored.extensions[config.domain.id] !== undefined) config.domain.validateExtension(restored.extensions[config.domain.id]);
	}
	let busy = false;
	let emit: ((event: SessionEvent) => void) | undefined;
	state.onProfileChange((profile, source) => emit?.({ type: "profile", profile: profile?.key ?? null, name: profile?.name ?? null, source }));
	agent.subscribe((event) => {
		if (!emit) return;
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") emit({ type: "text_delta", delta: event.assistantMessageEvent.delta });
		else if (event.type === "message_end") emit({ type: "message_end" });
		else if (event.type === "tool_execution_start") emit({ type: "tool_start", toolName: event.toolName, args: event.args });
		else if (event.type === "tool_execution_end") emit({ type: "tool_end", toolName: event.toolName, isError: event.isError, text: (event.result?.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n") });
	});
	return {
		get busy() { return busy; }, get profile() { return state.activeProfile?.key ?? null; }, runtime,
		abort: () => agent.abort(),
		setProfile: (key) => { if (busy) throw new Error("对话进行中不能切换 profile"); const profile = key ? profiles.find((item) => item.key === key) : undefined; if (key && !profile) throw new Error(`未知 profile: ${key}`); state.setProfile(profile, "user"); },
		exportSnapshot: () => cloneCoreSnapshot({ version: CORE_SESSION_SNAPSHOT_VERSION, revision: restored?.revision ?? 0, activeProfileKey: state.activeProfile?.key ?? null, messages: agent.state.messages, extensions: config.domain?.createExtension ? { [config.domain.id]: config.domain.createExtension() } : {} }),
		async prompt(text, onEvent) { if (busy) throw new Error("上一轮对话还在进行"); busy = true; emit = onEvent; try { onEvent({ type: "start" }); await agent.prompt(text); const errorMessage = agent.state.errorMessage; if (errorMessage) onEvent({ type: "error", message: errorMessage }); onEvent({ type: "done", errorMessage }); } catch (error) { const message = error instanceof Error ? error.message : String(error); onEvent({ type: "error", message }); onEvent({ type: "done", errorMessage: message }); } finally { busy = false; emit = undefined; } },
	};
}
