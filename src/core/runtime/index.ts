import { Agent } from "@earendil-works/pi-agent-core";
import { createObservedStreamFn } from "../../telemetry.js";
import { CoreState } from "../state/index.js";
import { convertProfileMessages, createRouterTool, createUpdateProfileStateTool } from "../router/index.js";
import { createActivateToolsetTool, deniedCapability, toolsForState, validateToolManifest } from "../tool-runtime/index.js";
import type { RuntimeConfig } from "../types.js";

export interface Runtime { agent: Agent; state: CoreState; runtimeConfig: RuntimeConfig; refreshTools(): void }
export function createRuntime(config: RuntimeConfig): Runtime {
	const state = new CoreState(); let turns = 0; let agent: Agent;
	const manifest = config.domain?.toolManifest; if (manifest) validateToolManifest(manifest);
	const internal = [] as ReturnType<typeof toolsForState>;
	const refreshTools = () => { if (agent) agent.state.tools = toolsForState(manifest, state, internal); };
	if (config.domain?.router) { internal.push(createRouterTool(state, config.domain.router)); const updateState = createUpdateProfileStateTool(state, config.domain.router); if (updateState) internal.push(updateState); }
	if (manifest) internal.push(createActivateToolsetTool(state, manifest, refreshTools));
	agent = new Agent({
		initialState: { systemPrompt: config.systemPrompt ?? config.domain?.basePrompt ?? "You are a helpful assistant.", model: config.model, thinkingLevel: config.thinkingLevel ?? "off", tools: [...(config.tools ?? []), ...toolsForState(manifest, state, internal)] },
		streamFn: createObservedStreamFn({ models: config.models, fetch: config.fetch, telemetry: config.llmTelemetry, getPersonaKey: () => state.activeProfile?.key ?? null }),
		convertToLlm: (messages) => convertProfileMessages(messages, config.domain?.router),
		prepareNextTurnWithContext: (context) => ({ context: { ...context.context, tools: [...(config.tools ?? []), ...toolsForState(manifest, state, internal)] } }),
		shouldStopAfterTurn: async () => !config.maxTurns ? false : ++turns >= config.maxTurns,
		beforeToolCall: async (ctx) => { const denied = deniedCapability(manifest, state.activeProfile, ctx.toolCall.name, ctx.args); return denied ? { block: true, reason: `当前 profile 不允许能力 ${denied}` } : undefined; },
	});
	agent.subscribe((event) => { if (event.type === "agent_start") turns = 0; });
	return { agent, state, runtimeConfig: config, refreshTools };
}
