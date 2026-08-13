import type { AcademicCheckRequest, AcademicCheckResult, AcademicEvaluator } from "../shared/academic/evaluator.js";

export type HistoryCheckRequest = AcademicCheckRequest<"history">;
export type HistoryCheckResult = AcademicCheckResult;
export type HistoryEvaluator = AcademicEvaluator<"history">;
