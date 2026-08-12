import type { AgentTool, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Model, MutableModels } from "@earendil-works/pi-ai";

/** JSON value accepted by Core state and snapshot extension boundaries. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** A domain-neutral strategy/profile which may be activated during a session. */
export interface Profile {
	key: string;
	name: string;
	description: string;
	methodology: string;
	capabilities?: Record<string, "allow" | "deny">;
}

/** A domain contributes tools and optional profile-driven behaviour to one Core session. */
export interface DomainPack {
	id: string;
	basePrompt?: string;
	profiles?: Profile[];
	tools?: AgentTool<any>[];
	/** Domain-owned, validated data stored under extensions[pack.id]. */
	createExtension?(): JsonValue;
	validateExtension?(value: unknown): JsonValue;
}

/** A reusable unit of tools. Domain packs compose these rather than Core knowing their business meaning. */
export interface ToolPack {
	id: string;
	tools: AgentTool<any>[];
}

export interface RuntimeConfig {
	model: Model<string>;
	models: MutableModels;
	thinkingLevel?: ThinkingLevel;
	systemPrompt?: string;
	tools?: AgentTool<any>[];
	domain?: DomainPack;
	maxTurns?: number;
}

export type SessionEvent =
	| { type: "start" }
	| { type: "text_delta"; delta: string }
	| { type: "message_end" }
	| { type: "tool_start"; toolName: string; args: unknown }
	| { type: "tool_end"; toolName: string; isError: boolean; text: string }
	| { type: "profile"; profile: string | null; name: string | null; source: "model" | "user" }
	| { type: "error"; message: string }
	| { type: "done"; errorMessage?: string };

export interface SessionSnapshotV1 {
	version: 1;
	revision: number;
	activeProfileKey: string | null;
	messages: unknown[];
	extensions: Record<string, JsonValue>;
}

export type SessionSnapshot = SessionSnapshotV1;
