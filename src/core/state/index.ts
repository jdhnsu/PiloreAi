import type { JsonValue, ProfileDefinition } from "../types.js";
import type { ProfileChangeSource } from "../events/index.js";

export class CoreState {
	activeProfile: ProfileDefinition | undefined;
	readonly activeToolsets = new Set<string>();
	switchCount = 0;
	private readonly extensions = new Map<string, JsonValue>();
	private readonly profileListeners = new Set<(profile: ProfileDefinition | undefined, source: ProfileChangeSource) => void>();
	private readonly toolsetListeners = new Set<(key: string, active: boolean) => void>();

	setProfile(profile: ProfileDefinition | undefined, source: ProfileChangeSource): void {
		this.activeProfile = profile;
		for (const listener of this.profileListeners) listener(profile, source);
	}
	onProfileChange(listener: (profile: ProfileDefinition | undefined, source: ProfileChangeSource) => void): () => void {
		this.profileListeners.add(listener);
		return () => this.profileListeners.delete(listener);
	}
	activateToolset(key: string): boolean {
		if (this.activeToolsets.has(key)) return false;
		this.activeToolsets.add(key);
		for (const listener of this.toolsetListeners) listener(key, true);
		return true;
	}
	onToolsetChange(listener: (key: string, active: boolean) => void): () => void {
		this.toolsetListeners.add(listener);
		return () => this.toolsetListeners.delete(listener);
	}
	registerExtension(key: string, initial: JsonValue): void {
		if (this.extensions.has(key)) throw new Error(`重复 state extension: ${key}`);
		this.extensions.set(key, initial);
	}
	getExtension<T extends JsonValue>(key: string): T {
		if (!this.extensions.has(key)) throw new Error(`未注册 state extension: ${key}`);
		return this.extensions.get(key) as T;
	}
	setExtension(key: string, value: JsonValue): void {
		if (!this.extensions.has(key)) throw new Error(`未注册 state extension: ${key}`);
		this.extensions.set(key, value);
	}
	exportExtensions(): Record<string, JsonValue> { return Object.fromEntries(this.extensions); }
	resetUserTurn(): void { this.switchCount = 0; }
}
