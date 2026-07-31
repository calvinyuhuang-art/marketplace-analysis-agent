import { z } from "zod";

/** Contract-only stubs — persisted/activated in N4. */
export const TypedProceduralRuleType = z.enum([
  "require_direct_customer_evidence",
  "require_format_normalization_for_pricing",
  "reject_review_count_as_sales",
  "require_evidence_refs_on_findings",
  "warn_stale_evidence"
]);
export type TypedProceduralRuleType = z.infer<typeof TypedProceduralRuleType>;

export const ProceduralRuleDefinitionSchema = z.object({
  ruleId: z.string().min(1),
  ruleType: TypedProceduralRuleType,
  title: z.string().min(1),
  createdAt: z.string().datetime()
});
export type ProceduralRuleDefinition = z.infer<typeof ProceduralRuleDefinitionSchema>;

export const ProceduralRuleVersionSchema = z.object({
  versionId: z.string().min(1),
  ruleId: z.string().min(1),
  versionNumber: z.number().int().positive(),
  params: z.record(z.string(), z.unknown()).default({}),
  policyHash: z.string().min(1),
  replayReportArtifactId: z.string().optional(),
  createdBy: z.string().min(1),
  createdAt: z.string().datetime()
});
export type ProceduralRuleVersion = z.infer<typeof ProceduralRuleVersionSchema>;

export const ProceduralActivationAction = z.enum([
  "stage",
  "activate",
  "retire",
  "rollback"
]);
export type ProceduralActivationAction = z.infer<typeof ProceduralActivationAction>;

export const ProceduralRuleActivationSchema = z.object({
  activationId: z.string().min(1),
  versionId: z.string().min(1),
  action: ProceduralActivationAction,
  actorId: z.string().min(1),
  reason: z.string().optional(),
  replacesActivationId: z.string().optional(),
  createdAt: z.string().datetime()
});
export type ProceduralRuleActivation = z.infer<typeof ProceduralRuleActivationSchema>;
