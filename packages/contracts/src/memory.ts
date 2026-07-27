import { z } from "zod";
import { AnalysisArea } from "./enums";

export const MemoryType = z.enum([
  "project_state",
  "accepted_finding",
  "failure_correction",
  "working_note",
  "episodic",
  "procedural",
  "reusable_semantic"
]);
export type MemoryType = z.infer<typeof MemoryType>;

export const MemoryAuthorityStatus = z.enum([
  "raw_record",
  "project_working",
  "reviewed_project",
  "reusable_proposed",
  "reusable_approved",
  "procedural_proposed",
  "procedural_active",
  "rejected",
  "contested",
  "superseded",
  "expired"
]);
export type MemoryAuthorityStatus = z.infer<typeof MemoryAuthorityStatus>;

export const MemoryScopeDimension = z.enum([
  "platform",
  "marketplace",
  "geography",
  "category",
  "product_type",
  "subcategory",
  "project",
  "product",
  "analysis_area",
  "evidence_type",
  "capability_version",
  "time_period"
]);
export type MemoryScopeDimension = z.infer<typeof MemoryScopeDimension>;

export const MemoryScopeSchema = z.object({
  dimension: MemoryScopeDimension,
  value: z.string().min(1)
});
export type MemoryScope = z.infer<typeof MemoryScopeSchema>;

export const MemoryLinkSupportType = z.enum([
  "supports",
  "contradicts",
  "supersedes",
  "derived_from",
  "reaffirms"
]);
export type MemoryLinkSupportType = z.infer<typeof MemoryLinkSupportType>;

export const MemoryItemSchema = z.object({
  memoryId: z.string().min(1),
  memoryType: MemoryType,
  authorityStatus: MemoryAuthorityStatus,
  title: z.string().min(1),
  statement: z.string().min(1),
  summary: z.string().optional(),
  confidence: z.number().min(0).max(1),
  supportCount: z.number().int().nonnegative().default(0),
  contradictionCount: z.number().int().nonnegative().default(0),
  scopes: z.array(MemoryScopeSchema).default([]),
  evidenceIds: z.array(z.string()).default([]),
  findingIds: z.array(z.string()).default([]),
  createdFromRunId: z.string().optional(),
  createdFromLearningEventId: z.string().optional(),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional(),
  lastReaffirmedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type MemoryItem = z.infer<typeof MemoryItemSchema>;

export const RankComponentScoresSchema = z.object({
  scopeMatch: z.number(),
  authorityWeight: z.number(),
  textRelevance: z.number(),
  freshness: z.number(),
  confidence: z.number(),
  supportStrength: z.number(),
  demonstratedUsefulness: z.number(),
  stalenessPenalty: z.number(),
  contradictionPenalty: z.number(),
  broadScopePenalty: z.number()
});
export type RankComponentScores = z.infer<typeof RankComponentScoresSchema>;

export const MemoryCandidateSchema = z.object({
  memoryId: z.string(),
  selected: z.boolean(),
  finalRank: z.number().optional(),
  score: z.number(),
  components: RankComponentScoresSchema,
  omitReason: z.string().optional()
});
export type MemoryCandidate = z.infer<typeof MemoryCandidateSchema>;

export const MemoryRetrievalTraceSchema = z.object({
  retrievalEventId: z.string(),
  runId: z.string(),
  projectId: z.string(),
  query: z.string(),
  filters: z.record(z.string(), z.unknown()).default({}),
  candidates: z.array(MemoryCandidateSchema),
  selectedMemoryIds: z.array(z.string()),
  contextAssemblyId: z.string().optional(),
  createdAt: z.string().datetime()
});
export type MemoryRetrievalTrace = z.infer<typeof MemoryRetrievalTraceSchema>;

export const ContextAssemblySchema = z.object({
  assemblyId: z.string(),
  runId: z.string(),
  analysisAreas: z.array(AnalysisArea),
  tokenBudget: z.number().int().positive(),
  sections: z.array(
    z.object({
      name: z.string(),
      tokenEstimate: z.number().int().nonnegative(),
      budgetShare: z.number(),
      memoryIds: z.array(z.string()).default([]),
      content: z.unknown()
    })
  ),
  selectedMemoryIds: z.array(z.string()),
  omitted: z.array(z.object({ memoryId: z.string(), reason: z.string() })).default([]),
  artifactId: z.string().optional(),
  createdAt: z.string().datetime()
});
export type ContextAssembly = z.infer<typeof ContextAssemblySchema>;

/** Compact memory excerpt passed into the model prompt. */
export const MemoryPromptItemSchema = z.object({
  memoryId: z.string(),
  memoryType: MemoryType,
  authorityStatus: MemoryAuthorityStatus,
  title: z.string(),
  statement: z.string(),
  analysisArea: z.string().optional(),
  confidence: z.number()
});
export type MemoryPromptItem = z.infer<typeof MemoryPromptItemSchema>;
