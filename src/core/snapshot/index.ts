import type { JsonValue, SessionSnapshot, SessionSnapshotV1, SnapshotExtension } from "../types.js";
export const CORE_SESSION_SNAPSHOT_VERSION = 1 as const;
function cloneJson<T>(value: T, path: string): T { try { return JSON.parse(JSON.stringify(value)) as T; } catch { throw new Error(`${path} 必须是可序列化 JSON`); } }
export function validateCoreSnapshot(snapshot: unknown, options?: { profileKeys?: string[]; toolsetKeys?: string[]; extensions?: SnapshotExtension[] }): SessionSnapshotV1 {
	if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new Error("无效 Core snapshot");
	const value = snapshot as Record<string, unknown>;
	if (value.version !== 1) throw new Error(`不支持的 Core snapshot 版本: ${String(value.version)}`);
	if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0) throw new Error("snapshot.revision 非法");
	if (value.activeProfileKey !== null && typeof value.activeProfileKey !== "string") throw new Error("snapshot.activeProfileKey 非法");
	if (typeof value.activeProfileKey === "string" && options?.profileKeys && !options.profileKeys.includes(value.activeProfileKey)) throw new Error(`未知 profile: ${value.activeProfileKey}`);
	const activeToolsetKeys = value.activeToolsetKeys === undefined ? [] : value.activeToolsetKeys;
	if (!Array.isArray(activeToolsetKeys) || !activeToolsetKeys.every((key) => typeof key === "string")) throw new Error("snapshot.activeToolsetKeys 非法");
	for (const key of activeToolsetKeys) if (options?.toolsetKeys && !options.toolsetKeys.includes(key)) throw new Error(`未知 toolset: ${key}`);
	if (!Array.isArray(value.messages)) throw new Error("snapshot.messages 必须是数组");
	if (!value.extensions || typeof value.extensions !== "object" || Array.isArray(value.extensions)) throw new Error("snapshot.extensions 必须是对象");
	const extensions = cloneJson(value.extensions, "snapshot.extensions") as Record<string, JsonValue>;
	if (options?.extensions) {
		const registered = new Map(options.extensions.map((extension) => [extension.key, extension]));
		for (const [key, item] of Object.entries(extensions)) { const extension = registered.get(key); if (!extension) throw new Error(`未注册 snapshot extension: ${key}`); extensions[key] = extension.validate(item); }
	}
	return { version: 1, revision: value.revision as number, activeProfileKey: value.activeProfileKey as string | null, activeToolsetKeys: [...activeToolsetKeys], messages: cloneJson(value.messages, "snapshot.messages"), extensions };
}
export function cloneCoreSnapshot(snapshot: SessionSnapshot): SessionSnapshotV1 { return validateCoreSnapshot(snapshot); }
