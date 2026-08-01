import { Router } from "express";
import { AppError, isApiAuthEnabled, type Config } from "@maa/contracts";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkDatabaseIntegrity,
  createBackup,
  listBackups,
  purgeExpiredArtifacts,
  restoreBackup,
  buildMaaRecoveryEntry
} from "@maa/ops";
import { loadLearningPlanePackageIdentity } from "../integrations/learning-plane/packageIdentity.js";
import {
  CURRENT_DATABASE_SCHEMA_VERSION,
  type Container
} from "../composition/container";

/**
 * Local admin/ops endpoints. Require auth whenever an API key is configured;
 * when auth is disabled (dev/test without key), still available for local ops.
 */

function maaFeatureFlagsSafe(raw: Config): Record<string, boolean | string | number | null> {
  return {
    MAA_CONFIG_PROFILE: raw.MAA_CONFIG_PROFILE,
    MAA_ARTIFACT_RETENTION_DAYS: raw.MAA_ARTIFACT_RETENTION_DAYS,
    MAA_LEARNING_PLANE_ENABLED: raw.MAA_LEARNING_PLANE_ENABLED,
    MAA_LEARNING_PLANE_PUBLISH_ENABLED: raw.MAA_LEARNING_PLANE_PUBLISH_ENABLED,
    MAA_LEARNING_PLANE_RECEIVE_ENABLED: raw.MAA_LEARNING_PLANE_RECEIVE_ENABLED,
    MAA_LEARNING_PLANE_GOVERNANCE_BRIDGE_ENABLED: raw.MAA_LEARNING_PLANE_GOVERNANCE_BRIDGE_ENABLED,
    MAA_LEARNING_PLANE_REPLAY_BRIDGE_ENABLED: raw.MAA_LEARNING_PLANE_REPLAY_BRIDGE_ENABLED,
    MAA_LEARNING_PLANE_PUBLICATION_BRIDGE_ENABLED: raw.MAA_LEARNING_PLANE_PUBLICATION_BRIDGE_ENABLED,
    MAA_LEARNING_PLANE_LOCAL_REFERENCE_ENABLED: raw.MAA_LEARNING_PLANE_LOCAL_REFERENCE_ENABLED,
    MAA_LEARNING_PLANE_EXTERNAL_RETRIEVAL_ENABLED: raw.MAA_LEARNING_PLANE_EXTERNAL_RETRIEVAL_ENABLED
  };
}

