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
import { buildMathMentorPrompt } from "./agent-design/base-prompt.js";
import { getDefaultMathProfiles } from "./agent-design/profiles.js";
import { MATH_CARD_KINDS, MATH_PRACTICE_TYPES } from "./tools/manifest.js";

const MATH_PACK_SPEC: AcademicPackSpec<"math"> = {
	id: "math",
	subjectName: "大学数学",
	getDefaultProfiles: getDefaultMathProfiles,
	buildPrompt: buildMathMentorPrompt,
	tools: { cardKinds: MATH_CARD_KINDS, practiceTypes: MATH_PRACTICE_TYPES },
};

export interface MathMentorConfig extends AcademicMentorConfig<"math"> {
	evaluator?: AcademicEvaluator<"math">;
}

export type MathMentor = AcademicMentor;

export function createMathMentor(config: MathMentorConfig = {}): MathMentor {
	return createAcademicMentor(config, MATH_PACK_SPEC);
}

export interface MathMentorSession extends AcademicMentorSession {
	listMathCards(): StudyCard[];
	getMathCard(id: string): StudyCard | undefined;
	readonly mathState: AcademicMentorState;
}

export function createMathMentorSession(config: MathMentorConfig = {}): MathMentorSession {
	const session = createAcademicMentorSession(config, MATH_PACK_SPEC);
	return Object.assign(session, {
		listMathCards: session.listCards,
		getMathCard: session.getCard,
		mathState: session.academicState,
	});
}
