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
import { buildHistoryMentorPrompt } from "./agent-design/base-prompt.js";
import { getDefaultHistoryProfiles } from "./agent-design/profiles.js";
import { HISTORY_CARD_KINDS, HISTORY_PRACTICE_TYPES } from "./tools/manifest.js";

const HISTORY_PACK_SPEC: AcademicPackSpec<"history"> = {
	id: "history",
	subjectName: "大学历史",
	getDefaultProfiles: getDefaultHistoryProfiles,
	buildPrompt: buildHistoryMentorPrompt,
	tools: { cardKinds: HISTORY_CARD_KINDS, practiceTypes: HISTORY_PRACTICE_TYPES },
};

export interface HistoryMentorConfig extends AcademicMentorConfig<"history"> {
	evaluator?: AcademicEvaluator<"history">;
}

export type HistoryMentor = AcademicMentor;

export function createHistoryMentor(config: HistoryMentorConfig = {}): HistoryMentor {
	return createAcademicMentor(config, HISTORY_PACK_SPEC);
}

export interface HistoryMentorSession extends AcademicMentorSession {
	listHistoryCards(): StudyCard[];
	getHistoryCard(id: string): StudyCard | undefined;
	readonly historyState: AcademicMentorState;
}

export function createHistoryMentorSession(config: HistoryMentorConfig = {}): HistoryMentorSession {
	const session = createAcademicMentorSession(config, HISTORY_PACK_SPEC);
	return Object.assign(session, {
		listHistoryCards: session.listCards,
		getHistoryCard: session.getCard,
		historyState: session.academicState,
	});
}
