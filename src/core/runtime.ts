import { Agent } from "@earendil-works/pi-agent-core";
import { createObservedStreamFn } from "../telemetry.js";
import { CoreState } from "./state.js";
import type { RuntimeConfig } from "./types.js";

export interface Runtime {
	agent: Agent;
	state: CoreState;
	runtimeConfig: RuntimeConfig;
}

/** Builds the domain-neutral agent loop. Domain semantics enter only through an injected pack. */
export function createRuntime(config: RuntimeConfig): Runtime {
	const state = new CoreState();
	let turns = 0;
	const agent = new Agent({
		initialState: {
			systemPrompt: config.systemPrompt ?? [config.domain?.basePrompt, config.domain?.profiles?.length ? `## Profiles\n${config.domain.profiles.map((p) => `- ${p.name}: ${p.description}`).join("\n")}` : ""].filter(Boolean).join("\n\n"),
			model: config.model,
			thinkingLevel: config.thinkingLevel ?? "off",
			tools: [...(config.tools ?? []), ...(config.domain?.tools ?? [])],
		},
		streamFn: createObservedStreamFn({ models: config.models, getPersonaKey: () => state.activeProfile?.key ?? null }),
		shouldStopAfterTurn: async () => !config.maxTurns ? false : ++turns >= config.maxTurns,
	});
	agent.subscribe((event) => { if (event.type === "agent_start") turns = 0; });
	return { agent, state, runtimeConfig: config };
}
