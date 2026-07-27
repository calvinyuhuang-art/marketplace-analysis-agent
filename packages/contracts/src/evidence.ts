import { z } from "zod";
import { AnalysisArea } from "./enums";

export const EvidenceSourceType = z.enum([
  "listing",
  "review",
  "qa",
  "search_result",
  "category_page",
  "policy_page",
  "diagnostic",
  "other"
]);
export type EvidenceSourceType = z.infer<typeof EvidenceSourceType>;

export const EvidenceProvenanceSchema = z.object({
  sourceUrl: z.string().min(1).optional(),
  collector: z.string().min(1),
  collectorVersion: z.string().min(1),
  observedAt: z.string().datetime(),
  collectedAt: z.string().datetime().optional(),
  rawSnapshotRef: z.string().optional()
});
export type EvidenceProvenance = z.infer<typeof EvidenceProvenanceSchema>;

/**
 * A single normalized evidence item. Text content is untrusted data and must
 * never override system/capability rules (prompt-injection safe by design).
 */
export const EvidenceItemSchema = z.object({
  evidenceId: z.string().min(1),
  sourceType: EvidenceSourceType,
  platform: z.string().min(1),
  marketplace: z.string().min(1),
  category: z.string().optional(),
  productType: z.string().optional(),
  subjectId: z.string().min(1),
  title: z.string().optional(),
  textContent: z.string().optional(),
  fields: z.record(z.string(), z.unknown()).default({}),
  confidence: z.number().min(0).max(1).default(1),
  provenance: EvidenceProvenanceSchema,
  contentHash: z.string().optional(),
  validationStatus: z
    .enum(["valid", "warning", "invalid"])
    .default("valid")
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const EvidencePackageInputSchema = z.object({
  packageId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  externalWorkOrderId: z.string().optional(),
  sourceClient: z.string().min(1),
  schemaVersion: z.string().min(1).default("1.0.0"),
  platform: z.string().min(1),
  marketplace: z.string().min(1),
  category: z.string().optional(),
  productType: z.string().optional(),
  items: z.array(EvidenceItemSchema).min(1),
  diagnostics: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});
export type EvidencePackageInput = z.infer<typeof EvidencePackageInputSchema>;

export const EvidenceRequirementResultSchema = z.object({
  requirementId: z.string(),
  description: z.string(),
  satisfied: z.boolean(),
  detail: z.string().optional()
});
export type EvidenceRequirementResult = z.infer<typeof EvidenceRequirementResultSchema>;

export const EvidenceGapSchema = z.object({
  gapId: z.string(),
  field: z.string(),
  description: z.string(),
  severity: z.enum(["low", "medium", "high", "critical"])
});
export type EvidenceGap = z.infer<typeof EvidenceGapSchema>;

export const AreaReadinessSchema = z.object({
  area: AnalysisArea,
  status: z.enum(["ready", "partial", "insufficient", "blocked"]),
  score: z.number().min(0).max(1),
  required: z.array(EvidenceRequirementResultSchema),
  availableEvidenceRefs: z.array(z.string()),
  gaps: z.array(EvidenceGapSchema),
  warnings: z.array(z.string()),
  allowedOutputLevel: z.enum(["complete", "limited", "none"])
});
export type AreaReadiness = z.infer<typeof AreaReadinessSchema>;

export const ReadinessReportSchema = z.object({
  runId: z.string().optional(),
  packageIds: z.array(z.string()),
  evaluatedAt: z.string().datetime(),
  overallStatus: z.enum(["ready", "partial", "insufficient", "blocked"]),
  areas: z.array(AreaReadinessSchema),
  readyAreas: z.array(AnalysisArea),
  blockedAreas: z.array(AnalysisArea),
  warnings: z.array(z.string())
});
export type ReadinessReport = z.infer<typeof ReadinessReportSchema>;

export const CollectionRequestSchema = z.object({
  collectionRequestId: z.string(),
  requestType: z.literal("supplemental_collection"),
  status: z.enum([
    "proposed",
    "accepted",
    "in_progress",
    "fulfilled",
    "unavailable",
    "cancelled"
  ]),
  priority: z.enum(["low", "medium", "high", "critical"]),
  platform: z.string().min(1),
  marketplace: z.string().min(1),
  targetSet: z.array(z.string()),
  requiredEvidence: z.array(z.string()).min(1),
  reason: z.string().min(1),
  analysisAreasBlocked: z.array(AnalysisArea),
  completionRule: z.object({
    minimumItems: z.number().int().nonnegative().optional(),
    minimumProducts: z.number().int().nonnegative().optional(),
    minimumReviews: z.number().int().nonnegative().optional(),
    requiredFields: z.array(z.string()).default([]),
    maximumAgeDays: z.number().int().positive().optional()
  }),
  suggestedCollectorCapability: z.string().optional(),
  runId: z.string().optional(),
  requestId: z.string().optional(),
  createdAt: z.string().datetime().optional()
});
export type CollectionRequest = z.infer<typeof CollectionRequestSchema>;

export const EvidencePackageResponseSchema = z.object({
  packageId: z.string(),
  projectId: z.string().nullable(),
  externalWorkOrderId: z.string().nullable(),
  sourceClient: z.string(),
  schemaVersion: z.string(),
  platform: z.string(),
  marketplace: z.string(),
  category: z.string().nullable(),
  productType: z.string().nullable(),
  status: z.string(),
  itemCount: z.number().int(),
  coverageSummary: z.record(z.string(), z.unknown()),
  contentHash: z.string(),
  packageArtifactId: z.string().nullable(),
  createdAt: z.string(),
  observedAt: z.string().nullable()
});
export type EvidencePackageResponse = z.infer<typeof EvidencePackageResponseSchema>;
