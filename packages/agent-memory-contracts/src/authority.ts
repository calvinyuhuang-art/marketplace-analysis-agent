import { z } from "zod";

/**
 * Memory authority. Includes MAA extension `expired` (not in Design Spec v0.3 list).
 */
export const MemoryAuthority = z.enum([
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
export type MemoryAuthority = z.infer<typeof MemoryAuthority>;
