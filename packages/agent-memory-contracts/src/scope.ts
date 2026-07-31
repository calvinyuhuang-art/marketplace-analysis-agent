import { z } from "zod";

export const MemoryScopeSchema = z.object({
  agentOwner: z.string().optional(),
  projectId: z.string().optional(),
  productId: z.string().optional(),
  platform: z.string().optional(),
  marketplace: z.string().optional(),
  category: z.string().optional(),
  productType: z.string().optional(),
  subcategory: z.string().optional(),
  workflow: z.string().optional(),
  taskType: z.string().optional(),
  analysisArea: z.string().optional(),
  geography: z.string().optional(),
  customerSegment: z.string().optional(),
  timePeriod: z.string().optional(),
  capabilityVersion: z.string().optional(),
  promptVersion: z.string().optional(),
  modelProfile: z.string().optional()
});
export type MemoryScope = z.infer<typeof MemoryScopeSchema>;
