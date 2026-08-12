import type { JsonValue, Profile } from "./types.js";

/** Core's sole source of truth for active profile and profile-scoped JSON state. */
export class CoreState {
	activeProfile: Profile | undefined;
	readonly stateByProfile = new Map<string, JsonValue>();
	private listeners = new Set<(profile: Profile | undefined, source: "model" | "user") => void>();

	setProfile(profile: Profile | undefined, source: "model" | "user"): void {
		this.activeProfile = profile;
		for (const listener of this.listeners) listener(profile, source);
	}
	onProfileChange(listener: (profile: Profile | undefined, source: "model" | "user") => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	getProfileState(key = this.activeProfile?.key): JsonValue | undefined {
		return key ? this.stateByProfile.get(key) : undefined;
	}
	setProfileState(value: JsonValue, key = this.activeProfile?.key): void {
		if (!key) throw new Error("没有激活 profile，不能写入 profile 状态");
		this.stateByProfile.set(key, value);
	}
}
