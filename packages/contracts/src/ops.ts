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
  databaseFile: z.string(),
  artifactRootIncluded: z.boolean(),
  integrity: IntegrityCheckResultSchema.optional(),
  notes: z.string().optional()
});
export type BackupManifest = z.infer<typeof BackupManifestSchema>;

export const RetentionPurgeResultSchema = z.object({
  retentionDays: z.number().int().nonnegative(),
  scannedFiles: z.number().int().nonnegative(),
  deletedFiles: z.number().int().nonnegative(),
  freedBytes: z.number().nonnegative(),
  dryRun: z.boolean(),
  purgedAt: z.string().datetime()
});
export type RetentionPurgeResult = z.infer<typeof RetentionPurgeResultSchema>;
