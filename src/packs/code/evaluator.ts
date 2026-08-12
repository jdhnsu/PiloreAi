export interface CodeEvaluation { score?: number; summary?: string; details?: unknown }
export interface CodeEvaluator { evaluate(input: { files: Record<string, string>; entry?: string }): Promise<CodeEvaluation> | CodeEvaluation }
