import type { ToolManifest } from "../../../core/types.js";
import type { AcademicEvaluator } from "../../shared/academic/evaluator.js";
import type { AcademicMentorState } from "../../shared/academic/state.js";
import type { StudyCardBank } from "../../shared/academic/study-card-bank.js";
import { createAcademicToolManifest } from "../../shared/academic/tools.js";

export const PHYSICS_CARD_KINDS = ["law", "model", "formula", "experiment", "mistake"] as const;
export const PHYSICS_PRACTICE_TYPES = ["concept", "calculation", "derivation", "experiment", "estimation"] as const;

export function createPhysicsToolManifest(
	cards: StudyCardBank,
	state: AcademicMentorState,
	evaluator?: AcademicEvaluator<"physics">,
): ToolManifest {
	return createAcademicToolManifest(cards, state, {
		subjectId: "physics",
		subjectName: "大学物理",
		cardKinds: PHYSICS_CARD_KINDS,
		practiceTypes: PHYSICS_PRACTICE_TYPES,
	}, evaluator);
}
