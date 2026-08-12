import type { JsonValue, SessionSnapshot, SessionSnapshotV1 } from "./types.js";

export const CORE_SESSION_SNAPSHOT_VERSION = 1 as const;

function json(value: unknown, path: string): JsonValue {
	try {
		return JSON.parse(JSON.stringify(value)) as JsonValue;
	} catch {
		throw new Error(`${path} 必须是可序列化 JSON`);
	}
}

export function validateCoreSnapshot(snapshot: unknown): SessionSnapshotV1 {
	if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new Error("无效 Core snapshot");
	const value = snapshot as Record<string, unknown>;
	if (value.version !== CORE_SESSION_SNAPSHOT_VERSION) throw new Error(`不支持的 Core snapshot 版本: ${String(value.version)}`);
	if (!Number.isInteger(value.revision) || (value.revision as number) < 0) throw new Error("snapshot.revision 非法");
	if (value.activeProfileKey !== null && typeof value.activeProfileKey !== "string") throw new Error("snapshot.activeProfileKey 非法");
	if (!Array.isArray(value.messages)) throw new Error("snapshot.messages 必须是数组");
	if (!value.extensions || typeof value.extensions !== "object" || Array.isArray(value.extensions)) throw new Error("snapshot.extensions 必须是对象");
	return {
		version: CORE_SESSION_SNAPSHOT_VERSION,
		revision: value.revision as number,
		activeProfileKey: value.activeProfileKey as string | null,
		messages: json(value.messages, "snapshot.messages") as unknown[],
		extensions: json(value.extensions, "snapshot.extensions") as Record<string, JsonValue>,
	};
}

export function cloneCoreSnapshot(snapshot: SessionSnapshot): SessionSnapshotV1 {
	return validateCoreSnapshot(snapshot);
}
