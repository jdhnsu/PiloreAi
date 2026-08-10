import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Persona } from "./personas.js";
import type { TeachingProgress } from "./shared-state.js";
import { normalizePath } from "./vfs.js";

export const EDU_SESSION_SNAPSHOT_VERSION = 1 as const;

export interface EduSessionSnapshotV1 {
	version: typeof EDU_SESSION_SNAPSHOT_VERSION;
	revision: number;
	activePersonaKey: string | null;
	teachingByPersona: Record<string, TeachingProgress>;
	files: Record<string, string>;
	messages: AgentMessage[];
}

export type EduSessionSnapshot = EduSessionSnapshotV1;

export class InvalidSessionSnapshotError extends Error {
	readonly code = "INVALID_SESSION_SNAPSHOT";

	constructor(message: string) {
		super(message);
		this.name = "InvalidSessionSnapshotError";
	}
}

function invalid(message: string): never {
	throw new InvalidSessionSnapshotError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertJsonValue(value: unknown, path: string, seen: Set<object>): void {
	if (value === null || typeof value === "string" || typeof value === "boolean") return;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) invalid(`${path} 含非有限数字`);
		return;
	}
	if (typeof value !== "object") invalid(`${path} 含不可序列化值`);
	if (seen.has(value)) invalid(`${path} 含循环引用`);
	seen.add(value);
	if (Array.isArray(value)) {
		value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`, seen));
	} else {
		for (const [key, item] of Object.entries(value)) {
			assertJsonValue(item, `${path}.${key}`, seen);
		}
	}
	seen.delete(value);
}

function cloneJson<T>(value: T, path: string): T {
	assertJsonValue(value, path, new Set());
	return JSON.parse(JSON.stringify(value)) as T;
}

function validateProgress(value: unknown, path: string): TeachingProgress {
	if (!isRecord(value)) invalid(`${path} 必须是对象`);
	if (typeof value.stage !== "string" || typeof value.topic !== "string") invalid(`${path} 的 stage/topic 必须是字符串`);
	for (const field of ["covered", "pending"] as const) {
		if (!Array.isArray(value[field]) || !value[field].every((item) => typeof item === "string")) {
			invalid(`${path}.${field} 必须是字符串数组`);
		}
	}
	return cloneJson(value as unknown as TeachingProgress, path);
}

function validateMessage(value: unknown, index: number): AgentMessage {
	const path = `snapshot.messages[${index}]`;
	if (!isRecord(value)) invalid(`${path} 必须是对象`);
	if (value.role !== "user" && value.role !== "assistant" && value.role !== "toolResult") {
		invalid(`${path}.role 非法`);
	}
	if (!Number.isFinite(value.timestamp)) invalid(`${path}.timestamp 必须是有限数字`);
	if (value.role === "user") {
		if (typeof value.content !== "string" && !Array.isArray(value.content)) invalid(`${path}.content 非法`);
	} else if (!Array.isArray(value.content)) {
		invalid(`${path}.content 必须是数组`);
	}
	if (Array.isArray(value.content)) {
		for (const [contentIndex, block] of value.content.entries()) {
			if (!isRecord(block) || typeof block.type !== "string") invalid(`${path}.content[${contentIndex}] 必须是带 type 的对象`);
		}
	}
	if (value.role === "assistant") {
		if (typeof value.provider !== "string" || typeof value.model !== "string" || typeof value.api !== "string") {
			invalid(`${path} 缺少 assistant 模型字段`);
		}
		if (!isRecord(value.usage) || typeof value.stopReason !== "string") invalid(`${path} 缺少 assistant usage/stopReason`);
	}
	if (value.role === "toolResult") {
		if (typeof value.toolCallId !== "string" || typeof value.toolName !== "string" || typeof value.isError !== "boolean") {
			invalid(`${path} 缺少 toolResult 字段`);
		}
	}
	return cloneJson(value as unknown as AgentMessage, path);
}

export function validateSessionSnapshot(snapshot: unknown, personas: Persona[]): EduSessionSnapshotV1 {
	if (!isRecord(snapshot)) invalid("session snapshot 必须是对象");
	if (snapshot.version !== EDU_SESSION_SNAPSHOT_VERSION) {
		invalid(`不支持的 session snapshot 版本: ${String(snapshot.version)}`);
	}
	if (!Number.isSafeInteger(snapshot.revision) || (snapshot.revision as number) < 0) invalid("snapshot.revision 必须是非负安全整数");
	if (snapshot.activePersonaKey !== null && typeof snapshot.activePersonaKey !== "string") invalid("snapshot.activePersonaKey 非法");
	if (typeof snapshot.activePersonaKey === "string" && !personas.some((p) => p.key === snapshot.activePersonaKey)) {
		invalid(`snapshot 引用了未知教学方法: ${snapshot.activePersonaKey}`);
	}
	if (!isRecord(snapshot.teachingByPersona)) invalid("snapshot.teachingByPersona 必须是对象");
	const knownKeys = new Set(personas.map((p) => p.key));
	const teachingByPersona: Record<string, TeachingProgress> = {};
	for (const [key, value] of Object.entries(snapshot.teachingByPersona)) {
		if (!knownKeys.has(key)) invalid(`snapshot 教学进度引用了未知教学方法: ${key}`);
		teachingByPersona[key] = validateProgress(value, `snapshot.teachingByPersona.${key}`);
	}
	if (!isRecord(snapshot.files)) invalid("snapshot.files 必须是对象");
	const files: Record<string, string> = {};
	for (const [path, content] of Object.entries(snapshot.files)) {
		if (typeof content !== "string") invalid(`snapshot.files.${path} 必须是字符串`);
		let normalized: string;
		try {
			normalized = normalizePath(path);
		} catch (cause) {
			invalid(`snapshot.files 包含非法路径 ${path}: ${cause instanceof Error ? cause.message : String(cause)}`);
		}
		if (normalized !== path) invalid(`snapshot.files 路径必须已规范化: ${path} → ${normalized}`);
		files[normalized] = content;
	}
	if (!Array.isArray(snapshot.messages)) invalid("snapshot.messages 必须是数组");
	return {
		version: EDU_SESSION_SNAPSHOT_VERSION,
		revision: snapshot.revision as number,
		activePersonaKey: snapshot.activePersonaKey as string | null,
		teachingByPersona,
		files,
		messages: snapshot.messages.map(validateMessage),
	};
}

export function cloneSessionSnapshot(snapshot: EduSessionSnapshotV1): EduSessionSnapshotV1 {
	return cloneJson(snapshot, "snapshot");
}
