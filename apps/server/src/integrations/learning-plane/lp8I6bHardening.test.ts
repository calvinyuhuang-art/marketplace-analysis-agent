import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigSchema } from "@maa/contracts";
import { Database, runMigrations, type SqliteDatabase } from "@maa/database";
import { resolve } from "node:path";
import { findRepoRoot } from "../../config/paths";
import { LearningPlaneSecretStore } from "./secretStore.js";
import { LearningPlaneAdapterRepository } from "./adapterRepository.js";
import { callbackVerifyOptions } from "./callbackVerification.js";
import { LearningPlaneRotationService } from "./rotationService.js";

const dirs: string[] = [];
const databases: Array<{ close: () => void }> = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "maa-lp8-i6b-"));
  dirs.push(dir);
  return dir;
}

function tempDb(): { db: SqliteDatabase; repo: LearningPlaneAdapterRepository } {
  const root = tempDir();
  const dbPath = join(root, "test.sqlite");
  const repoRoot = findRepoRoot();
  const migrationsDir = resolve(repoRoot, "migrations");
  const database = Database.open({ path: dbPath });
  runMigrations(database.db, migrationsDir);
  databases.push(database);
  const repo = new LearningPlaneAdapterRepository(database.db);
  return { db: database.db, repo };
}

function baseSecretInput() {
  return {
    agentId: "marketplace-analysis-agent",
    learningPlaneBaseUrl: "http://127.0.0.1:4330",
    credentialId: "cred_initial",
    callbackKeyId: "lp-delivery-hmac-v1",
    agentApiKey: "a".repeat(32),
    callbackVerificationSecret: "b".repeat(32)
  };
}

