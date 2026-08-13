export interface AcademicCheckRequest<TSubject extends string = string> {
	subject: TSubject;
	type: string;
	prompt: string;
	answer: string;
	reference?: string;
}

export interface AcademicCheckResult {
	correct: boolean;
	feedback?: string;
}

/** Optional application-owned grader. Packs remain fully usable without one. */
export interface AcademicEvaluator<TSubject extends string = string> {
	check(request: AcademicCheckRequest<TSubject>): Promise<AcademicCheckResult> | AcademicCheckResult;
}
