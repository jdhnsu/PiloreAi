import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { CoreState } from "../state/index.js";
import type { ProfileDefinition, ToolManifest } from "../types.js";

export const INTERNAL_TOOL_NAMES = new Set(["adopt_profile", "update_profile_state", "activate_toolset"]);

export function validateToolManifest(manifest: ToolManifest): void {
	const names = new Set<string>();
	const groups = new Set<string>();
	for (const group of manifest.groups) {
		if (groups.has(group.key)) throw new Error(`重复 toolset: ${group.key}`);
		groups.add(group.key);
		for (const tool of group.load()) {
			if (names.has(tool.name)) throw new Error(`重复工具名: ${tool.name}`);
			names.add(tool.name);
		}
	}
}
export function toolsForState(manifest: ToolManifest | undefined, state: CoreState, internal: AgentTool<any>[]): AgentTool<any>[] {
	if (!manifest) return internal;
	return [...internal, ...manifest.groups.filter((g) => g.eager || state.activeToolsets.has(g.key)).flatMap((g) => g.load())];
}
export function createActivateToolsetTool(state: CoreState, manifest: ToolManifest, refresh: () => void): AgentTool<any> {
	const params = Type.Object({ toolset: Type.Union(manifest.groups.map((g) => Type.Literal(g.key))) });
	return { name: "activate_toolset", label: "加载工具组", description: `按需加载工具组，加载后才能使用组内工具：${manifest.groups.map((g) => `${g.key}(${g.description})`).join("；")}`, parameters: params,
		execute: async (_id, rawInput) => {
			const input = rawInput as { toolset: string };
			if (!manifest.groups.some((g) => g.key === input.toolset)) throw new Error(`未知 toolset: ${input.toolset}`);
			const changed = state.activateToolset(input.toolset); refresh();
			return { content: [{ type: "text", text: changed ? `已激活工具组 ${input.toolset}` : `工具组 ${input.toolset} 已经激活` }], details: { toolset: input.toolset, changed } };
		} };
}
export function deniedCapability(manifest: ToolManifest | undefined, profile: ProfileDefinition | undefined, toolName: string, args: unknown): string | undefined {
	if (!manifest || !profile) return undefined;
	const capability = manifest.resolveCapability(toolName, args);
	return capability && profile.capabilities?.[capability] === "deny" ? capability : undefined;
}
