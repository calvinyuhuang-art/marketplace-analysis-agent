import { z } from "zod";
import { TypedProceduralRuleType } from "@maa/agent-memory-contracts";

export { TypedProceduralRuleType };
export const ProposeTypedProceduralVersionRequestSchema = z.object({
  params: z.record(z.string(), z.unknown()).default({}),
  createdBy: z.string().min(1).default("operator")
});
export type ProposeTypedProceduralVersionRequest = z.infer<
  typeof ProposeTypedProceduralVersionRequestSchema
>;

export const TypedProceduralActorRequestSchema = z.object({
  actorId: z.string().min(1).default("operator"),
  reason: z.string().optional()
});
export type TypedProceduralActorRequest = z.infer<typeof TypedProceduralActorRequestSchema>;

export const TypedProceduralRuleVersionResponseSchema = z.object({
  versionId: z.string(),
  ruleId: z.string(),
  ruleType: TypedProceduralRuleType,
  versionNumber: z.number().int().positive(),
  params: z.record(z.string(), z.unknown()),
  policyHash: z.string(),
  lifecycleStatus: z.enum(["proposed", "replayed", "approved"]),
  replayReportArtifactId: z.string().optional(),
  approvedBy: z.string().optional(),
  approvedAt: z.string().datetime().optional(),
  createdBy: z.string(),
  createdAt: z.string().datetime(),
  isActive: z.boolean()
});
export type TypedProceduralRuleVersionResponse = z.infer<
  typeof TypedProceduralRuleVersionResponseSchema
>;

export const TypedProceduralRuleSummarySchema = z.object({
  ruleId: z.string(),
  ruleType: TypedProceduralRuleType,
  title: z.string(),
  createdAt: z.string().datetime(),
  activeVersionId: z.string().optional(),
  activeVersionNumber: z.number().int().positive().optional(),
  versions: z.array(TypedProceduralRuleVersionResponseSchema)
});
export type TypedProceduralRuleSummary = z.infer<typeof TypedProceduralRuleSummarySchema>;

export const TypedProceduralActivationResponseSchema = z.object({
  activationId: z.string(),
  versionId: z.string(),
  ruleType: TypedProceduralRuleType,
  action: z.enum(["stage", "activate", "retire", "rollback"]),
  actorId: z.string(),
  reason: z.string().optional(),
  replacesActivationId: z.string().optional(),
  createdAt: z.string().datetime()
});
export type TypedProceduralActivationResponse = z.infer<
  typeof TypedProceduralActivationResponseSchema
>;
