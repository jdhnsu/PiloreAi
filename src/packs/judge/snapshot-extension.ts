import type { JsonValue, SnapshotExtension } from "../../core/types.js";
import type {
	JudgeMentorProgress,
	JudgeMentorState,
	JudgePendingVerification,
	JudgeProblemExample,
	JudgeProblemRecord,
	JudgeProblemTestCase,
	JudgeSubmission,
	JudgeSubmissionCase,
} from "./state.js";

export interface JudgeSnapshotData extends Record<string, JsonValue> {
	progressByProfile: Record<string, JudgeMentorProgress>;
	pendingVerification: JudgePendingVerification | null;
	currentProblem: JudgeProblemRecord | null;
	lastSubmission: JudgeSubmission | null;
}

function record(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: string[], path: string): void {
	const set = new Set(allowed);
	for (const key of Object.keys(value)) if (!set.has(key)) throw new Error(`${path}.${key} 不受支持`);
}

function strings(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function nullableString(value: unknown): value is string | null {
	return value === null || typeof value === "string";
}

function validExample(value: unknown): value is JudgeProblemExample {
	if (!record(value)) return false;
	exactKeys(value, ["input", "output", "explanation"], "problem.example");
	return typeof value.input === "string" && typeof value.output === "string" && typeof value.explanation === "string";
}

function validTestCase(value: unknown): value is JudgeProblemTestCase {
	if (!record(value)) return false;
	exactKeys(value, ["name", "input", "expectedOutput", "hidden"], "problem.testCase");
	return typeof value.name === "string" && typeof value.input === "string" && typeof value.expectedOutput === "string" && typeof value.hidden === "boolean";
}

function validProblem(value: unknown): value is JudgeProblemRecord {
	if (!record(value)) return false;
	exactKeys(value, [
		"id", "title", "difficulty", "description", "inputFormat", "outputFormat", "constraints", "examples",
		"language", "starterCode", "createdAt", "referenceSolution", "testCases", "verifiedAt",
	], "problem");
	return typeof value.id === "string"
		&& typeof value.title === "string"
		&& (value.difficulty === "easy" || value.difficulty === "medium" || value.difficulty === "hard")
		&& typeof value.description === "string"
		&& typeof value.inputFormat === "string"
		&& typeof value.outputFormat === "string"
		&& strings(value.constraints)
		&& Array.isArray(value.examples) && value.examples.every(validExample)
		&& typeof value.language === "string"
		&& typeof value.starterCode === "string"
		&& typeof value.createdAt === "string"
		&& typeof value.referenceSolution === "string"
		&& Array.isArray(value.testCases) && value.testCases.length >= 3 && value.testCases.length <= 20 && value.testCases.every(validTestCase)
		&& typeof value.verifiedAt === "string";
}

function validPending(value: unknown): value is JudgePendingVerification {
	if (!record(value)) return false;
	exactKeys(value, ["verificationId", "problem", "verifiedCaseCount"], "pendingVerification");
	return typeof value.verificationId === "string"
		&& validProblem(value.problem)
		&& Number.isSafeInteger(value.verifiedCaseCount)
		&& (value.verifiedCaseCount as number) === value.problem.testCases.length;
}

function validSubmissionCase(value: unknown): value is JudgeSubmissionCase {
	if (!record(value)) return false;
	exactKeys(value, ["name", "hidden", "passed", "status", "timeSeconds", "memoryKilobytes", "input", "expectedOutput", "actualOutput"], "submission.case");
	return typeof value.name === "string"
		&& typeof value.hidden === "boolean"
		&& (value.passed === null || typeof value.passed === "boolean")
		&& typeof value.status === "string"
		&& typeof value.timeSeconds === "number" && Number.isFinite(value.timeSeconds) && value.timeSeconds >= 0
		&& typeof value.memoryKilobytes === "number" && Number.isFinite(value.memoryKilobytes) && value.memoryKilobytes >= 0
		&& nullableString(value.input)
		&& nullableString(value.expectedOutput)
		&& nullableString(value.actualOutput)
		&& (!value.hidden || (value.input === null && value.expectedOutput === null && value.actualOutput === null));
}

function validSubmission(value: unknown): value is JudgeSubmission {
	if (!record(value)) return false;
	exactKeys(value, [
		"id", "problemId", "language", "verdict", "passed", "total", "totalTimeSeconds", "peakMemoryKilobytes",
		"compileOutput", "stderr", "submittedAt", "cases",
	], "submission");
	return typeof value.id === "string"
		&& typeof value.problemId === "string"
		&& typeof value.language === "string"
		&& (value.verdict === "accepted" || value.verdict === "rejected" || value.verdict === "infrastructure_error")
		&& Number.isSafeInteger(value.passed) && (value.passed as number) >= 0
		&& Number.isSafeInteger(value.total) && (value.total as number) >= 1
		&& typeof value.totalTimeSeconds === "number" && Number.isFinite(value.totalTimeSeconds) && value.totalTimeSeconds >= 0
		&& typeof value.peakMemoryKilobytes === "number" && Number.isFinite(value.peakMemoryKilobytes) && value.peakMemoryKilobytes >= 0
		&& nullableString(value.compileOutput)
		&& nullableString(value.stderr)
		&& typeof value.submittedAt === "string"
		&& Array.isArray(value.cases) && value.cases.length === value.total && value.cases.every(validSubmissionCase);
}

function validateProgress(value: unknown, profileKeys: string[]): Record<string, JudgeMentorProgress> {
	if (!record(value)) throw new Error("extensions.judge.progressByProfile 非法");
	const progress: Record<string, JudgeMentorProgress> = {};
	for (const [key, item] of Object.entries(value)) {
		if (!profileKeys.includes(key) || !record(item)) throw new Error(`extensions.judge.progressByProfile.${key} 非法`);
		exactKeys(item, ["stage", "topic", "covered", "pending"], `extensions.judge.progressByProfile.${key}`);
		if (typeof item.stage !== "string" || typeof item.topic !== "string" || !strings(item.covered) || !strings(item.pending)) {
			throw new Error(`extensions.judge.progressByProfile.${key} 非法`);
		}
		progress[key] = item as unknown as JudgeMentorProgress;
	}
	return progress;
}

export function createJudgeSnapshotExtension(state: JudgeMentorState, profileKeys: string[]): SnapshotExtension<JudgeSnapshotData> {
	return {
		key: "judge",
		export: () => structuredClone({
			progressByProfile: state.progressByProfile,
			pendingVerification: state.pendingVerification,
			currentProblem: state.currentProblem,
			lastSubmission: state.lastSubmission,
		}),
		validate(value) {
			if (!record(value)) throw new Error("extensions.judge 非法");
			exactKeys(value, ["progressByProfile", "pendingVerification", "currentProblem", "lastSubmission"], "extensions.judge");
			const progressByProfile = validateProgress(value.progressByProfile, profileKeys);
			if (value.pendingVerification !== null && !validPending(value.pendingVerification)) throw new Error("extensions.judge.pendingVerification 非法");
			if (value.currentProblem !== null && !validProblem(value.currentProblem)) throw new Error("extensions.judge.currentProblem 非法");
			if (value.lastSubmission !== null && !validSubmission(value.lastSubmission)) throw new Error("extensions.judge.lastSubmission 非法");
			if (value.lastSubmission && value.currentProblem && value.lastSubmission.problemId !== value.currentProblem.id) throw new Error("extensions.judge.lastSubmission.problemId 不匹配");
			return structuredClone({
				progressByProfile,
				pendingVerification: value.pendingVerification as JudgePendingVerification | null,
				currentProblem: value.currentProblem as JudgeProblemRecord | null,
				lastSubmission: value.lastSubmission as JudgeSubmission | null,
			});
		},
		restore(value) {
			state.progressByProfile = structuredClone(value.progressByProfile);
			state.pendingVerification = structuredClone(value.pendingVerification);
			state.currentProblem = structuredClone(value.currentProblem);
			state.lastSubmission = structuredClone(value.lastSubmission);
		},
	};
}