afterEach(() => {
  while (databases.length) {
    databases.pop()?.close();
  }
  while (dirs.length) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("LP8-I6b hardening", () => {
  it("loads secret files without rotation fields (backward compatible)", () => {
    const root = tempDir();
    const secretPath = join(root, "learning-plane-adapter.json");
    const legacy = {
      schemaVersion: "maa.learning-plane-adapter.secrets.v1",
      ...baseSecretInput(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    writeFileSync(secretPath, JSON.stringify(legacy, null, 2), "utf8");

    const store = new LearningPlaneSecretStore(secretPath);
    const loaded = store.load();
    expect(loaded?.credentialId).toBe("cred_initial");
    expect(loaded?.rotationStatus).toBeUndefined();
    expect(loaded?.previousAgentApiKey).toBeUndefined();
    expect(loaded?.acceptedCallbackKeyIds).toBeUndefined();
  });

  it("applies api key rotation and rolls back to previous credential", () => {
    const root = tempDir();
    const secretPath = join(root, "learning-plane-adapter.json");
    const store = new LearningPlaneSecretStore(secretPath);
    store.save(baseSecretInput());

    const { repo } = tempDb();
    repo.upsertSettings({
      agentId: "marketplace-analysis-agent",
      learningPlaneBaseUrl: "http://127.0.0.1:4330",
      registrationStatus: "registered",
      credentialId: "cred_initial",
      callbackKeyId: "lp-delivery-hmac-v1",
      callbackPath: "/v1/learning-plane/deliveries",
      enabled: true,
      publishEnabled: true,
      receiveEnabled: true
    });

    const rotation = new LearningPlaneRotationService(store, repo);
    const applied = rotation.applyCredentialRotation({
      credentialId: "cred_rotated",
      agentApiKey: "c".repeat(32),
      overlapExpiresAt: new Date(Date.now() + 86_400_000).toISOString()
    });
    expect(applied.rotationStatus).toBe("api_key_overlap");

    const afterApply = store.load()!;
    expect(afterApply.credentialId).toBe("cred_rotated");
    expect(afterApply.agentApiKey).toBe("c".repeat(32));
    expect(afterApply.previousCredentialId).toBe("cred_initial");
    expect(afterApply.previousAgentApiKey).toBe("a".repeat(32));
    expect(repo.getSettings()?.credential_id).toBe("cred_rotated");

    const rolledBack = rotation.rollbackCredentialRotation();
    expect(rolledBack.credentialId).toBe("cred_initial");
    expect(rolledBack.rotationStatus).toBe("idle");

    const afterRollback = store.load()!;
    expect(afterRollback.credentialId).toBe("cred_initial");
    expect(afterRollback.agentApiKey).toBe("a".repeat(32));
    expect(afterRollback.previousCredentialId).toBeUndefined();
    expect(afterRollback.previousAgentApiKey).toBeUndefined();
    expect(repo.getSettings()?.credential_id).toBe("cred_initial");

    const raw = readFileSync(secretPath, "utf8");
    expect(raw).not.toContain("c".repeat(32));
  });

  it("applies hmac rotation with dual materials derived from current", () => {
    const root = tempDir();
    const secretPath = join(root, "learning-plane-adapter.json");
    const store = new LearningPlaneSecretStore(secretPath);
    store.save(baseSecretInput());

    const { repo } = tempDb();
    const rotation = new LearningPlaneRotationService(store, repo);
    const applied = rotation.applyCallbackKeyRotation({
      callbackKeyId: "lp-delivery-hmac-v2",
      callbackVerificationSecret: "d".repeat(32),
      acceptedCallbackKeyIds: ["lp-delivery-hmac-v1", "lp-delivery-hmac-v2"]
    });
    expect(applied.rotationStatus).toBe("hmac_overlap");

    const afterApply = store.load()!;
    expect(afterApply.callbackKeyId).toBe("lp-delivery-hmac-v2");
    expect(afterApply.callbackVerificationSecret).toBe("d".repeat(32));
    expect(afterApply.previousCallbackKeyId).toBe("lp-delivery-hmac-v1");
    expect(afterApply.previousCallbackVerificationSecret).toBe("b".repeat(32));
    expect(afterApply.acceptedCallbackKeyIds).toEqual([
      "lp-delivery-hmac-v1",
      "lp-delivery-hmac-v2"
    ]);
  });

  it("callbackVerifyOptions includes previous callback materials", () => {
    const secret = {
      schemaVersion: "maa.learning-plane-adapter.secrets.v1" as const,
      ...baseSecretInput(),
      callbackKeyId: "lp-delivery-hmac-v2",
      callbackVerificationSecret: "d".repeat(32),
      previousCallbackKeyId: "lp-delivery-hmac-v1",
      previousCallbackVerificationSecret: "b".repeat(32),
      acceptedCallbackKeyIds: ["lp-delivery-hmac-v1"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const options = callbackVerifyOptions(secret);
    expect(options.verificationSecret).toBe("d".repeat(32));
    expect(options.additionalVerificationSecrets).toEqual(["b".repeat(32)]);
    expect(options.allowedKeyIds).toEqual(
      expect.arrayContaining([
        "lp-delivery-hmac-v2",
        "lp-delivery-hmac-v1"
      ])
    );
  });

  it("operatorRetryOutbox requeues permanent_failure items", () => {
    const { db, repo } = tempDb();
    const timestamp = new Date().toISOString();
    db.prepare(
      `INSERT INTO lp_adapter_outbox (
        outbox_id, event_type, payload_schema_version, idempotency_key, status,
        attempt_count, correlation_id, workflow_feedback_id, resolution_id,
        created_at, updated_at, last_error_code, last_bounded_error
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      "lpox_test_1",
      "workflow_feedback.resolution_evaluated",
      "1.0",
      "idem-perm-fail",
      "permanent_failure",
      5,
      "corr-1",
      "wf-1",
      "res-1",
      timestamp,
      timestamp,
      "LP_PUBLISH_FAILED",
      "upstream unavailable"
    );

    const retried = repo.operatorRetryOutbox("lpox_test_1");
    expect(retried?.status).toBe("pending");
    expect(retried?.lease_owner).toBeNull();
    expect(retried?.next_attempt_at).toBeTruthy();

    const events = repo.listRecentProcessingEvents(5);
    expect(events.some((e) => e.event_kind === "learning_plane.outbox_operator_retry")).toBe(true);

    const ineligible = repo.operatorRetryOutbox("lpox_missing");
    expect(ineligible).toBeNull();
  });

  it("persists rotation fields when saving with applyRotationUpdate", () => {
    const root = tempDir();
    const secretPath = join(root, "learning-plane-adapter.json");
    const store = new LearningPlaneSecretStore(secretPath);
    store.save(baseSecretInput());

    store.applyRotationUpdate({
      previousCredentialId: "cred_old",
      previousAgentApiKey: "x".repeat(32),
      rotationStatus: "api_key_overlap",
      rotationOverlapExpiresAt: "2026-08-01T00:00:00.000Z"
    });

    const reloaded = store.load()!;
    expect(reloaded.previousCredentialId).toBe("cred_old");
    expect(reloaded.rotationStatus).toBe("api_key_overlap");
    expect(reloaded.rotationOverlapExpiresAt).toBe("2026-08-01T00:00:00.000Z");
    expect(reloaded.credentialId).toBe("cred_initial");
  });
});

describe("LP8-I6b status exposure", () => {
  it("does not expose secret values in ConfigSchema secret path wiring", () => {
    const root = tempDir();
    const parsed = ConfigSchema.parse({
      NODE_ENV: "test",
      MAA_CONFIG_PROFILE: "test",
      MAA_DATABASE_PATH: join(root, "maa.sqlite"),
      MAA_ARTIFACT_ROOT: join(root, "artifacts"),
      MAA_LOG_ROOT: join(root, "log"),
      MAA_BACKUP_DIR: join(root, "backups"),
      MAA_LEARNING_PLANE_SECRET_FILE: join(root, "secrets", "learning-plane-adapter.json")
    });
    expect(parsed.MAA_LEARNING_PLANE_SECRET_FILE).toContain("learning-plane-adapter.json");
  });
});
