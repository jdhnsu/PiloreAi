import type { ToolManifest } from "../../../core/types.js";
import type { AcademicEvaluator } from "../../shared/academic/evaluator.js";
import type { AcademicMentorState } from "../../shared/academic/state.js";
import type { StudyCardBank } from "../../shared/academic/study-card-bank.js";
import { createAcademicToolManifest } from "../../shared/academic/tools.js";

export const HISTORY_CARD_KINDS = ["event", "person", "concept", "source", "debate"] as const;
export const HISTORY_PRACTICE_TYPES = ["chronology", "concept", "causation", "comparison", "source_analysis", "essay"] as const;

export function createHistoryToolManifest(
	cards: StudyCardBank,
	state: AcademicMentorState,
	evaluator?: AcademicEvaluator<"history">,
): ToolManifest {
	return createAcademicToolManifest(cards, state, {
		subjectId: "history",
		subjectName: "大学历史",
		cardKinds: HISTORY_CARD_KINDS,
		practiceTypes: HISTORY_PRACTICE_TYPES,
	}, evaluator);
}
