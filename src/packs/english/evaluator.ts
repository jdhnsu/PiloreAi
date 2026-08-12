export interface EnglishCheckRequest { type: string; item: string; answer: string; reference?: string }
export interface EnglishCheckResult { correct: boolean; feedback?: string }
export interface EnglishEvaluator { check(request: EnglishCheckRequest): Promise<EnglishCheckResult> | EnglishCheckResult }
