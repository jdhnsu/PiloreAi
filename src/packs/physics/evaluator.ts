import type { AcademicCheckRequest, AcademicCheckResult, AcademicEvaluator } from "../shared/academic/evaluator.js";

export type PhysicsCheckRequest = AcademicCheckRequest<"physics">;
export type PhysicsCheckResult = AcademicCheckResult;
export type PhysicsEvaluator = AcademicEvaluator<"physics">;
