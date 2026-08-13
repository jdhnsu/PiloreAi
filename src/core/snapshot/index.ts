import type { JsonValue, SessionSnapshot, SessionSnapshotV1, SnapshotExtension } from "../types.js";
import { isContextSummary } from "../context-policy/index.js";

export const CORE_SESSION_SNAPSHOT_VERSION = 1 as const;

function cloneJson<T>(value: T, path: string): T {
	try { return JSON.parse(JSON.stringify(value)) as T; }
	catch { throw new Error(`${path} 必须是可序列化 JSON`); }
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function assertString(value: unknown, path: string): asserts value is string {
	if (typeof value !== "string") throw new Error(`${path} 必须是字符串`);
}

function assertTimestamp(value: unknown, path: string): void {
	if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${path} 必须是非负安全整数`);
}

function validateContent(value: unknown, path: string, allowed: readonly string[]): void {
	if (!Array.isArray(value)) throw new Error(`${path} 必须是数组`);
	for (const [index, raw] of value.entries()) {
		if (!isRecord(raw) || typeof raw.type !== "string" || !allowed.includes(raw.type)) throw new Error(`${path}[${index}] 的内容类型非法`);
		if (raw.type === "text") assertString(raw.text, `${path}[${index}].text`);
		if (raw.type === "thinking") assertString(raw.thinking, `${path}[${index}].thinking`);
		if (raw.type === "image") { assertString(raw.data, `${path}[${index}].data`); assertString(raw.mimeType, `${path}[${index}].mimeType`); }
		if (raw.type === "toolCall") {
			assertString(raw.id, `${path}[${index}].id`);
			assertString(raw.name, `${path}[${index}].name`);
			if (!isRecord(raw.arguments)) throw new Error(`${path}[${index}].arguments 必须是对象`);
		}
	}
}

function validateUsage(value: unknown, path: string): void {
	if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
	for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"]) {
		if (typeof value[key] !== "number" || !Number.isFinite(value[key])) throw new Error(`${path}.${key} 必须是有限数字`);
	}
	if (!isRecord(value.cost)) throw new Error(`${path}.cost 必须是对象`);
	for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"]) {
		if (typeof value.cost[key] !== "number" || !Number.isFinite(value.cost[key])) throw new Error(`${path}.cost.${key} 必须是有限数字`);
	}
}

function validateProfileContext(value: Record<string, unknown>, path: string): void {
	for (const key of ["profileKey", "profileName", "profileHash", "methodology"]) {
		if (value[key] !== null && typeof value[key] !== "string") throw new Error(`${path}.${key} 必须为字符串或 null`);
	}
	if (value.profileKey === null && (value.profileName !== null || value.profileHash !== null || value.methodology !== null)) throw new Error(`${path} 的 auto profile 字段必须均为 null`);
	assertTimestamp(value.timestamp, `${path}.timestamp`);
	if (value.state !== undefined) cloneJson(value.state, `${path}.state`);
}

function validateContextSummary(value: Record<string, unknown>, path: string): void {
	assertString(value.summary, `${path}.summary`);
	if (!Number.isFinite(value.tokensBefore) || (value.tokensBefore as number) < 0) throw new Error(`${path}.tokensBefore 必须是非负有限数字`);
	assertTimestamp(value.timestamp, `${path}.timestamp`);
}

/** Validate the durable subset of @earendil-works/pi-ai Message plus PiLore context messages. */
export function validateSnapshotMessages(messages: unknown): unknown[] {
	if (!Array.isArray(messages)) throw new Error("snapshot.messages 必须是数组");
	for (const [index, raw] of messages.entries()) {
		const path = `snapshot.messages[${index}]`;
		if (!isRecord(raw) || typeof raw.role !== "string") throw new Error(`${path} 必须是带 role 的对象`);
		if (isContextSummary(raw as { role: string })) { validateContextSummary(raw, path); continue; }
		switch (raw.role) {
			case "user":
				assertTimestamp(raw.timestamp, `${path}.timestamp`);
				if (typeof raw.content !== "string") validateContent(raw.content, `${path}.content`, ["text", "image"]);
				break;
			case "assistant":
				assertString(raw.api, `${path}.api`); assertString(raw.provider, `${path}.provider`); assertString(raw.model, `${path}.model`);
				assertTimestamp(raw.timestamp, `${path}.timestamp`);
				if (typeof raw.stopReason !== "string") throw new Error(`${path}.stopReason 必须是字符串`);
				validateUsage(raw.usage, `${path}.usage`);
				validateContent(raw.content, `${path}.content`, ["text", "thinking", "toolCall"]);
				break;
			case "toolResult":
				assertString(raw.toolCallId, `${path}.toolCallId`); assertString(raw.toolName, `${path}.toolName`);
				if (typeof raw.isError !== "boolean") throw new Error(`${path}.isError 必须是布尔值`);
				assertTimestamp(raw.timestamp, `${path}.timestamp`);
				validateContent(raw.content, `${path}.content`, ["text", "image"]);
				if (raw.usage !== undefined) validateUsage(raw.usage, `${path}.usage`);
				break;
			case "piloreProfileContext":
				validateProfileContext(raw, path);
				break;
			default:
				throw new Error(`${path}.role 不受支持: ${raw.role}`);
		}
	}
	return cloneJson(messages, "snapshot.messages");
}

export function validateCoreSnapshot(snapshot: unknown, options?: { profileKeys?: string[]; toolsetKeys?: string[]; extensions?: SnapshotExtension[] }): SessionSnapshotV1 {
	if (!isRecord(snapshot)) throw new Error("无效 Core snapshot");
	if (snapshot.version !== 1) throw new Error(`不支持的 Core snapshot 版本: ${String(snapshot.version)}`);
	if (!Number.isSafeInteger(snapshot.revision) || (snapshot.revision as number) < 0) throw new Error("snapshot.revision 非法");
	if (snapshot.activeProfileKey !== null && typeof snapshot.activeProfileKey !== "string") throw new Error("snapshot.activeProfileKey 非法");
	if (typeof snapshot.activeProfileKey === "string" && options?.profileKeys && !options.profileKeys.includes(snapshot.activeProfileKey)) throw new Error(`未知 profile: ${snapshot.activeProfileKey}`);
	const activeToolsetKeys = snapshot.activeToolsetKeys === undefined ? [] : snapshot.activeToolsetKeys;
	if (!Array.isArray(activeToolsetKeys) || !activeToolsetKeys.every((key) => typeof key === "string")) throw new Error("snapshot.activeToolsetKeys 非法");
	if (new Set(activeToolsetKeys).size !== activeToolsetKeys.length) throw new Error("snapshot.activeToolsetKeys 不能重复");
	for (const key of activeToolsetKeys) if (options?.toolsetKeys && !options.toolsetKeys.includes(key)) throw new Error(`未知 toolset: ${key}`);
	if (!isRecord(snapshot.extensions)) throw new Error("snapshot.extensions 必须是对象");
	const extensions = cloneJson(snapshot.extensions, "snapshot.extensions") as Record<string, JsonValue>;
	if (options?.extensions) {
		const registered = new Map(options.extensions.map((extension) => [extension.key, extension]));
		for (const [key, item] of Object.entries(extensions)) {
			const extension = registered.get(key);
			if (!extension) throw new Error(`未注册 snapshot extension: ${key}`);
			extensions[key] = extension.validate(item);
		}
	}
	return { version: 1, revision: snapshot.revision as number, activeProfileKey: snapshot.activeProfileKey as string | null, activeToolsetKeys: [...activeToolsetKeys], messages: validateSnapshotMessages(snapshot.messages), extensions };
}

export function cloneCoreSnapshot(snapshot: SessionSnapshot): SessionSnapshotV1 { return validateCoreSnapshot(snapshot); }
