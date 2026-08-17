import type { AgentTool, ThinkingLevel } from "@pilore/pi-agent-core";
import type { Model, MutableModels } from "@pilore/pi-ai";
import type { ProfileContextMessage } from "./router/index.js";
import type { ContextPolicy } from "./context-policy/index.js";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface ProfileDefinition { key: string; name: string; description: string; methodology: string; capabilities?: Record<string, "allow" | "deny"> }
export type Profile = ProfileDefinition;
export interface RouterConfig {
	profiles: ProfileDefinition[];
	maxSwitchesPerTurn?: number;
	parseMention?(text: string): { profile: ProfileDefinition | null; rest: string } | undefined;
	getProfileState?(key: string): JsonValue | undefined;
	/** 将模型输入收窄为本 Pack 允许的状态字段；必须在写入前调用。 */
	validateProfileStatePatch?(key: string, patch: unknown): Record<string, JsonValue>;
	updateProfileState?(key: string, patch: Record<string, JsonValue>): JsonValue;
	renderContext?(message: ProfileContextMessage): string;
}
export interface ToolGroup { key: string; description: string; eager?: boolean; load(): AgentTool<any>[] }
/** 每个具体工具的所有可能能力，用于启动时验证；动态能力也必须枚举全部分支。 */
export type ToolCapabilities = Record<string, readonly string[]>;
export interface ToolManifest {
	groups: ToolGroup[];
	capabilities: ToolCapabilities;
	resolveCapability(toolName: string, args: unknown): string | undefined;
}
export interface SnapshotExtension<T extends JsonValue = JsonValue> { key: string; export(): T; validate(value: unknown): T; restore(value: T): void; migrate?(value: unknown, version: number): T }
export interface DomainPack {
	id: string; basePrompt?: string; router?: RouterConfig; toolManifest?: ToolManifest; snapshotExtension?: SnapshotExtension;
}
export interface RuntimeConfig {
	model: Model<string>; models: MutableModels; thinkingLevel?: ThinkingLevel; systemPrompt?: string; tools?: AgentTool<any>[]; domain?: DomainPack; maxTurns?: number;
	/** Optional model-aware input budget and user-confirmed history compaction policy. */
	contextPolicy?: ContextPolicy;
	fetch?: typeof globalThis.fetch; llmTelemetry?: import("../infrastructure/telemetry/index.js").LlmTelemetrySink;
}
export interface SessionSnapshotV1 { version: 1; revision: number; activeProfileKey: string | null; activeToolsetKeys: string[]; messages: unknown[]; extensions: Record<string, JsonValue> }
export type SessionSnapshot = SessionSnapshotV1;
export type { SessionEvent } from "./events/index.js";
export type { ContextPolicy } from "./context-policy/index.js";
