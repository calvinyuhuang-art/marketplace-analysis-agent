import { z } from "zod";
import { ReassessmentJudgment } from "@maa/agent-memory-contracts";
import { CapabilityRefSchema } from "./analysis";

export { ReassessmentJudgment };

export const IngestOutcomeRequestSchema = z.object({
  projectId: z.string().min(1),
  eventType: z.string().min(1),
  measurementWindow: z
    .object({
      start: z.string().datetime().optional(),
      end: z.string().datetime().optional()
    })
    .optional(),
  metrics: z.record(z.string(), z.unknown()).default({}),
  source: z.string().min(1).default("research_team"),
  confidence: z.number().min(0).max(1).optional(),
  linkedArtifactIds: z.array(z.string().min(1)).default([]),
  linkedFindingIds: z.array(z.string().min(1)).default([]),
  linkedExperienceId: z.string().min(1).optional(),
  linkedRunId: z.string().min(1).optional(),
  occurredAt: z.string().datetime()
});
export type IngestOutcomeRequest = z.infer<typeof IngestOutcomeRequestSchema>;

export const OutcomeEventResponseSchema = z.object({
  schemaVersion: z.literal("maa.outcome_event.v1"),
  outcomeId: z.string(),
  projectId: z.string(),
  eventType: z.string(),
  measurementWindow: z
    .object({
      start: z.string().datetime().optional(),
      end: z.string().datetime().optional()
    })
    .optional(),
  metrics: z.record(z.string(), z.unknown()),
  source: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  linkedArtifactIds: z.array(z.string()),
  linkedFindingIds: z.array(z.string()),
  linkedExperienceId: z.string().optional(),
  linkedRunId: z.string().optional(),
  occurredAt: z.string().datetime(),
  receivedAt: z.string().datetime(),
  createdAt: z.string().datetime()
});
export type OutcomeEventResponse = z.infer<typeof OutcomeEventResponseSchema>;

export const ReassessOutcomeRequestSchema = z.object({
  client: z.string().min(1).default("research-team"),
  capability: CapabilityRefSchema.optional(),
  experienceId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional(),
  actorId: z.string().min(1).default("research-team")
});
export type ReassessOutcomeRequest = z.infer<typeof ReassessOutcomeRequestSchema>;

export const OutcomeJudgmentResponseSchema = z.object({
  findingId: z.string().optional(),
  judgment: ReassessmentJudgment,
  rationale: z.string()
});
export type OutcomeJudgmentResponse = z.infer<typeof OutcomeJudgmentResponseSchema>;

export const OutcomeReassessmentResponseSchema = z.object({
  schemaVersion: z.literal("maa.outcome_reassessment.v1"),
  reassessmentId: z.string(),
  outcomeId: z.string(),
  experienceId: z.string().optional(),
  runId: z.string().optional(),
  judgments: z.array(OutcomeJudgmentResponseSchema),
  reportArtifactId: z.string(),
  lessonCandidateIds: z.array(z.string()).default([]),
  priorOutputArtifactId: z.string().optional(),
  createdAt: z.string().datetime()
});
export type OutcomeReassessmentResponse = z.infer<
  typeof OutcomeReassessmentResponseSchema
>;
