import type { AgentTool, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Model, MutableModels } from "@earendil-works/pi-ai";
import type { ProfileContextMessage } from "./router/index.js";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface ProfileDefinition { key: string; name: string; description: string; methodology: string; capabilities?: Record<string, "allow" | "deny"> }
export type Profile = ProfileDefinition;
export interface RouterConfig {
	profiles: ProfileDefinition[];
	maxSwitchesPerTurn?: number;
	parseMention?(text: string): { profile: ProfileDefinition | null; rest: string } | undefined;
	getProfileState?(key: string): JsonValue | undefined;
	updateProfileState?(key: string, patch: Record<string, JsonValue>): JsonValue;
	renderContext?(message: ProfileContextMessage): string;
}
export interface ToolGroup { key: string; description: string; eager?: boolean; load(): AgentTool<any>[] }
export interface ToolManifest { groups: ToolGroup[]; resolveCapability(toolName: string, args: unknown): string | undefined }
export interface SnapshotExtension<T extends JsonValue = JsonValue> { key: string; export(): T; validate(value: unknown): T; restore(value: T): void; migrate?(value: unknown, version: number): T }
export interface DomainPack {
	id: string; basePrompt?: string; router?: RouterConfig; toolManifest?: ToolManifest; snapshotExtension?: SnapshotExtension;
}
export interface RuntimeConfig {
	model: Model<string>; models: MutableModels; thinkingLevel?: ThinkingLevel; systemPrompt?: string; tools?: AgentTool<any>[]; domain?: DomainPack; maxTurns?: number;
	fetch?: typeof globalThis.fetch; llmTelemetry?: import("../infrastructure/telemetry/index.js").LlmTelemetrySink;
}
export interface SessionSnapshotV1 { version: 1; revision: number; activeProfileKey: string | null; activeToolsetKeys: string[]; messages: unknown[]; extensions: Record<string, JsonValue> }
export type SessionSnapshot = SessionSnapshotV1;
export type { SessionEvent } from "./events/index.js";
