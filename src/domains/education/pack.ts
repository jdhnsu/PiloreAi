import { buildBasePrompt } from "../../agent.js";
import type { DomainPack, Profile, ToolPack } from "../../core/types.js";
import type { Persona } from "../../personas.js";
import type { ToolDeps } from "../../tools.js";
import { createTools } from "../../tools.js";
import { SharedState } from "../../shared-state.js";
import type { VirtualFS } from "../../vfs.js";
import type { EducationDomainPack } from "./types.js";

/** Adapts the established education model to the generic DomainPack contract. */
export function createEducationDomainPack(personas: Persona[], options?: { toolPack?: ToolPack }): EducationDomainPack {
	const profiles: Profile[] = personas.map((persona) => ({ key: persona.key, name: persona.name, description: persona.meta.description, methodology: persona.prompt, capabilities: persona.meta.capabilities }));
	return { id: "education", personas, profiles, basePrompt: buildBasePrompt(personas), tools: options?.toolPack?.tools };
}

/** Compatibility composition: exposes existing education tools as a reusable ToolPack. */
export function createEducationToolPack(vfs: VirtualFS, shared: SharedState, deps: ToolDeps): ToolPack {
	return { id: "education", tools: createTools(vfs, shared, deps) };
}
