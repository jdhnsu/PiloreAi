import type { JsonValue, SnapshotExtension } from "../../../core/types.js";
import type { AcademicMentorState, AcademicPracticeRecord, AcademicProgress } from "./state.js";
import type { StudyCard, StudyCardBank } from "./study-card-bank.js";

export interface AcademicSnapshotData extends Record<string, JsonValue> {
	progressByProfile: Record<string, AcademicProgress>;
	cards: Record<string, StudyCard>;
	practiceLog: AcademicPracticeRecord[];
}

function record(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function isCard(value: unknown): value is StudyCard {
	return record(value)
		&& typeof value.id === "string"
		&& typeof value.kind === "string"
		&& typeof value.title === "string"
		&& typeof value.summary === "string"
		&& typeof value.details === "string"
		&& Array.isArray(value.tags)
		&& value.tags.every((tag) => typeof tag === "string");
}

function isPracticeRecord(value: unknown): value is AcademicPracticeRecord {
	return record(value)
		&& typeof value.type === "string"
		&& typeof value.ts === "string"
		&& Array.isArray(value.items)
		&& value.items.every((item) => record(item)
			&& typeof item.prompt === "string"
			&& typeof item.answer === "string"
			&& typeof item.reference === "string"
			&& (item.correct === null || typeof item.correct === "boolean")
			&& typeof item.feedback === "string");
}

export function createAcademicSnapshotExtension(
	key: string,
	state: AcademicMentorState,
	bank: StudyCardBank,
	profileKeys: string[],
	cardKinds: readonly string[],
): SnapshotExtension<AcademicSnapshotData> {
	return {
		key,
		export: () => ({
			progressByProfile: structuredClone(state.progressByProfile),
			cards: structuredClone(bank.toRecord()),
			practiceLog: structuredClone(state.practiceLog),
		}),
		validate(value) {
			if (!record(value) || !record(value.progressByProfile) || !record(value.cards) || !Array.isArray(value.practiceLog)) {
				throw new Error(`extensions.${key} 非法`);
			}
			const progressByProfile: Record<string, AcademicProgress> = {};
			for (const [profileKey, progress] of Object.entries(value.progressByProfile)) {
				if (!profileKeys.includes(profileKey)
					|| !record(progress)
					|| typeof progress.stage !== "string"
					|| typeof progress.topic !== "string"
					|| !Array.isArray(progress.covered)
					|| !progress.covered.every((item) => typeof item === "string")
					|| !Array.isArray(progress.pending)
					|| !progress.pending.every((item) => typeof item === "string")) {
					throw new Error(`extensions.${key}.progressByProfile.${profileKey} 非法`);
				}
				progressByProfile[profileKey] = progress as unknown as AcademicProgress;
			}
			const cards: Record<string, StudyCard> = {};
			for (const [id, card] of Object.entries(value.cards)) {
				if (!isCard(card) || card.id !== id || !cardKinds.includes(card.kind)) {
					throw new Error(`extensions.${key}.cards.${id} 非法`);
				}
				cards[id] = card;
			}
			const practiceLog = value.practiceLog.map((item, index) => {
				if (!isPracticeRecord(item)) throw new Error(`extensions.${key}.practiceLog[${index}] 非法`);
				return item;
			});
			return { progressByProfile, cards, practiceLog };
		},
		restore(value) {
			state.progressByProfile = structuredClone(value.progressByProfile);
			state.practiceLog = structuredClone(value.practiceLog);
			bank.restore(value.cards);
		},
	};
}
