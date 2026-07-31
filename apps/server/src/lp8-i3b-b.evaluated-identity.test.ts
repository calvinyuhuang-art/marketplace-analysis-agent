import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigSchema } from "@maa/contracts";
import { createBackup, restoreBackup } from "@maa/ops";
import { Database } from "@maa/database";
import {
  createContainer,
  CURRENT_DATABASE_SCHEMA_VERSION,
  SERVICE_VERSION,
  type Container
} from "./composition/container";
import type { ResolvedConfig } from "./config/index";
import { findRepoRoot } from "./config/paths";
import {
  canonicalMaaResolutionId,
  evaluatedIdempotencyKey
} from "./integrations/learning-plane/workflowFeedbackMapping";

const repoRoot = findRepoRoot();
const migrationsDir = resolve(repoRoot, "migrations");
const dirs: string[] = [];
const containers: Array<{ shutdown: () => Promise<void> }> = [];

function makeConfig(overrides: Record<string, string | undefined> = {}): ResolvedConfig {
  const root = mkdtempSync(join(tmpdir(), "maa-lp8-i3b-b-"));
  dirs.push(root);
  mkdirSync(join(root, "log"), { recursive: true });
  mkdirSync(join(root, "artifacts"), { recursive: true });
  mkdirSync(join(root, "secrets"), { recursive: true });
  const raw = ConfigSchema.parse({
    NODE_ENV: "test",
    MAA_CONFIG_PROFILE: "test",
    MAA_DATABASE_PATH: join(root, "maa.sqlite"),
    MAA_ARTIFACT_ROOT: join(root, "artifacts"),
    MAA_LOG_ROOT: join(root, "log"),
    MAA_BACKUP_DIR: join(root, "backups"),
    MAA_LEARNING_PLANE_SECRET_FILE: join(root, "secrets", "learning-plane-adapter.json"),
    ...overrides
  });
  return {
    raw,
    repoRoot,
    databasePath: raw.MAA_DATABASE_PATH,
    artifactRoot: raw.MAA_ARTIFACT_ROOT,
    logRoot: raw.MAA_LOG_ROOT,
    backupDir: raw.MAA_BACKUP_DIR,
    migrationsDir
  };
}

function evidence(subjectId: string) {
  return [
    {
      evidenceId: `ei_${subjectId}`,
      sourceType: "listing" as const,
      platform: "amazon",
      marketplace: "US",
      subjectId,
      fields: { price: 9.99 },
      provenance: {
        collector: "test",
        collectorVersion: "0.19.1",
        observedAt: new Date().toISOString()
      },
      confidence: 1,
      validationStatus: "valid" as const
    }
  ];
}

function createEvaluatedWaiting(container: Container, suffix: string) {
  const created = container.workflowFeedbackService.detectLatePricingGaps({
    projectId: `proj_${suffix}`,
    runId: `run_${suffix}`,
    requestId: `req_${suffix}`,
    correlationId: `corr_${suffix}`,
    externalWorkOrderId: `wo_${suffix}`,
    operation: "analyze",
    capabilityVersion: "1.0.0",
    platform: "amazon",
    marketplace: "US",
    productType: "paperback",
    requestedAreas: ["pricing"],
    evidenceItems: evidence(suffix)
  });
  expect(created).not.toBeNull();
  container.workflowFeedbackService.resolve(created!.workflowFeedbackId, {
    resolutionAction: "supplemental_collection",
    supplementalEvidencePackageIds: [],
    actorId: "fixture"
  });
  const revisionRunId = `run_${suffix}_rev`;
  container.workflowFeedbackService.attachRevision({
    workflowFeedbackId: created!.workflowFeedbackId,
    revisionRunId
  });
  const evaluated = container.workflowFeedbackService.completeRevision({
    revisionRunId,
    priorRunId: created!.runId,
    bindingPresentInSupplemental: false
  });
  expect(evaluated?.resolutionQuality).toBe("partial");
  const row = container.database.db
    .prepare(
      `SELECT * FROM lp_adapter_outbox
       WHERE event_type='workflow_feedback.resolution_evaluated'
         AND workflow_feedback_id=?`
    )
    .get(created!.workflowFeedbackId) as Record<string, unknown>;
  return { created: created!, row, revisionRunId };
}

afterEach(async () => {
  while (containers.length) {
    const c = containers.pop();
    await c?.shutdown();
  }
});

