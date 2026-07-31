import { z } from "zod";
import { AnalysisArea } from "./enums";
import { FindingReviewReasonCode } from "./findings";

/** Outcome review is separate from finding/run accept — does not invent causal truth. */
export const OutcomeReviewJudgment = z.enum([
  "helpful",
  "harmful",
  "neutral",
  "insufficient_to_judge"
]);
export type OutcomeReviewJudgment = z.infer<typeof OutcomeReviewJudgment>;

export const OutcomeReviewRequestSchema = z.object({
  judgment: OutcomeReviewJudgment,
  notes: z.string().optional(),
  reviewerId: z.string().min(1).default("operator"),
  /** Explicitly opt in to create a lesson candidate; acceptance alone never does. */
  proposeLesson: z.boolean().default(false)
});
export type OutcomeReviewRequest = z.infer<typeof OutcomeReviewRequestSchema>;

export const OutcomeReviewSchema = z.object({
  outcomeReviewId: z.string(),
  projectId: z.string(),
  runId: z.string(),
  judgment: OutcomeReviewJudgment,
  notes: z.string().optional(),
  reviewerId: z.string(),
  lessonCandidateId: z.string().optional(),
  createdAt: z.string().datetime()
});
export type OutcomeReview = z.infer<typeof OutcomeReviewSchema>;

export const LessonCandidateStatus = z.enum([
  "proposed",
  "approved",
  "rejected",
  "deferred"
]);
export type LessonCandidateStatus = z.infer<typeof LessonCandidateStatus>;

