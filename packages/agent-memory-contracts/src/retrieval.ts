import { z } from "zod";
import { MemoryAuthority } from "./authority.js";
import { MemoryScopeSchema } from "./scope.js";

export const RetrievalRequestSchema = z.object({
  projectId: z.string().min(1),
  operation: z.string().optional(),
  analysisAreas: z.array(z.string()).default([]),
  scope: MemoryScopeSchema.optional(),
  tokenBudget: z.number().int().positive().optional(),
  query: z.string().optional()
});
export type RetrievalRequest = z.infer<typeof RetrievalRequestSchema>;

export const RetrievedMemoryItemSchema = z.object({
  memoryId: z.string(),
  title: z.string().optional(),
  authority: MemoryAuthority,
  score: z.number().optional(),
  reason: z.string().optional()
});
export type RetrievedMemoryItem = z.infer<typeof RetrievedMemoryItemSchema>;

export const RetrievedMemoryBundleSchema = z.object({
  selected: z.array(RetrievedMemoryItemSchema),
  omitted: z.array(RetrievedMemoryItemSchema).default([]),
  tokenEstimate: z.number().nonnegative().optional(),
  rankingPolicyVersion: z.string().optional()
});
export type RetrievedMemoryBundle = z.infer<typeof RetrievedMemoryBundleSchema>;

export const MemoryUsageAssessment = z.enum([
  "cited",
  "used",
  "ignored",
  "helpful",
  "harmful",
  "stale",
  "irrelevant"
]);
export type MemoryUsageAssessment = z.infer<typeof MemoryUsageAssessment>;
