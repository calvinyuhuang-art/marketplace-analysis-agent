import { Router } from "express";
import { AppError, isApiAuthEnabled } from "@maa/contracts";
import {
  checkDatabaseIntegrity,
  createBackup,
  listBackups,
  purgeExpiredArtifacts,
  restoreBackup
} from "@maa/ops";
import type { Container } from "../composition/container";

/**
 * Local admin/ops endpoints. Require auth whenever an API key is configured;
 * when auth is disabled (dev/test without key), still available for local ops.
 */
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
        includeArtifacts,
        artifactRoot: container.config.artifactRoot,
        notes: "api"
      });
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
        artifactRoot: container.config.artifactRoot
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
      serviceVersion: container.serviceVersion
    });
  });

  return router;
}
