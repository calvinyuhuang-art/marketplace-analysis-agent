import { z } from "zod";

export const COLLECTOR_SNAPSHOT_SCHEMA = "maa.collector_capability_snapshot.v1" as const;

export const CollectorCapabilitySnapshotSchema = z.object({
  schemaVersion: z.literal(COLLECTOR_SNAPSHOT_SCHEMA),
  collector: z.string().min(1),
  collectorVersion: z.string().min(1),
  capturedAt: z.string().datetime(),
  supportedEvidenceTypes: z.array(z.string()).min(1),
  supportedFields: z.record(z.string(), z.array(z.string())),
  limits: z
    .object({
      maxItems: z.number().int().positive().optional()
    })
    .optional()
});
export type CollectorCapabilitySnapshot = z.infer<typeof CollectorCapabilitySnapshotSchema>;

export const CollectorSnapshotArtifactMetaSchema = z.object({
  artifactId: z.string().min(1),
  schemaVersion: z.literal(COLLECTOR_SNAPSHOT_SCHEMA),
  collector: z.string().min(1),
  collectorVersion: z.string().min(1),
  capturedAt: z.string().datetime(),
  contentHash: z.string().min(1)
});
export type CollectorSnapshotArtifactMeta = z.infer<
  typeof CollectorSnapshotArtifactMetaSchema
>;
