import type { ToolManifest } from "../../../core/types.js";
import type { AcademicEvaluator } from "../../shared/academic/evaluator.js";
import type { AcademicMentorState } from "../../shared/academic/state.js";
import type { StudyCardBank } from "../../shared/academic/study-card-bank.js";
import { createAcademicToolManifest } from "../../shared/academic/tools.js";

export const MATH_CARD_KINDS = ["definition", "theorem", "formula", "method", "mistake"] as const;
export const MATH_PRACTICE_TYPES = ["concept", "calculation", "derivation", "proof", "application"] as const;

export function createMathToolManifest(
	cards: StudyCardBank,
	state: AcademicMentorState,
	evaluator?: AcademicEvaluator<"math">,
): ToolManifest {
	return createAcademicToolManifest(cards, state, {
		subjectId: "math",
		subjectName: "大学数学",
		cardKinds: MATH_CARD_KINDS,
		practiceTypes: MATH_PRACTICE_TYPES,
	}, evaluator);
}
