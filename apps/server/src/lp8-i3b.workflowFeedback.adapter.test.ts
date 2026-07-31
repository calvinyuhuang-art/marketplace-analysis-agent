import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { ConfigSchema } from "@maa/contracts";
import { createContainer, CURRENT_DATABASE_SCHEMA_VERSION, SERVICE_VERSION } from "./composition/container";
import type { ResolvedConfig } from "./config/index";
import { findRepoRoot } from "./config/paths";
import {
  mapCreatedPayload,
  mapEvaluatedPayload,
  workflowFeedbackCorrelationId,
  createdIdempotencyKey
} from "./integrations/learning-plane/workflowFeedbackMapping";
import { loadLearningPlanePackageIdentity } from "./integrations/learning-plane/packageIdentity";

const repoRoot = findRepoRoot();
const migrationsDir = resolve(repoRoot, "migrations");
const dirs: string[] = [];
const containers: Array<{ shutdown: () => Promise<void> }> = [];

function makeConfig(overrides: Record<string, string | undefined> = {}): ResolvedConfig {
  const root = mkdtempSync(join(tmpdir(), "maa-lp8-i3b-"));
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

afterEach(async () => {
  while (containers.length) {
    const c = containers.pop();
    await c?.shutdown();
  }
});

describe("LP8-I3b production workflow-feedback adapter", () => {
  it("verifies vendored 0.8.0 package checksums and identity", () => {
    const identity = loadLearningPlanePackageIdentity(repoRoot);
    expect(identity.clientVersion).toBe("0.8.0");
    expect(identity.contractsVersion).toBe("0.8.0");
    expect(identity.apiCompat).toBe("2026.07");
    expect(identity.envelopeVersion).toBe("1.0");
    expect(identity.releasedWorkflowFeedbackPayloadVersions["workflow_feedback.created"]).toBe(
      "1.0"
    );

    const contractsPath = join(
      repoRoot,
      "vendor/learning-plane/artifacts/learning-plane-contracts-0.8.0.tgz"
    );
    const clientPath = join(
      repoRoot,
      "vendor/learning-plane/artifacts/learning-plane-client-0.8.0.tgz"
    );
    const contractsSha = createHash("sha256").update(readFileSync(contractsPath)).digest("hex");
    const clientSha = createHash("sha256").update(readFileSync(clientPath)).digest("hex");
    expect(contractsSha).toBe(
      "51e00046e8fd715f93997108863f0813c8bdc2ac5c8a2cd27d80009da3d62e86"
    );
    expect(clientSha).toBe(
      "2fb12a37621d5b361ea32634b972e9a978d06675d9a309dbd0ec38a05f560a49"
    );
    expect(identity.packageChecksum.contracts).toBe(contractsSha);
    expect(identity.packageChecksum.client).toBe(clientSha);
  });

  it("maps created and evaluated payloads with MAA effectiveness vocabulary", () => {
    const feedback = {
      workflowFeedbackId: "wfb_1",
      projectId: "proj_1",
      runId: "run_1",
      requestId: "req_1",
      experienceId: "exp_1",
      externalWorkOrderId: "wo_1",
      correlationId: null,
      feedbackType: "late_evidence_gap",
      gapFingerprintId: "gfp_1",
      collectionRequestIds: ["cr_1"],
      status: "detected",
      missingRequirement: { analysisArea: "pricing", reasons: ["missing binding"] },
      resolutionAction: "supplemental_collection" as string | null,
      resolutionQuality: "partial" as const,
      revisionRunId: "run_rev_1",
      detectedAt: "2026-07-30T21:00:00.000Z",
      resolvedAt: "2026-07-30T21:30:00.000Z"
    };
    const created = mapCreatedPayload(feedback);
    expect(created.feedbackCategory).toBe("late_evidence_gap");
    expect(created.severity).toBe("blocking");
    expect(created.operationalFeedbackRef.relativePath).toContain("wfb_1");
    expect(workflowFeedbackCorrelationId(feedback)).toBe("maa:wf:wfb_1");
    expect(createdIdempotencyKey("wfb_1")).toBe(
      "maa:workflow-feedback:wfb_1:created:v1"
    );

    for (const effectiveness of ["full", "partial", "ineffective"] as const) {
      const evaluated = mapEvaluatedPayload({
        feedback: { ...feedback, resolutionQuality: effectiveness },
        resolutionId: "res_1",
        evaluationId: "eval_1",
        effectiveness,
        summary: `quality ${effectiveness}`
      });
      expect(evaluated.effectiveness).toBe(effectiveness);
    }
  });

  it("captures created outbox transactionally with canonical feedback when publish enabled", () => {
    const config = makeConfig({
      MAA_LEARNING_PLANE_ENABLED: "true",
      MAA_LEARNING_PLANE_PUBLISH_ENABLED: "true"
    });
    const container = createContainer(config, { startWorker: false });
    containers.push(container);
    expect(SERVICE_VERSION).toBe("0.19.1");
    expect(CURRENT_DATABASE_SCHEMA_VERSION).toBe("0016");
    expect(container.databaseSchemaVersion).toBe("0016");

    const feedback = container.workflowFeedbackService.detectLatePricingGaps({
      projectId: "proj_tx",
      runId: "run_tx_1",
      requestId: "req_tx_1",
      operation: "analyze",
      capabilityVersion: "1.0.0",
      platform: "amazon",
      marketplace: "US",
      productType: "paperback",
      requestedAreas: ["pricing"],
      evidenceItems: [
        {
          evidenceId: "ei_1",
          sourceType: "listing",
          platform: "amazon",
          marketplace: "US",
          subjectId: "asin_1",
          fields: { price: 9.99 },
          provenance: {
            collector: "test",
            collectorVersion: "0.19.0",
            observedAt: new Date().toISOString()
          },
          confidence: 1,
          validationStatus: "valid"
        }
      ]
    });
    expect(feedback).not.toBeNull();
    const outbox = container.database.db
      .prepare(
        `SELECT * FROM lp_adapter_outbox WHERE workflow_feedback_id = ? AND event_type = ?`
      )
      .get(feedback!.workflowFeedbackId, "workflow_feedback.created") as
      | { status: string; idempotency_key: string }
      | undefined;
    expect(outbox?.status).toBe("pending");
    expect(outbox?.idempotency_key).toBe(
      createdIdempotencyKey(feedback!.workflowFeedbackId)
    );
  });

  it("does not capture outbox when publish is disabled", () => {
    const config = makeConfig({
      MAA_LEARNING_PLANE_ENABLED: "true",
      MAA_LEARNING_PLANE_PUBLISH_ENABLED: "false"
    });
    const container = createContainer(config, { startWorker: false });
    containers.push(container);
    const feedback = container.workflowFeedbackService.detectLatePricingGaps({
      projectId: "proj_off",
      runId: "run_off_1",
      requestId: "req_off_1",
      operation: "analyze",
      capabilityVersion: "1.0.0",
      platform: "amazon",
      marketplace: "US",
      productType: "paperback",
      requestedAreas: ["pricing"],
      evidenceItems: [
        {
          evidenceId: "ei_2",
          sourceType: "listing",
          platform: "amazon",
          marketplace: "US",
          subjectId: "asin_2",
          fields: { price: 12.5 },
          provenance: {
            collector: "test",
            collectorVersion: "0.19.0",
            observedAt: new Date().toISOString()
          },
          confidence: 1,
          validationStatus: "valid"
        }
      ]
    });
    expect(feedback).not.toBeNull();
    const count = (
      container.database.db
        .prepare(`SELECT COUNT(*) AS c FROM lp_adapter_outbox`)
        .get() as { c: number }
    ).c;
    expect(count).toBe(0);
  });

  it("keeps waiting_for_causation until submitted is reconciled", () => {
    const config = makeConfig({
      MAA_LEARNING_PLANE_ENABLED: "true",
      MAA_LEARNING_PLANE_PUBLISH_ENABLED: "true"
    });
    const container = createContainer(config, { startWorker: false });
    containers.push(container);
    const created = container.workflowFeedbackService.detectLatePricingGaps({
      projectId: "proj_eval",
      runId: "run_eval_1",
      requestId: "req_eval_1",
      operation: "analyze",
      capabilityVersion: "1.0.0",
      platform: "amazon",
      marketplace: "US",
      productType: "paperback",
      requestedAreas: ["pricing"],
      evidenceItems: [
        {
          evidenceId: "ei_3",
          sourceType: "listing",
          platform: "amazon",
          marketplace: "US",
          subjectId: "asin_3",
          fields: { price: 8 },
          provenance: {
            collector: "test",
            collectorVersion: "0.19.0",
            observedAt: new Date().toISOString()
          },
          confidence: 1,
          validationStatus: "valid"
        }
      ]
    });
    expect(created).not.toBeNull();
    container.workflowFeedbackService.resolve(created!.workflowFeedbackId, {
      resolutionAction: "supplemental_collection",
      supplementalEvidencePackageIds: [],
      actorId: "fixture-orchestrator"
    });
    container.workflowFeedbackService.attachRevision({
      workflowFeedbackId: created!.workflowFeedbackId,
      revisionRunId: "run_eval_rev"
    });
    const evaluated = container.workflowFeedbackService.completeRevision({
      revisionRunId: "run_eval_rev",
      priorRunId: created!.runId,
      bindingPresentInSupplemental: false
    });
    expect(evaluated?.resolutionQuality).toBe("partial");
    const waiting = container.database.db
      .prepare(
        `SELECT status, causation_event_id, resolution_id, evaluation_id, idempotency_key, payload_sha256, correlation_id, payload_json
         FROM lp_adapter_outbox
         WHERE event_type='workflow_feedback.resolution_evaluated'
           AND workflow_feedback_id=?`
      )
      .get(created!.workflowFeedbackId) as {
      status: string;
      causation_event_id: string | null;
      resolution_id: string;
      evaluation_id: string;
      idempotency_key: string;
      payload_sha256: string;
      correlation_id: string;
      payload_json: string;
    };
    expect(waiting.status).toBe("waiting_for_causation");
    expect(waiting.causation_event_id).toBeNull();
    expect(waiting.resolution_id).toBe(`maa:resolution:${created!.workflowFeedbackId}`);
    expect(waiting.evaluation_id).toBe("run_eval_rev");
    expect(waiting.idempotency_key).toBe(
      `maa:workflow-feedback:${created!.workflowFeedbackId}:resolution:maa:resolution:${created!.workflowFeedbackId}:evaluated:run_eval_rev:v1`
    );
    expect(JSON.parse(waiting.payload_json).resolutionId).toBe(waiting.resolution_id);
    expect(SERVICE_VERSION).toBe("0.19.1");
  });
});
