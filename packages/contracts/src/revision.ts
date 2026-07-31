import { z } from "zod";
import { AnalysisArea } from "./enums";
import { FindingReviewReasonCode } from "./findings";

/** Run-level review actions (finding-level actions remain in findings.ts). */
export const RunReviewAction = z.enum([
  "accept_run",
  "reject_run",
  "request_revision"
]);
export type RunReviewAction = z.infer<typeof RunReviewAction>;

export const RunReviewRequestSchema = z.object({
  action: RunReviewAction,
  reasonCode: FindingReviewReasonCode.optional(),
  notes: z.string().optional(),
  reviewerId: z.string().min(1).default("operator")
});
export type RunReviewRequest = z.infer<typeof RunReviewRequestSchema>;

/**
 * Start a revision from a prior terminal run. Prior output stays immutable;
 * a new request+run is created with attempt linkage and optional supplemental evidence.
 */
export const CreateRevisionRequestSchema = z.object({
  reasonCode: FindingReviewReasonCode,
  notes: z.string().optional(),
  reviewerId: z.string().min(1).default("operator"),
  /**
   * Areas to re-analyze. When omitted, derived from contested/rejected findings
   * on the prior run, or all prior requested areas if none.
   */
  affectedAreas: z.array(AnalysisArea).optional(),
  /** Specific prior findings this revision targets (recorded in learning events). */
  findingIds: z.array(z.string().min(1)).optional(),
  /** Extra evidence packages to attach in addition to prior packages. */
  supplementalEvidencePackageIds: z.array(z.string().min(1)).default([]),
  /** Optional link to an open workflow feedback event (N3 late-gap loop). */
  workflowFeedbackId: z.string().min(1).optional(),
  /**
   * Full replacement evidence set. When omitted: prior packages ∪ supplemental.
   */
  evidencePackageIds: z.array(z.string().min(1)).optional(),
  question: z.string().optional(),
  idempotencyKey: z.string().min(1).optional(),
  timeoutSeconds: z.number().int().positive().optional()
});
export type CreateRevisionRequest = z.infer<typeof CreateRevisionRequestSchema>;

export const RevisionResponseSchema = z.object({
  priorRunId: z.string(),
  requestId: z.string(),
  runId: z.string(),
  projectId: z.string(),
  attemptNumber: z.number().int(),
  affectedAreas: z.array(AnalysisArea),
  evidencePackageIds: z.array(z.string()),
  learningEventId: z.string(),
  statusUrl: z.string(),
  createdAt: z.string()
});
export type RevisionResponse = z.infer<typeof RevisionResponseSchema>;

export const LearningEventType = z.enum([
  "finding_accepted",
  "finding_rejected",
  "finding_contested",
  "revision_requested",
  "revision_completed",
  "run_accepted",
  "run_rejected"
]);
export type LearningEventType = z.infer<typeof LearningEventType>;

/** M4 records learning events only — no reusable promotion. */
export const LearningPromotionStatus = z.enum(["recorded", "candidate", "promoted", "rejected"]);
export type LearningPromotionStatus = z.infer<typeof LearningPromotionStatus>;

export const LearningEventSchema = z.object({
  learningEventId: z.string(),
  projectId: z.string(),
  eventType: LearningEventType,
  reasonCode: FindingReviewReasonCode.optional(),
  notes: z.string().optional(),
  sourceRunId: z.string().optional(),
  sourceFindingId: z.string().optional(),
  revisionRunId: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  promotionStatus: LearningPromotionStatus.default("recorded"),
  createdAt: z.string().datetime()
});
export type LearningEvent = z.infer<typeof LearningEventSchema>;

export const FindingDiffEntrySchema = z.object({
  analysisArea: AnalysisArea,
  priorFindingId: z.string().optional(),
  newFindingId: z.string().optional(),
  change: z.enum(["added", "removed", "replaced", "unchanged"]),
  priorStatement: z.string().optional(),
  newStatement: z.string().optional()
});
export type FindingDiffEntry = z.infer<typeof FindingDiffEntrySchema>;

export const RevisionDiffSchema = z.object({
  priorRunId: z.string(),
  revisionRunId: z.string(),
  affectedAreas: z.array(AnalysisArea),
  entries: z.array(FindingDiffEntrySchema),
  evaluatedAt: z.string().datetime()
});
export type RevisionDiff = z.infer<typeof RevisionDiffSchema>;
