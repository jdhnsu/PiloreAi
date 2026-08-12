import type { DomainPack, Profile } from "../../core/types.js";
import type { Persona } from "../../personas.js";
import type { TeachingProgress } from "../../shared-state.js";

/** Education's representation of the learner. It is intentionally passive in v1. */
export interface LearnerModel { id?: string; attributes?: Record<string, unknown> }
/** Contract for future assessment implementations; no scoring policy is imposed by Core. */
export interface Assessment { assess(input: unknown): Promise<unknown> | unknown }
/** Contract for education progress implementations. */
export interface ProgressTracker { get(key: string): TeachingProgress | undefined; update(key: string, progress: Partial<TeachingProgress>): TeachingProgress }

export interface EducationDomainPack extends DomainPack {
	id: "education";
	profiles: Profile[];
	personas: Persona[];
}
