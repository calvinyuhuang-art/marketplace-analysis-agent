import { z } from "zod";

/** Contract-only in N1 — persisted in N5. */
export const OutcomeEventSchema = z.object({
  schemaVersion: z.literal("maa.outcome_event.v1"),
  outcomeId: z.string().min(1),
  projectId: z.string().min(1),
  eventType: z.string().min(1),
  measurementWindow: z
    .object({
      start: z.string().datetime().optional(),
      end: z.string().datetime().optional()
    })
    .optional(),
  metrics: z.record(z.string(), z.unknown()).default({}),
  source: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  linkedArtifactIds: z.array(z.string()).default([]),
  linkedFindingIds: z.array(z.string()).default([]),
  occurredAt: z.string().datetime(),
  receivedAt: z.string().datetime()
});
export type OutcomeEvent = z.infer<typeof OutcomeEventSchema>;

export const ReassessmentJudgment = z.enum([
  "supported",
  "contradicted",
  "overconfident",
  "limitation_disclosed_ok",
  "inconclusive_traffic_or_execution",
  "outside_maa_responsibility",
  "causal_attribution_impossible"
]);
export type ReassessmentJudgment = z.infer<typeof ReassessmentJudgment>;

export const OutcomeReassessmentSchema = z.object({
  schemaVersion: z.literal("maa.outcome_reassessment.v1"),
  outcomeId: z.string().min(1),
  experienceId: z.string().optional(),
  judgments: z.array(
    z.object({
      findingId: z.string().optional(),
      judgment: ReassessmentJudgment,
      rationale: z.string()
    })
  ),
  createdAt: z.string().datetime()
});
export type OutcomeReassessment = z.infer<typeof OutcomeReassessmentSchema>;
