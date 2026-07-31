import { z } from "zod";

export const WorkflowFeedbackStatus = z.enum([
  "detected",
  "notified",
  "resolution_proposed",
  "supplemental_attached",
  "revision_in_progress",
  "resolved",
  "partially_resolved",
  "unresolved",
  "abandoned"
]);
export type WorkflowFeedbackStatus = z.infer<typeof WorkflowFeedbackStatus>;

export const ResolutionAction = z.enum([
  "supplemental_collection",
  "human_evidence",
  "narrow_scope",
  "accept_bounded",
  "stop"
]);
export type ResolutionAction = z.infer<typeof ResolutionAction>;

export const ResolutionQuality = z.enum(["full", "partial", "ineffective"]);
export type ResolutionQuality = z.infer<typeof ResolutionQuality>;

export const CandidateLessonStatus = z.enum([
  "none",
  "proposed",
  "accepted",
  "rejected"
]);
export type CandidateLessonStatus = z.infer<typeof CandidateLessonStatus>;

/** Contract-only in N1 — persisted in N3. */
export const WorkflowFeedbackEventSchema = z.object({
  schemaVersion: z.literal("maa.workflow_feedback.v1"),
  workflowFeedbackId: z.string().min(1),
  status: WorkflowFeedbackStatus,
  projectId: z.string().min(1),
  externalWorkOrderId: z.string().optional(),
  sourceAgentId: z.string().min(1),
  discoveringAgentId: z.string().min(1),
  upstreamStepKey: z.string().min(1),
  downstreamStepKey: z.string().min(1),
  feedbackType: z.literal("late_evidence_gap"),
  gapFingerprint: z.string().min(1),
  gapFingerprintVersion: z.string().min(1),
  missingRequirement: z.record(z.string(), z.unknown()),
  originalArtifactIds: z.array(z.string()).default([]),
  collectionRequestIds: z.array(z.string()).default([]),
  experienceId: z.string().optional(),
  resolutionAction: ResolutionAction.optional(),
  supplementalEvidencePackageIds: z.array(z.string()).default([]),
  revisionRunId: z.string().optional(),
  resolutionQuality: ResolutionQuality.optional(),
  resolved: z.boolean().optional(),
  addedDurationMs: z.number().nonnegative().optional(),
  addedCostUsd: z.number().nonnegative().optional(),
  addedCollectionRounds: z.number().int().nonnegative().optional(),
  candidateLessonStatus: CandidateLessonStatus.default("none"),
  correlationId: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional()
});
export type WorkflowFeedbackEvent = z.infer<typeof WorkflowFeedbackEventSchema>;
