import {
  EvidenceArtifactEnvelopeSchema,
  type EvidenceArtifactEnvelope,
  type EvidencePackageInput
} from "@maa/contracts";

/**
 * Wrap a Research Team evidence package as a versioned exchange artifact.
 * MAA registers the inner package only — never calls MCEC.
 */
export function wrapEvidenceArtifact(input: {
  artifactId: string;
  package: EvidencePackageInput;
  producedBy?: string;
  producedAt?: string;
  correlationId?: string;
  externalWorkOrderId?: string;
}): EvidenceArtifactEnvelope {
  return EvidenceArtifactEnvelopeSchema.parse({
    schemaVersion: "maa-evidence-artifact.v1",
    artifactId: input.artifactId,
    producedBy: input.producedBy ?? "research-team",
    producedAt: input.producedAt ?? new Date().toISOString(),
    correlationId: input.correlationId,
    externalWorkOrderId: input.externalWorkOrderId,
    package: input.package
  });
}

export function unwrapEvidenceArtifact(
  envelope: unknown
): EvidencePackageInput {
  const parsed = EvidenceArtifactEnvelopeSchema.parse(envelope);
  return parsed.package;
}
