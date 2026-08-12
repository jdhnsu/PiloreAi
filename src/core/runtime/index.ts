import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { createObservedStreamFn } from "../../infrastructure/telemetry/index.js";
import { convertProfileMessages, createRouterTool, createUpdateProfileStateTool } from "../router/index.js";
import { CoreState } from "../state/index.js";
import {
	createActivateToolsetTool,
	deniedCapability,
	toolsForState,
	validateToolManifest,
} from "../tool-runtime/index.js";
import type { RuntimeConfig } from "../types.js";

export interface Runtime {
	agent: Agent;
	state: CoreState;
	runtimeConfig: RuntimeConfig;
	refreshTools(): void;
}

export function createRuntime(config: RuntimeConfig): Runtime {
	const state = new CoreState();
	const manifest = config.domain?.toolManifest;
	const injectedTools = config.tools ?? [];
	const internalTools: AgentTool<any>[] = [];
	let turns = 0;
	let agent: Agent | undefined;

	if (manifest) validateToolManifest(manifest);

	const currentTools = (): AgentTool<any>[] => [
		...injectedTools,
		...toolsForState(manifest, state, internalTools),
	];
	const refreshTools = (): void => {
		if (agent) agent.state.tools = currentTools();
	};

	if (config.domain?.router) {
		internalTools.push(createRouterTool(state, config.domain.router));
		const updateState = createUpdateProfileStateTool(state, config.domain.router);
		if (updateState) internalTools.push(updateState);
	}
	if (manifest) internalTools.push(createActivateToolsetTool(state, manifest, refreshTools));

	agent = new Agent({
		initialState: {
			systemPrompt: config.systemPrompt ?? config.domain?.basePrompt ?? "You are a helpful assistant.",
			model: config.model,
			thinkingLevel: config.thinkingLevel ?? "off",
			tools: currentTools(),
		},
		streamFn: createObservedStreamFn({
			models: config.models,
			fetch: config.fetch,
			telemetry: config.llmTelemetry,
			getProfileKey: () => state.activeProfile?.key ?? null,
		}),
		convertToLlm: (messages) => convertProfileMessages(messages, config.domain?.router),
		prepareNextTurnWithContext: (context) => ({
			context: { ...context.context, tools: currentTools() },
		}),
		shouldStopAfterTurn: async () => Boolean(config.maxTurns && ++turns >= config.maxTurns),
		beforeToolCall: async (context) => {
			const denied = deniedCapability(manifest, state.activeProfile, context.toolCall.name, context.args);
			return denied ? { block: true, reason: `当前 profile 不允许能力 ${denied}` } : undefined;
		},
	});

	agent.subscribe((event) => {
		if (event.type === "agent_start") turns = 0;
	});

	return { agent, state, runtimeConfig: config, refreshTools };
}
