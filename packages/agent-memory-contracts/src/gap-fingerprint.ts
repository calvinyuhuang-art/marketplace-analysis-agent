import { z } from "zod";

export const GAP_FINGERPRINT_VERSION = "v1" as const;

export const GapFingerprintComponentsSchema = z.object({
  platform: z.string().min(1),
  marketplace: z.string().min(1),
  productType: z.string().min(1),
  capabilityVersion: z.string().min(1),
  operation: z.string().min(1),
  analysisArea: z.string().min(1),
  upstreamStep: z.string().min(1),
  missingEvidenceType: z.string().min(1),
  collectorCapabilityKey: z.string().min(1),
  resolutionAction: z.string().optional()
});
export type GapFingerprintComponents = z.infer<typeof GapFingerprintComponentsSchema>;

/** Deterministic fingerprint string (hashing of this string is done by callers). */
export function formatGapFingerprintKey(
  components: GapFingerprintComponents,
  version: string = GAP_FINGERPRINT_VERSION
): string {
  const parts = [
    version,
    components.platform,
    components.marketplace,
    components.productType,
    components.capabilityVersion,
    components.operation,
    components.analysisArea,
    components.upstreamStep,
    components.missingEvidenceType,
    components.collectorCapabilityKey,
    components.resolutionAction ?? ""
  ];
  return `gap_${parts.join(":")}`;
}
