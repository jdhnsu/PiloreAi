export {
	createPhysicsMentor,
	createPhysicsMentorSession,
	type PhysicsMentor,
	type PhysicsMentorConfig,
	type PhysicsMentorSession,
} from "./create-physics-mentor.js";
export { getDefaultPhysicsProfiles, loadPhysicsProfiles, parsePhysicsProfile } from "./agent-design/profiles.js";
export { createPhysicsToolManifest, PHYSICS_CARD_KINDS, PHYSICS_PRACTICE_TYPES } from "./tools/manifest.js";
export type { PhysicsEvaluator, PhysicsCheckRequest, PhysicsCheckResult } from "./evaluator.js";