export const LessonCandidateSchema = z.object({
  lessonCandidateId: z.string(),
  projectId: z.string(),
  learningEventId: z.string().optional(),
  sourceRunId: z.string().optional(),
  sourceFindingId: z.string().optional(),
  actionTaken: z.string(),
  observedOutcome: z.string(),
  reviewerJudgment: z.string(),
  proposedRootCause: z.string(),
  correctiveAction: z.string(),
  scope: z.record(z.string(), z.string()).default({}),
  analysisAreas: z.array(AnalysisArea).default([]),
  causeConfidence: z.number().min(0).max(1),
  supportCount: z.number().int().nonnegative().default(1),
  status: LessonCandidateStatus.default("proposed"),
  errorBookEntryId: z.string().optional(),
  proceduralRuleId: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type LessonCandidate = z.infer<typeof LessonCandidateSchema>;

export const LessonReviewRequestSchema = z.object({
  action: z.enum(["approve", "reject", "defer"]),
  notes: z.string().optional(),
  reviewerId: z.string().min(1).default("operator"),
  /** When approving, optionally activate the linked procedural rule proposal. */
  activateProceduralRule: z.boolean().default(true)
});
export type LessonReviewRequest = z.infer<typeof LessonReviewRequestSchema>;

export const ErrorClass = z.enum([
  "unsupported_customer_claim",
  "evidence_misuse",
  "scope_mistake",
  "stale_memory_mistake",
  "retrieval_failure",
  "format_mixing",
  "other"
]);
export type ErrorClass = z.infer<typeof ErrorClass>;

export const RecurrenceStatus = z.enum([
  "first_seen",
  "recurring",
  "monitoring",
  "resolved"
]);
export type RecurrenceStatus = z.infer<typeof RecurrenceStatus>;

export const ErrorBookEntrySchema = z.object({
  errorBookEntryId: z.string(),
  errorClass: ErrorClass,
  title: z.string(),
  unsafeBehaviorPattern: z.string(),
  context: z.string(),
  rootCause: z.string(),
  correction: z.string(),
  severity: z.enum(["low", "medium", "high"]).default("medium"),
  occurrenceCount: z.number().int().positive().default(1),
  lastOccurrenceAt: z.string().datetime(),
  recurrenceStatus: RecurrenceStatus.default("first_seen"),
  projectId: z.string().optional(),
  platform: z.string().optional(),
  marketplace: z.string().optional(),
  category: z.string().optional(),
  productType: z.string().optional(),
  analysisAreas: z.array(AnalysisArea).default([]),
  affectedCapabilityVersions: z.array(z.string()).default([]),
  regressionTestIds: z.array(z.string()).default([]),
  linkedLearningEventIds: z.array(z.string()).default([]),
  linkedProceduralRuleIds: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type ErrorBookEntry = z.infer<typeof ErrorBookEntrySchema>;

export const ProceduralRuleStatus = z.enum([
  "proposed",
  "active",
  "rejected",
  "retired"
]);
export type ProceduralRuleStatus = z.infer<typeof ProceduralRuleStatus>;

export const ProceduralRuleSchema = z.object({
  proceduralRuleId: z.string(),
  version: z.number().int().positive().default(1),
  title: z.string(),
  statement: z.string(),
  status: ProceduralRuleStatus.default("proposed"),
  authority: z.enum(["procedural_proposed", "procedural_active"]).default("procedural_proposed"),
  analysisAreas: z.array(AnalysisArea).default([]),
  platform: z.string().optional(),
  marketplace: z.string().optional(),
  category: z.string().optional(),
  productType: z.string().optional(),
  projectId: z.string().optional(),
  errorBookEntryId: z.string().optional(),
  lessonCandidateId: z.string().optional(),
  learningEventIds: z.array(z.string()).default([]),
  regressionTestIds: z.array(z.string()).default([]),
  /** When true, blocked customer_evidence must emit collection request — never invent prefs. */
  requireDirectCustomerEvidence: z.boolean().default(false),
  approvedBy: z.string().optional(),
  approvedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type ProceduralRule = z.infer<typeof ProceduralRuleSchema>;

export const ProceduralRuleReviewRequestSchema = z.object({
  action: z.enum(["approve", "reject", "retire"]),
  notes: z.string().optional(),
  reviewerId: z.string().min(1).default("operator")
});
export type ProceduralRuleReviewRequest = z.infer<typeof ProceduralRuleReviewRequestSchema>;

export const MemoryEvaluationJudgment = z.enum(["helpful", "harmful", "irrelevant"]);
export type MemoryEvaluationJudgment = z.infer<typeof MemoryEvaluationJudgment>;

export const MemoryEvaluationRequestSchema = z.object({
  memoryId: z.string().min(1),
  runId: z.string().min(1).optional(),
  judgment: MemoryEvaluationJudgment,
  notes: z.string().optional(),
  reviewerId: z.string().min(1).default("operator")
});
export type MemoryEvaluationRequest = z.infer<typeof MemoryEvaluationRequestSchema>;

export const MemoryEvaluationSchema = z.object({
  evaluationId: z.string(),
  memoryId: z.string(),
  projectId: z.string(),
  runId: z.string().optional(),
  judgment: MemoryEvaluationJudgment,
  notes: z.string().optional(),
  reviewerId: z.string(),
  createdAt: z.string().datetime()
});
export type MemoryEvaluation = z.infer<typeof MemoryEvaluationSchema>;

export const ProceduralRulePromptItemSchema = z.object({
  proceduralRuleId: z.string(),
  title: z.string(),
  statement: z.string(),
  analysisAreas: z.array(AnalysisArea).default([]),
  requireDirectCustomerEvidence: z.boolean().default(false),
  /** Present when item comes from the typed procedural registry (N4+). */
  ruleType: z.string().optional(),
  versionId: z.string().optional()
});
export type ProceduralRulePromptItem = z.infer<typeof ProceduralRulePromptItemSchema>;

/** Map finding reject reason → Error Book class. */
export function errorClassFromReason(
  reasonCode: z.infer<typeof FindingReviewReasonCode> | undefined,
  analysisArea?: string
): z.infer<typeof ErrorClass> {
  if (reasonCode === "unsupported_conclusion" && analysisArea === "customer_evidence") {
    return "unsupported_customer_claim";
  }
  if (reasonCode === "unsupported_conclusion") return "evidence_misuse";
  if (reasonCode === "incorrect_evidence_interpretation") return "evidence_misuse";
  if (reasonCode === "wrong_scope") return "scope_mistake";
  if (reasonCode === "stale_memory_or_evidence") return "stale_memory_mistake";
  if (reasonCode === "contradiction_ignored") return "other";
  return "other";
}
