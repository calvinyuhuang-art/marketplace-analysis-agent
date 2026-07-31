import { z } from "zod";

export const EvaluatorType = z.enum([
  "deterministic",
  "model",
  "research_orchestrator",
  "human",
  "outcome"
]);
export type EvaluatorType = z.infer<typeof EvaluatorType>;

export const EvaluationSourceSystem = z.enum([
  "maa.learning_events",
  "maa.finding_reviews",
  "maa.run_reviews",
  "maa.outcome_reviews",
  "maa.deterministic",
  "maa.model",
  "research_team",
  "maa.outcome_reassess"
]);
export type EvaluationSourceSystem = z.infer<typeof EvaluationSourceSystem>;

export const AgentEvaluationSchema = z.object({
  evaluationId: z.string().min(1),
  experienceId: z.string().min(1),
  evaluatorType: EvaluatorType,
  rubricVersion: z.string().min(1),
  decision: z.string().min(1),
  scores: z.record(z.string(), z.unknown()).default({}),
  confidence: z.number().min(0).max(1).optional(),
  feedbackArtifactId: z.string().nullable().optional(),
  sourceSystem: EvaluationSourceSystem,
  sourceRecordId: z.string().min(1),
  createdAt: z.string().datetime()
});
export type AgentEvaluation = z.infer<typeof AgentEvaluationSchema>;

export const RecordEvaluationInputSchema = z.object({
  experienceId: z.string().min(1),
  evaluatorType: EvaluatorType,
  rubricVersion: z.string().min(1).default("v1"),
  decision: z.string().min(1),
  scores: z.record(z.string(), z.unknown()).default({}),
  confidence: z.number().min(0).max(1).optional(),
  feedbackArtifactId: z.string().nullable().optional(),
  sourceSystem: EvaluationSourceSystem,
  sourceRecordId: z.string().min(1)
});
export type RecordEvaluationInput = z.infer<typeof RecordEvaluationInputSchema>;

/** Stable serialization for UNIQUE (experience_id, evaluator_type, rubric_version, source_system, source_record_id). */
export function evaluationIdempotencyKey(input: {
  experienceId: string;
  evaluatorType: string;
  rubricVersion: string;
  sourceSystem: string;
  sourceRecordId: string;
}): string {
  return [
    input.experienceId,
    input.evaluatorType,
    input.rubricVersion,
    input.sourceSystem,
    input.sourceRecordId
  ].join("|");
}
