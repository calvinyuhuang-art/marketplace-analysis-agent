import { z } from "zod";

export const IntegrityCheckResultSchema = z.object({
  ok: z.boolean(),
  result: z.string(),
  checkedAt: z.string().datetime()
});
export type IntegrityCheckResult = z.infer<typeof IntegrityCheckResultSchema>;

export const BackupManifestSchema = z.object({
  schemaVersion: z.literal("maa-backup.v1"),
  backupId: z.string(),
  createdAt: z.string().datetime(),
  serviceVersion: z.string(),
  /** Highest applied migration version, e.g. "0009". */
  databaseSchemaVersion: z.string().min(1),
  /** Artifact inventory format version inside the backup. */
  artifactManifestVersion: z.string().min(1).default("maa-artifact-manifest.v1"),
  databaseFile: z.string(),
  artifactRootIncluded: z.boolean(),
  integrity: IntegrityCheckResultSchema.optional(),
  notes: z.string().optional()
});
export type BackupManifest = z.infer<typeof BackupManifestSchema>;

export const ARTIFACT_MANIFEST_VERSION = "maa-artifact-manifest.v1" as const;
export const API_COMPAT_LABEL = "2026.07" as const;
/**
 * Historical Sunset date from Warn/Hide stages.
 * N7 removed `propose_memory_update` from the public OperationType allowlist.
 */
export const PROPOSE_MEMORY_UPDATE_SUNSET = "2026-10-26T00:00:00.000Z";

export const RetentionPurgeResultSchema = z.object({
  retentionDays: z.number().int().nonnegative(),
  scannedFiles: z.number().int().nonnegative(),
  deletedFiles: z.number().int().nonnegative(),
  freedBytes: z.number().nonnegative(),
  dryRun: z.boolean(),
  purgedAt: z.string().datetime()
});
export type RetentionPurgeResult = z.infer<typeof RetentionPurgeResultSchema>;