describe("LP8-I3b-b evaluated identity immutability", () => {
  it("freezes resolutionId, idempotency key, and payload at capture", () => {
    expect(SERVICE_VERSION).toBe("0.19.1");
    expect(CURRENT_DATABASE_SCHEMA_VERSION).toBe("0016");
    const config = makeConfig({
      MAA_LEARNING_PLANE_ENABLED: "true",
      MAA_LEARNING_PLANE_PUBLISH_ENABLED: "true"
    });
    const container = createContainer(config, { startWorker: false });
    containers.push(container);
    const { created, row, revisionRunId } = createEvaluatedWaiting(container, "freeze");
    const resolutionId = canonicalMaaResolutionId(created.workflowFeedbackId);
    expect(row.status).toBe("waiting_for_causation");
    expect(row.causation_event_id).toBeNull();
    expect(row.resolution_id).toBe(resolutionId);
    expect(row.evaluation_id).toBe(revisionRunId);
    expect(row.idempotency_key).toBe(
      evaluatedIdempotencyKey(created.workflowFeedbackId, resolutionId, revisionRunId)
    );
    expect(row.correlation_id).toBe("corr_freeze");
    const payload = JSON.parse(String(row.payload_json)) as {
      resolutionId: string;
      evaluationId: string;
      maaWorkflowFeedbackId: string;
    };
    expect(payload.resolutionId).toBe(resolutionId);
    expect(payload.evaluationId).toBe(revisionRunId);
    expect(payload.maaWorkflowFeedbackId).toBe(created.workflowFeedbackId);
    expect(String(row.payload_sha256)).toBe(
      createHash("sha256").update(String(row.payload_json)).digest("hex")
    );
    const frozen = container.database.db
      .prepare(
        `SELECT COUNT(*) AS c FROM lp_adapter_processing_events
         WHERE event_kind='learning_plane.evaluated.capture_identity_frozen'`
      )
      .get() as { c: number };
    expect(frozen.c).toBeGreaterThan(0);
  });

  it("duplicate capture preserves the original row", () => {
    const config = makeConfig({
      MAA_LEARNING_PLANE_ENABLED: "true",
      MAA_LEARNING_PLANE_PUBLISH_ENABLED: "true"
    });
    const container = createContainer(config, { startWorker: false });
    containers.push(container);
    const { created, row } = createEvaluatedWaiting(container, "dup");
    const again = container.learningPlane!.capture.captureEvaluated(
      container.repos.workflowFeedback.getById(created.workflowFeedbackId)!
    );
    expect(again).toBe(row.outbox_id);
    const count = (
      container.database.db
        .prepare(
          `SELECT COUNT(*) AS c FROM lp_adapter_outbox
           WHERE workflow_feedback_id=? AND event_type='workflow_feedback.resolution_evaluated'`
        )
        .get(created.workflowFeedbackId) as { c: number }
    ).c;
    expect(count).toBe(1);
  });

  it("causation release updates only causationEventId and status", () => {
    const config = makeConfig({
      MAA_LEARNING_PLANE_ENABLED: "true",
      MAA_LEARNING_PLANE_PUBLISH_ENABLED: "true"
    });
    const container = createContainer(config, { startWorker: false });
    containers.push(container);
    const { created, row } = createEvaluatedWaiting(container, "release");
    const before = { ...row };
    const result = container.learningPlane!.repo.releaseWaitingEvaluated({
      workflowFeedbackId: created.workflowFeedbackId,
      resolutionId: String(row.resolution_id),
      causationEventId: "evt_submitted_parent",
      correlationId: String(row.correlation_id),
      parentEventType: "workflow_feedback.resolution_submitted"
    });
    expect(result.released).toBe(1);
    expect(result.mismatches).toBe(0);
    const after = container.database.db
      .prepare(`SELECT * FROM lp_adapter_outbox WHERE outbox_id=?`)
      .get(row.outbox_id) as Record<string, unknown>;
    expect(after.status).toBe("pending");
    expect(after.causation_event_id).toBe("evt_submitted_parent");
    expect(after.resolution_id).toBe(before.resolution_id);
    expect(after.idempotency_key).toBe(before.idempotency_key);
    expect(after.payload_sha256).toBe(before.payload_sha256);
    expect(after.payload_json).toBe(before.payload_json);
    expect(after.correlation_id).toBe(before.correlation_id);
    expect(after.evaluation_id).toBe(before.evaluation_id);
  });

  it("mismatched parents do not mutate waiting identity; correct parent still releases", () => {
    const config = makeConfig({
      MAA_LEARNING_PLANE_ENABLED: "true",
      MAA_LEARNING_PLANE_PUBLISH_ENABLED: "true"
    });
    const container = createContainer(config, { startWorker: false });
    containers.push(container);
    const { created, row } = createEvaluatedWaiting(container, "mismatch");
    const frozen = {
      resolution_id: row.resolution_id,
      idempotency_key: row.idempotency_key,
      payload_sha256: row.payload_sha256,
      correlation_id: row.correlation_id
    };

    const wrongResolution = container.learningPlane!.repo.releaseWaitingEvaluated({
      workflowFeedbackId: created.workflowFeedbackId,
      resolutionId: "res_wrong",
      causationEventId: "evt_wrong_res",
      correlationId: String(row.correlation_id),
      parentEventType: "workflow_feedback.resolution_submitted"
    });
    expect(wrongResolution.released).toBe(0);
    expect(wrongResolution.mismatches).toBe(1);

    const wrongCorr = container.learningPlane!.repo.releaseWaitingEvaluated({
      workflowFeedbackId: created.workflowFeedbackId,
      resolutionId: String(row.resolution_id),
      causationEventId: "evt_wrong_corr",
      correlationId: "corr_wrong",
      parentEventType: "workflow_feedback.resolution_submitted"
    });
    expect(wrongCorr.released).toBe(0);
    expect(wrongCorr.mismatches).toBe(1);

    const wrongType = container.learningPlane!.repo.releaseWaitingEvaluated({
      workflowFeedbackId: created.workflowFeedbackId,
      resolutionId: String(row.resolution_id),
      causationEventId: "evt_wrong_type",
      correlationId: String(row.correlation_id),
      parentEventType: "workflow_feedback.created"
    });
    expect(wrongType.released).toBe(0);
    expect(wrongType.mismatches).toBe(1);

    const mid = container.database.db
      .prepare(`SELECT * FROM lp_adapter_outbox WHERE outbox_id=?`)
      .get(row.outbox_id) as Record<string, unknown>;
    expect(mid.status).toBe("waiting_for_causation");
    expect(mid.causation_event_id).toBeNull();
    expect(mid.resolution_id).toBe(frozen.resolution_id);
    expect(mid.idempotency_key).toBe(frozen.idempotency_key);
    expect(mid.payload_sha256).toBe(frozen.payload_sha256);
    expect(mid.correlation_id).toBe(frozen.correlation_id);

    const ok = container.learningPlane!.repo.releaseWaitingEvaluated({
      workflowFeedbackId: created.workflowFeedbackId,
      resolutionId: String(row.resolution_id),
      causationEventId: "evt_correct",
      correlationId: String(row.correlation_id),
      parentEventType: "workflow_feedback.resolution_submitted"
    });
    expect(ok.released).toBe(1);
    const after = container.database.db
      .prepare(`SELECT * FROM lp_adapter_outbox WHERE outbox_id=?`)
      .get(row.outbox_id) as Record<string, unknown>;
    expect(after.status).toBe("pending");
    expect(after.causation_event_id).toBe("evt_correct");
    expect(after.idempotency_key).toBe(frozen.idempotency_key);
    expect(after.payload_sha256).toBe(frozen.payload_sha256);

    const mismatchEvents = (
      container.database.db
        .prepare(
          `SELECT COUNT(*) AS c FROM lp_adapter_processing_events
           WHERE event_kind='learning_plane.evaluated.causation_mismatch'`
        )
        .get() as { c: number }
    ).c;
    expect(mismatchEvents).toBeGreaterThanOrEqual(3);
  });

  it("preserves waiting and released identity across backup/restore", () => {
    const config = makeConfig({
      MAA_LEARNING_PLANE_ENABLED: "true",
      MAA_LEARNING_PLANE_PUBLISH_ENABLED: "true"
    });
    const container = createContainer(config, { startWorker: false });
    containers.push(container);
    const waiting = createEvaluatedWaiting(container, "bak_wait");
    const released = createEvaluatedWaiting(container, "bak_rel");
    container.learningPlane!.repo.releaseWaitingEvaluated({
      workflowFeedbackId: released.created.workflowFeedbackId,
      resolutionId: String(released.row.resolution_id),
      causationEventId: "evt_bak_rel",
      correlationId: String(released.row.correlation_id),
      parentEventType: "workflow_feedback.resolution_submitted"
    });

    const backup = createBackup({
      databasePath: container.config.databasePath,
      backupDir: container.config.backupDir,
      serviceVersion: SERVICE_VERSION,
      databaseSchemaVersion: container.databaseSchemaVersion,
      notes: "lp8-i3b-b"
    });
    const restoredPath = join(container.config.artifactRoot, "restored-i3b-b.sqlite");
    restoreBackup({
      backupPath: backup.backupPath,
      databasePath: restoredPath,
      maxSupportedDatabaseSchemaVersion: "0016"
    });
    const restored = Database.open({ path: restoredPath });
    try {
      const integrity = restored.db.pragma("integrity_check") as Array<{
        integrity_check: string;
      }>;
      expect(integrity[0]?.integrity_check).toBe("ok");
      expect(restored.db.pragma("foreign_key_check")).toEqual([]);
      const waitRow = restored.db
        .prepare(`SELECT * FROM lp_adapter_outbox WHERE outbox_id=?`)
        .get(waiting.row.outbox_id) as Record<string, unknown>;
      expect(waitRow.status).toBe("waiting_for_causation");
      expect(waitRow.causation_event_id).toBeNull();
      expect(waitRow.idempotency_key).toBe(waiting.row.idempotency_key);
      expect(waitRow.payload_sha256).toBe(waiting.row.payload_sha256);
      const relRow = restored.db
        .prepare(`SELECT * FROM lp_adapter_outbox WHERE outbox_id=?`)
        .get(released.row.outbox_id) as Record<string, unknown>;
      expect(relRow.status).toBe("pending");
      expect(relRow.causation_event_id).toBe("evt_bak_rel");
      expect(relRow.idempotency_key).toBe(released.row.idempotency_key);
      expect(relRow.payload_sha256).toBe(released.row.payload_sha256);
    } finally {
      restored.close();
    }
  });
});
