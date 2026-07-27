import { z } from "zod";
import { AnalysisArea } from "./enums";
import { MemoryScopeSchema } from "./memory";

export const MemoryProposalType = z.enum([
  "reuse_accepted_finding",
  "reuse_project_memory",
  "category_semantic",
  "supersession"
]);
export type MemoryProposalType = z.infer<typeof MemoryProposalType>;

export const MemoryProposalStatus = z.enum([
  "proposed",
  "approved",
  "rejected",
  "superseded",
  "withdrawn"
]);
export type MemoryProposalStatus = z.infer<typeof MemoryProposalStatus>;

export const MemoryConflictSchema = z.object({
  memoryId: z.string(),
  statement: z.string(),
  relation: z.enum(["possible_duplicate", "possible_contradiction", "overlapping_scope"]),
  score: z.number().min(0).max(1)
});
export type MemoryConflict = z.infer<typeof MemoryConflictSchema>;

export const CreateMemoryProposalSchema = z
  .object({
    proposalType: MemoryProposalType.default("reuse_accepted_finding"),
    projectId: z.string().min(1),
    sourceMemoryId: z.string().min(1).optional(),
    sourceFindingId: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    statement: z.string().min(1).optional(),
    summary: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    reason: z.string().min(1),
    analysisArea: AnalysisArea.optional(),
    scopes: z.array(MemoryScopeSchema).optional(),
    evidenceIds: z.array(z.string()).default([]),
    /** Optional expiration for the reusable knowledge once approved. */
    validUntil: z.string().datetime().optional(),
    proposedBy: z.string().min(1).default("operator")
  })
  .superRefine((value, ctx) => {
    if (!value.sourceMemoryId && !value.sourceFindingId && !value.statement) {
      ctx.addIssue({
        code: "custom",
        message: "Provide sourceMemoryId, sourceFindingId, or an explicit statement."
      });
    }
  });
export type CreateMemoryProposal = z.infer<typeof CreateMemoryProposalSchema>;

export const MemoryProposalReviewRequestSchema = z.object({
  action: z.enum(["approve", "reject", "supersede", "withdraw"]),
  notes: z.string().optional(),
  reviewerId: z.string().min(1).default("operator"),
  /** When superseding, the prior reusable memory to mark superseded. */
  supersedesMemoryId: z.string().min(1).optional(),
  /** Override expiration on approve. */
  validUntil: z.string().datetime().optional()
});
export type MemoryProposalReviewRequest = z.infer<typeof MemoryProposalReviewRequestSchema>;

export const MemoryProposalSchema = z.object({
  proposalId: z.string(),
  proposalType: MemoryProposalType,
  status: MemoryProposalStatus,
  projectId: z.string(),
  sourceMemoryId: z.string().optional(),
  sourceFindingId: z.string().optional(),
  title: z.string(),
  statement: z.string(),
  summary: z.string().optional(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  scopes: z.array(MemoryScopeSchema).default([]),
  evidenceIds: z.array(z.string()).default([]),
  conflicts: z.array(MemoryConflictSchema).default([]),
  proposedAuthority: z.literal("reusable_approved"),
  validUntil: z.string().datetime().optional(),
  resultingMemoryId: z.string().optional(),
  proposedBy: z.string(),
  reviewedBy: z.string().optional(),
  reviewedAt: z.string().datetime().optional(),
  reviewNotes: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type MemoryProposal = z.infer<typeof MemoryProposalSchema>;
