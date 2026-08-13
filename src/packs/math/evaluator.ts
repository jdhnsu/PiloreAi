import type { AcademicCheckRequest, AcademicCheckResult, AcademicEvaluator } from "../shared/academic/evaluator.js";

export type MathCheckRequest = AcademicCheckRequest<"math">;
export type MathCheckResult = AcademicCheckResult;
export type MathEvaluator = AcademicEvaluator<"math">;
