import type { JsonValue } from "../../core/types.js";

export type JudgeDifficulty = "easy" | "medium" | "hard";

export interface JudgeMentorProgress extends Record<string, JsonValue> {
	stage: string;
	topic: string;
	covered: string[];
	pending: string[];
}

export interface JudgeProblemExample extends Record<string, JsonValue> {
	input: string;
	output: string;
	explanation: string;
}

export interface JudgeProblemTestCase extends Record<string, JsonValue> {
	name: string;
	input: string;
	expectedOutput: string;
	hidden: boolean;
}

export interface JudgeProblemCard extends Record<string, JsonValue> {
	id: string;
	title: string;
	difficulty: JudgeDifficulty;
	description: string;
	inputFormat: string;
	outputFormat: string;
	constraints: string[];
	examples: JudgeProblemExample[];
	language: string;
	starterCode: string;
	createdAt: string;
}

export interface JudgeProblemRecord extends JudgeProblemCard {
	referenceSolution: string;
	testCases: JudgeProblemTestCase[];
	verifiedAt: string;
}

export interface JudgePendingVerification extends Record<string, JsonValue> {
	verificationId: string;
	problem: JudgeProblemRecord;
	verifiedCaseCount: number;
}

export interface JudgeSubmissionCase extends Record<string, JsonValue> {
	name: string;
	hidden: boolean;
	passed: boolean | null;
	status: string;
	timeSeconds: number;
	memoryKilobytes: number;
	input: string | null;
	expectedOutput: string | null;
	actualOutput: string | null;
}

export interface JudgeSubmission extends Record<string, JsonValue> {
	id: string;
	problemId: string;
	language: string;
	verdict: "accepted" | "rejected" | "infrastructure_error";
	passed: number;
	total: number;
	totalTimeSeconds: number;
	peakMemoryKilobytes: number;
	compileOutput: string | null;
	stderr: string | null;
	submittedAt: string;
	cases: JudgeSubmissionCase[];
}

export interface JudgeMentorState extends Record<string, JsonValue> {
	progressByProfile: Record<string, JudgeMentorProgress>;
	pendingVerification: JudgePendingVerification | null;
	currentProblem: JudgeProblemRecord | null;
	lastSubmission: JudgeSubmission | null;
}

export function createJudgeMentorState(): JudgeMentorState {
	return {
		progressByProfile: {},
		pendingVerification: null,
		currentProblem: null,
		lastSubmission: null,
	};
}

export function validateJudgeProgressPatch(value: unknown): Partial<JudgeMentorProgress> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("profile state patch 必须是对象");
	const patch = value as Record<string, unknown>;
	const allowed = new Set(["stage", "topic", "covered", "pending"]);
	for (const key of Object.keys(patch)) if (!allowed.has(key)) throw new Error(`不支持的 profile state 字段: ${key}`);
	for (const key of ["stage", "topic"] as const) {
		if (patch[key] !== undefined && typeof patch[key] !== "string") throw new Error(`profile state.${key} 必须是字符串`);
	}
	for (const key of ["covered", "pending"] as const) {
		if (patch[key] !== undefined && (!Array.isArray(patch[key]) || !patch[key].every((item) => typeof item === "string"))) {
			throw new Error(`profile state.${key} 必须是字符串数组`);
		}
	}
	return patch as Partial<JudgeMentorProgress>;
}

export function updateJudgeProgress(state: JudgeMentorState, key: string, partial: Partial<JudgeMentorProgress>): JudgeMentorProgress {
	const current = state.progressByProfile[key] ?? { stage: "", topic: "", covered: [], pending: [] };
	return state.progressByProfile[key] = {
		stage: partial.stage ?? current.stage,
		topic: partial.topic ?? current.topic,
		covered: partial.covered ?? current.covered,
		pending: partial.pending ?? current.pending,
	};
}

export function publicProblem(problem: JudgeProblemRecord | null): JudgeProblemCard | null {
	if (!problem) return null;
	return {
		id: problem.id,
		title: problem.title,
		difficulty: problem.difficulty,
		description: problem.description,
		inputFormat: problem.inputFormat,
		outputFormat: problem.outputFormat,
		constraints: [...problem.constraints],
		examples: problem.examples.map((example) => ({ ...example })),
		language: problem.language,
		starterCode: problem.starterCode,
		createdAt: problem.createdAt,
	};
}
