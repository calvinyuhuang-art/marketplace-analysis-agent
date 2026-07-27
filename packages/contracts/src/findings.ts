import { z } from "zod";
import { AnalysisArea } from "./enums";

export const FindingClassification = z.enum([
  "observed_fact",
  "source_reported_claim",
  "validated_memory",
  "inference",
  "assumption",
  "unknown"
]);
export type FindingClassification = z.infer<typeof FindingClassification>;

export const FindingValidationStatus = z.enum([
  "unreviewed",
  "system_validated",
  "reviewer_accepted",
  "reviewer_rejected",
  "superseded",
  "contested"
]);
export type FindingValidationStatus = z.infer<typeof FindingValidationStatus>;

export const ScopeSchema = z.object({
  platform: z.string().optional(),
  marketplace: z.string().optional(),
  category: z.string().optional(),
  productType: z.string().optional(),
  projectId: z.string().optional(),
  subjectIds: z.array(z.string()).default([])
});
export type Scope = z.infer<typeof ScopeSchema>;

export const FindingFreshnessSchema = z.object({
  status: z.enum(["current", "aging", "stale", "unknown"]),
  evaluatedAt: z.string().datetime(),
  oldestEvidenceAt: z.string().datetime().optional(),
  newestEvidenceAt: z.string().datetime().optional()
});
export type FindingFreshness = z.infer<typeof FindingFreshnessSchema>;

export const FindingSchema = z
  .object({
    findingId: z.string().min(1),
    statement: z.string().min(1),
    analysisArea: AnalysisArea,
    classification: FindingClassification,
    scope: ScopeSchema,
    evidenceRefs: z.array(z.string()).default([]),
    memoryRefs: z.array(z.string()).default([]),
    confidence: z.number().min(0).max(1),
    freshness: FindingFreshnessSchema,
    contradictions: z.array(z.string()).default([]),
    downstreamImplications: z.array(z.string()).default([]),
    validationStatus: FindingValidationStatus.default("unreviewed"),
    /** Optional tags used by deterministic reasoning gates. */
    tags: z.array(z.string()).default([])
  })
  .superRefine((value, ctx) => {
    if (
      (value.classification === "observed_fact" ||
        value.classification === "source_reported_claim") &&
      value.evidenceRefs.length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["evidenceRefs"],
        message: `${value.classification} requires at least one evidence reference`
      });
    }
    if (value.classification === "validated_memory" && value.memoryRefs.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["memoryRefs"],
        message: "validated_memory requires memory references"
      });
    }
  });
export type Finding = z.infer<typeof FindingSchema>;

export const AnalysisOutputSchema = z.object({
  schemaVersion: z.string().min(1),
  summary: z.string().min(1),
  readyAreasAnalyzed: z.array(AnalysisArea),
  blockedAreasSkipped: z.array(AnalysisArea),
  findings: z.array(FindingSchema),
  assumptions: z.array(z.string()).default([]),
  unknowns: z.array(z.string()).default([]),
  contradictions: z.array(z.string()).default([]),
  nextActions: z.array(z.string()).default([]),
  limitations: z.array(z.string()).default([])
});
export type AnalysisOutput = z.infer<typeof AnalysisOutputSchema>;

export const QualityIssueSchema = z.object({
  code: z.string(),
  severity: z.enum(["info", "warning", "error"]),
  gate: z.enum(["evidence", "structural", "reasoning", "decision_readiness"]),
  message: z.string(),
  findingId: z.string().optional(),
  path: z.string().optional()
});
export type QualityIssue = z.infer<typeof QualityIssueSchema>;

export const QualityReportSchema = z.object({
  passed: z.boolean(),
  score: z.number().min(0).max(1),
  issues: z.array(QualityIssueSchema),
  evaluatedAt: z.string().datetime()
});
export type QualityReport = z.infer<typeof QualityReportSchema>;

export const FindingReviewAction = z.enum([
  "accept",
  "reject",
  "request_revision",
  "mark_contested"
]);
export type FindingReviewAction = z.infer<typeof FindingReviewAction>;

export const FindingReviewReasonCode = z.enum([
  "unsupported_conclusion",
  "incorrect_evidence_interpretation",
  "missing_analysis",
  "wrong_scope",
  "stale_memory_or_evidence",
  "contradiction_ignored",
  "confidence_miscalibrated",
  "other"
]);
export type FindingReviewReasonCode = z.infer<typeof FindingReviewReasonCode>;

export const FindingReviewRequestSchema = z.object({
  action: FindingReviewAction,
  reasonCode: FindingReviewReasonCode.optional(),
  notes: z.string().optional(),
  reviewerId: z.string().min(1).default("operator")
});
export type FindingReviewRequest = z.infer<typeof FindingReviewRequestSchema>;

export const FindingResponseSchema = FindingSchema.extend({
  runId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type FindingResponse = z.infer<typeof FindingResponseSchema>;
