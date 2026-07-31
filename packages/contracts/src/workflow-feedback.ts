import { z } from "zod";
import {
  ResolutionAction,
  ResolutionQuality,
  WorkflowFeedbackStatus
} from "@maa/agent-memory-contracts";

export { ResolutionAction, ResolutionQuality, WorkflowFeedbackStatus };

export const ResolveWorkflowFeedbackSchema = z.object({
  resolutionAction: ResolutionAction,
  supplementalEvidencePackageIds: z.array(z.string().min(1)).default([]),
  notes: z.string().optional(),
  actorId: z.string().min(1).default("research-team")
});
export type ResolveWorkflowFeedback = z.infer<typeof ResolveWorkflowFeedbackSchema>;

export const WorkflowFeedbackResponseSchema = z.object({
  workflowFeedbackId: z.string(),
  status: WorkflowFeedbackStatus,
  projectId: z.string(),
  runId: z.string(),
  requestId: z.string(),
  experienceId: z.string().nullable().optional(),
  feedbackType: z.literal("late_evidence_gap"),
  gapFingerprintId: z.string(),
  gapFingerprintKey: z.string().optional(),
  missingRequirement: z.record(z.string(), z.unknown()),
  collectionRequestIds: z.array(z.string()),
  resolutionAction: ResolutionAction.nullable().optional(),
  supplementalEvidencePackageIds: z.array(z.string()),
  revisionRunId: z.string().nullable().optional(),
  resolutionQuality: ResolutionQuality.nullable().optional(),
  resolved: z.boolean().nullable().optional(),
  addedDurationMs: z.number().nullable().optional(),
  addedCostUsd: z.number().nullable().optional(),
  addedCollectionRounds: z.number().nullable().optional(),
  candidateLessonStatus: z.string(),
  projectWarning: z.boolean().optional(),
  detectedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable().optional()
});
export type WorkflowFeedbackResponse = z.infer<typeof WorkflowFeedbackResponseSchema>;
