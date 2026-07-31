import { z } from "zod";
import { AnalysisArea } from "./enums";
import { CapabilityRefSchema } from "./analysis";
import {
  COLLECTOR_SNAPSHOT_SCHEMA,
  CollectorCapabilitySnapshotSchema
} from "@maa/agent-memory-contracts";

export { COLLECTOR_SNAPSHOT_SCHEMA, CollectorCapabilitySnapshotSchema };

export const EvidencePlanStatus = z.enum(["draft", "submitted", "reviewed"]);
export type EvidencePlanStatus = z.infer<typeof EvidencePlanStatus>;

export const EvidencePlanDecision = z.enum([
  "suitable",
  "suitable_with_corrections",
  "unsuitable"
]);
export type EvidencePlanDecision = z.infer<typeof EvidencePlanDecision>;

export const RegisterCollectorSnapshotSchema = CollectorCapabilitySnapshotSchema;
export type RegisterCollectorSnapshot = z.infer<typeof RegisterCollectorSnapshotSchema>;

export const CreateEvidencePlanSchema = z.object({
  planId: z.string().min(1).optional(),
  projectId: z.string().min(1),
  client: z.string().min(1),
  capability: CapabilityRefSchema,
  requestedAnalysis: z.array(AnalysisArea).min(1),
  /** Fields required per evidence type, e.g. { listing: ["price","binding","format"] }. */
  requiredFields: z.record(z.string(), z.array(z.string().min(1)).min(1)).refine(
    (v) => Object.keys(v).length > 0,
    { message: "requiredFields must include at least one evidence type" }
  ),
  collectorCapabilitySnapshotArtifactId: z.string().min(1),
  /** Client-echo of artifact content hash; must match stored artifact. */
  collectorCapabilitySnapshotHash: z.string().min(1),
  budget: z
    .object({
      maxItems: z.number().int().positive().optional(),
      maxCostUsd: z.number().nonnegative().optional()
    })
    .optional(),
  notes: z.string().optional()
});
export type CreateEvidencePlan = z.infer<typeof CreateEvidencePlanSchema>;

export const EvidencePlanResponseSchema = z.object({
  planId: z.string(),
  planVersion: z.number().int().positive(),
  projectId: z.string(),
  client: z.string(),
  status: EvidencePlanStatus,
  capability: CapabilityRefSchema,
  requestedAnalysis: z.array(AnalysisArea),
  requiredFields: z.record(z.string(), z.array(z.string())),
  budget: z
    .object({
      maxItems: z.number().int().positive().optional(),
      maxCostUsd: z.number().nonnegative().optional()
    })
    .nullable()
    .optional(),
  collectorCapabilitySnapshotArtifactId: z.string(),
  collectorCapabilitySnapshotHash: z.string(),
  notes: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type EvidencePlanResponse = z.infer<typeof EvidencePlanResponseSchema>;

export const ReviewEvidencePlanRequestSchema = z.object({
  client: z.string().min(1).default("research-team"),
  reviewerId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional()
});
export type ReviewEvidencePlanRequest = z.infer<typeof ReviewEvidencePlanRequestSchema>;

export const EvidencePlanReviewIssueSchema = z.object({
  code: z.string(),
  severity: z.enum(["error", "warning"]),
  path: z.string(),
  message: z.string()
});
export type EvidencePlanReviewIssue = z.infer<typeof EvidencePlanReviewIssueSchema>;

export const EvidencePlanReviewReportSchema = z.object({
  planId: z.string(),
  planVersion: z.number().int(),
  decision: EvidencePlanDecision,
  issues: z.array(EvidencePlanReviewIssueSchema),
  collectorCapabilitySnapshotArtifactId: z.string(),
  collectorCapabilitySnapshotHash: z.string(),
  reviewedAt: z.string().datetime()
});
export type EvidencePlanReviewReport = z.infer<typeof EvidencePlanReviewReportSchema>;

export const EvidencePlanReviewResponseSchema = z.object({
  reviewId: z.string(),
  planId: z.string(),
  planVersion: z.number().int(),
  runId: z.string(),
  requestId: z.string(),
  decision: EvidencePlanDecision,
  report: EvidencePlanReviewReportSchema,
  reportArtifactId: z.string().nullable().optional(),
  statusUrl: z.string(),
  createdAt: z.string().datetime()
});
export type EvidencePlanReviewResponse = z.infer<typeof EvidencePlanReviewResponseSchema>;

export const CollectorSnapshotResponseSchema = z.object({
  artifactId: z.string(),
  contentHash: z.string(),
  schemaVersion: z.literal(COLLECTOR_SNAPSHOT_SCHEMA),
  collector: z.string(),
  collectorVersion: z.string(),
  capturedAt: z.string().datetime(),
  createdAt: z.string().datetime()
});
export type CollectorSnapshotResponse = z.infer<typeof CollectorSnapshotResponseSchema>;
