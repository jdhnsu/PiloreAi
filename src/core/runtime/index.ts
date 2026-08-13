import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { createObservedStreamFn } from "../../infrastructure/telemetry/index.js";
import { appendProfileContext, convertProfileMessages, createRouterTool, createUpdateProfileStateTool, type ProfileContextMessage } from "../router/index.js";
import { CoreState } from "../state/index.js";
import { estimateContextTokens, pruneContextForRequest, resolveContextPolicy, type ResolvedContextPolicy } from "../context-policy/index.js";
import {
	createActivateToolsetTool,
	compileToolRegistry,
	deniedCapability,
	validateProfileCapabilities,
	type ToolRegistry,
} from "../tool-runtime/index.js";
import type { RuntimeConfig } from "../types.js";

export interface Runtime {
	agent: Agent;
	state: CoreState;
	runtimeConfig: RuntimeConfig;
	contextPolicy: ResolvedContextPolicy;
	toolRegistry?: ToolRegistry;
	refreshTools(): void;
}

export function createRuntime(config: RuntimeConfig): Runtime {
	const state = new CoreState();
	const manifest = config.domain?.toolManifest;
	const injectedTools = config.tools ?? [];
	const internalTools: AgentTool<any>[] = [];
	let turns = 0;
	let agent: Agent | undefined;
	const contextPolicy = resolveContextPolicy(config.model, config.contextPolicy);

	const toolRegistry = manifest ? compileToolRegistry(manifest) : undefined;
	validateProfileCapabilities(config.domain?.router?.profiles ?? [], toolRegistry);

	const currentTools = (): AgentTool<any>[] => [
		...injectedTools,
		...(toolRegistry?.toolsForState(state, internalTools) ?? internalTools),
	];
	const refreshTools = (): void => {
		if (agent) agent.state.tools = currentTools();
	};

	if (config.domain?.router) {
		const appendContext = (context: ProfileContextMessage): void => {
			if (agent) agent.state.messages = appendProfileContext(agent.state.messages, context);
		};
		internalTools.push(createRouterTool(state, config.domain.router, { appendContext }));
		const updateState = createUpdateProfileStateTool(state, config.domain.router);
		if (updateState) internalTools.push(updateState);
	}
	if (toolRegistry) internalTools.push(createActivateToolsetTool(state, toolRegistry, refreshTools));

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
		convertToLlm: (messages) => convertProfileMessages(messages, config.domain?.router, { activeProfile: state.activeProfile, getProfileState: config.domain?.router?.getProfileState }),
		transformContext: async (messages) => pruneContextForRequest(messages, (candidate) => {
			const context = { systemPrompt: config.systemPrompt ?? config.domain?.basePrompt ?? "You are a helpful assistant.", messages: convertProfileMessages(candidate, config.domain?.router, { activeProfile: state.activeProfile, getProfileState: config.domain?.router?.getProfileState }), tools: currentTools() };
			return estimateContextTokens(context) <= contextPolicy.contextWindow - contextPolicy.reserveTokens;
		}),
		prepareNextTurnWithContext: (context) => ({
			context: { ...context.context, tools: currentTools() },
		}),
		shouldStopAfterTurn: async () => Boolean(config.maxTurns && ++turns >= config.maxTurns),
		beforeToolCall: async (context) => {
			const denied = deniedCapability(toolRegistry, state.activeProfile, context.toolCall.name, context.args);
			return denied ? { block: true, reason: `当前 profile 不允许能力 ${denied}` } : undefined;
		},
	});

	agent.subscribe((event) => {
		if (event.type === "agent_start") turns = 0;
	});

	return { agent, state, runtimeConfig: config, contextPolicy, toolRegistry, refreshTools };
}