export function adminRoutes(container: Container): Router {
  const router = Router();

  router.get("/v1/admin/integrity", (_req, res, next) => {
    try {
      const result = checkDatabaseIntegrity(container.database.db);
      container.metrics.increment("integrity_checks_total");
      if (!result.ok) container.metrics.increment("integrity_failures_total");
      res.status(result.ok ? 200 : 500).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post("/v1/admin/backup", (req, res, next) => {
    try {
      if (container.config.databasePath === ":memory:") {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "Cannot backup an in-memory database."
        });
      }
      const includeArtifacts = Boolean(
        (req.body as { includeArtifacts?: boolean } | undefined)?.includeArtifacts
      );
      const result = createBackup({
        databasePath: container.config.databasePath,
        backupDir: container.config.backupDir,
        serviceVersion: container.serviceVersion,
        databaseSchemaVersion: container.databaseSchemaVersion,
        includeArtifacts,
        artifactRoot: container.config.artifactRoot,
        notes: "api"
      });
      const lpRepo = container.learningPlane?.repo;
      const lpSettings = lpRepo?.tablesPresent() ? lpRepo.getSettings() : null;
      const outboxCounts = lpRepo?.tablesPresent()
        ? lpRepo.countByStatus("lp_adapter_outbox", "status")
        : {};
      const recoveryEntry = buildMaaRecoveryEntry({
        serviceVersion: container.serviceVersion,
        schemaVersion: container.databaseSchemaVersion,
        commit: loadLearningPlanePackageIdentity(container.config.repoRoot)
          .buildCommitOrSourceRevision,
        backupPath: result.backupPath,
        databaseFilename: result.manifest.databaseFile,
        includeArtifacts,
        integrityOk: result.manifest.integrity?.ok ?? false,
        featureFlagsSafe: maaFeatureFlagsSafe(container.config.raw),
        activeCredentialId: lpSettings?.credential_id ?? null,
        activeCallbackKeyId: lpSettings?.callback_key_id ?? null,
        outboxPending: outboxCounts.pending ?? 0,
        outboxPermanentFailure: outboxCounts.permanent_failure ?? 0,
        createdAt: result.manifest.createdAt
      });
      writeFileSync(
        join(result.backupPath, "recovery-entry.json"),
        JSON.stringify(recoveryEntry, null, 2)
      );
      container.metrics.increment("backups_total");
      container.auditLog.append({
        actorType: "client",
        actorId: "admin",
        action: "backup.created",
        targetType: "backup",
        targetId: result.backupId,
        after: { path: result.backupPath, integrityOk: result.manifest.integrity?.ok }
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/admin/backups", (_req, res, next) => {
    try {
      res.status(200).json({ backups: listBackups(container.config.backupDir) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/v1/admin/restore", (req, res, next) => {
    try {
      const body = req.body as { backupPath?: string; restoreArtifacts?: boolean };
      if (!body?.backupPath || typeof body.backupPath !== "string") {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "backupPath is required."
        });
      }
      if (container.config.databasePath === ":memory:") {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "Cannot restore into an in-memory database."
        });
      }
      // Soft guard: restore is destructive — require auth when any key policy is on.
      if (!isApiAuthEnabled(container.config.raw) && container.config.raw.NODE_ENV === "production") {
        throw new AppError({
          code: "FORBIDDEN",
          message: "Restore requires local API authentication in production."
        });
      }
      const manifest = restoreBackup({
        backupPath: body.backupPath,
        databasePath: container.config.databasePath,
        restoreArtifacts: Boolean(body.restoreArtifacts),
        artifactRoot: container.config.artifactRoot,
        maxSupportedDatabaseSchemaVersion:
          container.databaseSchemaVersion || CURRENT_DATABASE_SCHEMA_VERSION
      });
      container.metrics.increment("restores_total");
      container.auditLog.append({
        actorType: "client",
        actorId: "admin",
        action: "backup.restored",
        targetType: "backup",
        targetId: manifest.backupId,
        after: { backupPath: body.backupPath }
      });
      res.status(200).json({ ok: true, manifest });
    } catch (err) {
      next(err);
    }
  });

  router.post("/v1/admin/retention/purge", (req, res, next) => {
    try {
      const body = (req.body ?? {}) as { dryRun?: boolean; retentionDays?: number };
      const retentionDays =
        typeof body.retentionDays === "number"
          ? body.retentionDays
          : container.config.raw.MAA_ARTIFACT_RETENTION_DAYS;
      const dryRun = body.dryRun !== false;
      const live = purgeExpiredArtifacts({
        artifactRoot: container.config.artifactRoot,
        retentionDays,
        dryRun
      });
      container.metrics.increment("retention_purges_total");
      if (!dryRun) {
        container.metrics.increment("retention_files_deleted_total", live.deletedFiles);
      }
      res.status(200).json(live);
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/admin/config-summary", (_req, res) => {
    const raw = container.config.raw;
    res.status(200).json({
      profile: raw.MAA_CONFIG_PROFILE,
      nodeEnv: raw.NODE_ENV,
      authRequired: isApiAuthEnabled(raw),
      deepseekEnabled: raw.MAA_DEEPSEEK_ENABLED,
      defaultModelProfile: raw.MAA_DEFAULT_MODEL_PROFILE,
      artifactRetentionDays: raw.MAA_ARTIFACT_RETENTION_DAYS,
      host: raw.MAA_HOST,
      port: raw.MAA_PORT,
      serviceVersion: container.serviceVersion,
      databaseSchemaVersion: container.databaseSchemaVersion
    });
  });

  return router;
}
