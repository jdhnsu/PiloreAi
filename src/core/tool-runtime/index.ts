import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { CoreState } from "../state/index.js";
import type { ProfileDefinition, ToolManifest } from "../types.js";

export const INTERNAL_TOOL_NAMES = new Set(["adopt_profile", "update_profile_state", "activate_toolset"]);

/**
 * Immutable, eagerly-compiled tool catalog. A ToolGroup loader may allocate tools,
 * therefore it is called exactly once while building the registry, never per turn.
 */
export interface ToolRegistry {
	readonly manifest: ToolManifest;
	readonly groups: ReadonlyMap<string, readonly AgentTool<any>[]>;
	readonly toolsByName: ReadonlyMap<string, AgentTool<any>>;
	toolsForState(state: CoreState, internal: readonly AgentTool<any>[]): AgentTool<any>[];
}

function assertToolName(name: unknown, path: string): asserts name is string {
	if (typeof name !== "string" || !name) throw new Error(`${path} 的工具名非法`);
}

export function compileToolRegistry(manifest: ToolManifest): ToolRegistry {
	const groups = new Map<string, readonly AgentTool<any>[]>();
	const toolsByName = new Map<string, AgentTool<any>>();
	for (const group of manifest.groups) {
		if (!group.key) throw new Error("toolset key 不能为空");
		if (groups.has(group.key)) throw new Error(`重复 toolset: ${group.key}`);
		const tools = group.load();
		if (!Array.isArray(tools)) throw new Error(`toolset ${group.key} 必须返回工具数组`);
		for (const tool of tools) {
			assertToolName(tool?.name, `toolset ${group.key}`);
			if (toolsByName.has(tool.name)) throw new Error(`重复工具名: ${tool.name}`);
			const capabilities = manifest.capabilities?.[tool.name];
			if (!Array.isArray(capabilities) || capabilities.length === 0 || capabilities.some((item) => typeof item !== "string" || !item)) {
				throw new Error(`工具 ${tool.name} 缺少 capability 声明`);
			}
			toolsByName.set(tool.name, tool);
		}
		groups.set(group.key, Object.freeze([...tools]));
	}
	for (const name of Object.keys(manifest.capabilities ?? {})) {
		if (!toolsByName.has(name)) throw new Error(`capability 声明引用未知工具: ${name}`);
	}
	return {
		manifest,
		groups,
		toolsByName,
		toolsForState(state, internal) {
			const names = new Set<string>();
			const result: AgentTool<any>[] = [];
			for (const tool of internal) {
				if (names.has(tool.name)) throw new Error(`内部工具重名: ${tool.name}`);
				names.add(tool.name);
				result.push(tool);
			}
			for (const group of manifest.groups) {
				if (!group.eager && !state.activeToolsets.has(group.key)) continue;
				for (const tool of groups.get(group.key) ?? []) {
					if (names.has(tool.name)) throw new Error(`工具名与内部工具冲突: ${tool.name}`);
					names.add(tool.name);
					result.push(tool);
				}
			}
			return result;
		},
	};
}

export function validateToolManifest(manifest: ToolManifest): void {
	compileToolRegistry(manifest);
}

/** @deprecated Runtime 内部使用已编译的 ToolRegistry；保留此函数供现有嵌入方读取工具。 */
export function toolsForState(manifest: ToolManifest | undefined, state: CoreState, internal: AgentTool<any>[]): AgentTool<any>[] {
	return manifest ? compileToolRegistry(manifest).toolsForState(state, internal) : internal;
}

export function createActivateToolsetTool(state: CoreState, registry: ToolRegistry, refresh: () => void): AgentTool<any> {
	const params = Type.Object({ toolset: Type.Union([...registry.groups.keys()].map((key) => Type.Literal(key))) });
	return { name: "activate_toolset", label: "加载工具组", description: `按需加载工具组，加载后才能使用组内工具：${registry.manifest.groups.map((group) => `${group.key}(${group.description})`).join("；")}`, parameters: params,
		execute: async (_id, rawInput) => {
			const input = rawInput as { toolset: string };
			if (!registry.groups.has(input.toolset)) throw new Error(`未知 toolset: ${input.toolset}`);
			const changed = state.activateToolset(input.toolset); refresh();
			return { content: [{ type: "text", text: changed ? `已激活工具组 ${input.toolset}` : `工具组 ${input.toolset} 已经激活` }], details: { toolset: input.toolset, changed } };
		} };
}

export function validateProfileCapabilities(profiles: readonly ProfileDefinition[], registry: ToolRegistry | undefined): void {
	if (!registry) return;
	const capabilities = new Set(Object.values(registry.manifest.capabilities).flat());
	for (const profile of profiles) {
		for (const [capability, decision] of Object.entries(profile.capabilities ?? {})) {
			if (decision !== "allow" && decision !== "deny") throw new Error(`profile ${profile.key} 的 capability ${capability} 非法`);
			if (!capabilities.has(capability)) throw new Error(`profile ${profile.key} 声明未知 capability: ${capability}`);
		}
	}
}

export function deniedCapability(registry: ToolRegistry | undefined, profile: ProfileDefinition | undefined, toolName: string, args: unknown): string | undefined {
	if (!registry || !profile || !registry.toolsByName.has(toolName)) return undefined;
	const capability = registry.manifest.resolveCapability(toolName, args);
	if (!capability || !registry.manifest.capabilities[toolName]?.includes(capability)) {
		throw new Error(`工具 ${toolName} 返回了未声明的 capability: ${String(capability)}`);
	}
	return profile.capabilities?.[capability] === "deny" ? capability : undefined;
}
