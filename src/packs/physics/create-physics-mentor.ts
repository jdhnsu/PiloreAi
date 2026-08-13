import type { AcademicEvaluator } from "../shared/academic/evaluator.js";
import {
	createAcademicMentor,
	createAcademicMentorSession,
	type AcademicMentor,
	type AcademicMentorConfig,
	type AcademicMentorSession,
	type AcademicPackSpec,
} from "../shared/academic/create-academic-mentor.js";
import type { AcademicMentorState } from "../shared/academic/state.js";
import type { StudyCard } from "../shared/academic/study-card-bank.js";
import { buildPhysicsMentorPrompt } from "./agent-design/base-prompt.js";
import { getDefaultPhysicsProfiles } from "./agent-design/profiles.js";
import { PHYSICS_CARD_KINDS, PHYSICS_PRACTICE_TYPES } from "./tools/manifest.js";

const PHYSICS_PACK_SPEC: AcademicPackSpec<"physics"> = {
	id: "physics",
	subjectName: "大学物理",
	getDefaultProfiles: getDefaultPhysicsProfiles,
	buildPrompt: buildPhysicsMentorPrompt,
	tools: { cardKinds: PHYSICS_CARD_KINDS, practiceTypes: PHYSICS_PRACTICE_TYPES },
};

export interface PhysicsMentorConfig extends AcademicMentorConfig<"physics"> {
	evaluator?: AcademicEvaluator<"physics">;
}

export type PhysicsMentor = AcademicMentor;

export function createPhysicsMentor(config: PhysicsMentorConfig = {}): PhysicsMentor {
	return createAcademicMentor(config, PHYSICS_PACK_SPEC);
}

export interface PhysicsMentorSession extends AcademicMentorSession {
	listPhysicsCards(): StudyCard[];
	getPhysicsCard(id: string): StudyCard | undefined;
	readonly physicsState: AcademicMentorState;
}

export function createPhysicsMentorSession(config: PhysicsMentorConfig = {}): PhysicsMentorSession {
	const session = createAcademicMentorSession(config, PHYSICS_PACK_SPEC);
	return Object.assign(session, {
		listPhysicsCards: session.listCards,
		getPhysicsCard: session.getCard,
		physicsState: session.academicState,
	});
}
