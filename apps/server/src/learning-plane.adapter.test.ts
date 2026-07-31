import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { ConfigSchema } from "@maa/contracts";
import { createApp } from "./app";
import { createContainer, CURRENT_DATABASE_SCHEMA_VERSION, SERVICE_VERSION } from "./composition/container";
import type { ResolvedConfig } from "./config/index";
import { findRepoRoot } from "./config/paths";
import { LearningPlaneSecretStore } from "./integrations/learning-plane/secretStore";
import { LearningPlaneAdapterRepository } from "./integrations/learning-plane/adapterRepository";
import { createBackup, restoreBackup, checkDatabaseIntegrity } from "@maa/ops";
import { Database } from "@maa/database";

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
    repoRoot: findRepoRoot(),
    databasePath: raw.MAA_DATABASE_PATH,
    artifactRoot: raw.MAA_ARTIFACT_ROOT,
    logRoot: raw.MAA_LOG_ROOT,
    backupDir: raw.MAA_BACKUP_DIR,
    migrationsDir
  };
}

function startContainer(config: ResolvedConfig) {
  const container = createContainer(config, { startWorker: false });
  containers.push(container);
  return container;
}

afterEach(async () => {
  while (containers.length) {
    const container = containers.pop();
    if (container) await container.shutdown();
  }
  while (dirs.length) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("LP8-I3b Learning Plane adapter", () => {
  it("defaults Learning Plane flags off and leaves MAA healthy without LP network calls", async () => {
    const config = makeConfig();
    const container = startContainer(config);
    const app = createApp(container);
    expect(container.serviceVersion).toBe("0.20.0");
    expect(container.databaseSchemaVersion).toBe("0017");
    expect(container.learningPlane?.config.enabled).toBe(false);
    const health = await request(app).get("/health").expect(200);
    expect(health.body.version).toBe(SERVICE_VERSION);
    const status = await request(app).get("/v1/integrations/learning-plane/status").expect(200);
    expect(status.body).toMatchObject({
      enabled: false,
      adapterState: "disabled",
      publishMode: "disabled",
      receiveMode: "disabled",
      declaredCapabilities: [],
      packageIdentity: {
        clientVersion: "0.8.1",
        contractsVersion: "0.8.1",
        apiCompat: "2026.07"
      }
    });
    expect(status.body.packageIdentity.packageChecksum.client).toMatch(/^[a-f0-9]{64}$/i);
    expect(JSON.stringify(status.body)).not.toMatch(/apiKey|operatorToken|callbackVerificationSecret/i);
  });

  it("applies migration 0017 with expected tables, indexes, and uniqueness", () => {
    const config = makeConfig();
    const container = startContainer(config);
    const db = container.database.db;
    const tables = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'lp_adapter_%' ORDER BY name"
        )
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(tables).toEqual([
      "lp_adapter_acknowledgements",
      "lp_adapter_inbox",
      "lp_adapter_outbox",
      "lp_adapter_processing_events",
      "lp_adapter_settings"
    ]);
    const versions = (
      db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as {
        version: string;
      }[]
    ).map((row) => row.version);
    expect(versions).toContain("0017");
    expect(CURRENT_DATABASE_SCHEMA_VERSION).toBe("0017");

    const repo = new LearningPlaneAdapterRepository(db);
    repo.recordProcessingEvent({ eventKind: "learning_plane.adapter_enabled", detail: { t: 1 } });
    expect(repo.processingEventCount()).toBeGreaterThan(0);

    db.prepare(
      `INSERT INTO lp_adapter_outbox (
        outbox_id, event_type, payload_schema_version, idempotency_key, status, attempt_count, created_at, updated_at
      ) VALUES ('o1','t','v1','idem-1','pending',0,?,?)`
    ).run(new Date().toISOString(), new Date().toISOString());
    expect(() =>
      db
        .prepare(
          `INSERT INTO lp_adapter_outbox (
            outbox_id, event_type, payload_schema_version, idempotency_key, status, attempt_count, created_at, updated_at
          ) VALUES ('o2','t','v1','idem-1','pending',0,?,?)`
        )
        .run(new Date().toISOString(), new Date().toISOString())
    ).toThrow();

    db.prepare(
      `INSERT INTO lp_adapter_inbox (
        inbox_id, event_id, delivery_id, event_type, received_at, processing_status, acknowledgement_status
      ) VALUES ('i1','e1','d1','t',?,'received','pending')`
    ).run(new Date().toISOString());
    expect(() =>
      db
        .prepare(
          `INSERT INTO lp_adapter_inbox (
            inbox_id, event_id, delivery_id, event_type, received_at, processing_status, acknowledgement_status
          ) VALUES ('i2','e1','d2','t',?,'received','pending')`
        )
        .run(new Date().toISOString())
    ).toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO lp_adapter_inbox (
            inbox_id, event_id, delivery_id, event_type, received_at, processing_status, acknowledgement_status
          ) VALUES ('i3','e2','d1','t',?,'received','pending')`
        )
        .run(new Date().toISOString())
    ).toThrow();

    expect(checkDatabaseIntegrity(db).ok).toBe(true);
  });

  it("stores secrets outside SQLite and redacts secret-like fields", () => {
    const root = mkdtempSync(join(tmpdir(), "maa-secret-"));
    dirs.push(root);
    const secretPath = join(root, "learning-plane-adapter.json");
    const store = new LearningPlaneSecretStore(secretPath);
    store.save({
      agentId: "marketplace-analysis-agent",
      learningPlaneBaseUrl: "http://127.0.0.1:4330",
      credentialId: "cred_test",
      callbackKeyId: "lp-delivery-hmac-v1",
      agentApiKey: "a".repeat(32),
      callbackVerificationSecret: "b".repeat(32)
    });
    expect(existsSync(secretPath)).toBe(true);
    const loaded = store.load();
    expect(loaded?.credentialId).toBe("cred_test");
    const redacted = LearningPlaneSecretStore.redactForLogs(loaded);
    expect(JSON.stringify(redacted)).not.toContain("a".repeat(32));
    expect(JSON.stringify(redacted)).toContain("[REDACTED]");
    expect(() => {
      writeFileSync(secretPath, "{not-json");
      store.load();
    }).toThrow(/malformed/i);
  });

  it("reports active publish/receive modes and declares production capabilities", async () => {
    const config = makeConfig({
      MAA_LEARNING_PLANE_ENABLED: "true",
      MAA_LEARNING_PLANE_PUBLISH_ENABLED: "true",
      MAA_LEARNING_PLANE_RECEIVE_ENABLED: "true"
    });
    const container = startContainer(config);
    const app = createApp(container);
    const status = await request(app).get("/v1/integrations/learning-plane/status").expect(200);
    expect(status.body.publishMode).toBe("active");
    expect(status.body.receiveMode).toBe("active");
    expect(status.body.implementationMilestone).toBe("LP8-I3b");
    expect(status.body.declaredCapabilities).toEqual([
      "health.report",
      "events.publish",
      "events.receive",
      "events.acknowledge"
    ]);
    expect(status.body.packageIdentity.clientVersion).toBe("0.8.1");
    expect(status.body.maaDatabaseSchemaVersion).toBe("0017");

    const callback = await request(app)
      .post("/v1/learning-plane/deliveries")
      .send({ eventId: "evt_fixture", type: "workflow_feedback.created" })
      .expect(503);
    expect(callback.body.error.code).toBe("LP_ADAPTER_SECRETS_MISSING");

    const inboxCount = Number(
      (
        container.database.db.prepare("SELECT COUNT(*) AS c FROM lp_adapter_inbox").get() as {
          c: number;
        }
      ).c
    );
    const outboxCount = Number(
      (
        container.database.db.prepare("SELECT COUNT(*) AS c FROM lp_adapter_outbox").get() as {
          c: number;
        }
      ).c
    );
    expect(inboxCount).toBe(0);
    expect(outboxCount).toBe(0);
  });

  it("bootstraps against a Learning Plane fixture, reconciles, reports health, and survives outage", async () => {
    const http = await import("node:http");
    let healthCalls = 0;
    const lp = http.createServer((req, res) => {
      const url = req.url ?? "";
      res.setHeader("content-type", "application/json");
      if (url === "/health") {
        res.end(
          JSON.stringify({
            status: "ok",
            service: "sales-os-learning-plane",
            serviceVersion: "0.7.0",
            apiCompat: "2026.07",
            milestone: "LP7"
          })
        );
        return;
      }
      if (req.method === "POST" && url === "/v1/agents/register") {
        const auth = req.headers.authorization ?? "";
        if (!auth.includes("operator-token-fixture")) {
          res.statusCode = 401;
          res.end(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "bad token" } }));
          return;
        }
        res.statusCode = 201;
        res.end(
          JSON.stringify({
            agent: {
              agentId: "marketplace-analysis-agent",
              displayName: "Marketplace Analysis Agent",
              agentType: "marketplace_analysis",
              serviceVersion: "0.19.0",
              supportedContractVersions: ["1.0"],
              contractCompatibility: "compatible",
              baseUrl: "http://127.0.0.1:4320",
              callbackPath: "/v1/learning-plane/deliveries",
              healthEndpointPath: "/health",
              capabilities: ["health.report"],
              capabilityRevision: 1,
              enabled: true,
              credentialId: "cred_fixture_1",
              lastHealthAvailability: null,
              lastHealthAt: null,
              registeredAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            },
            agentApiKey: "k".repeat(40),
            callbackVerificationSecret: "s".repeat(40)
          })
        );
        return;
      }
      if (req.method === "PUT" && url.includes("/capabilities")) {
        res.end(
          JSON.stringify({
            agent: {
              agentId: "marketplace-analysis-agent",
              displayName: "Marketplace Analysis Agent",
              agentType: "marketplace_analysis",
              serviceVersion: "0.19.0",
              supportedContractVersions: ["1.0"],
              contractCompatibility: "compatible",
              baseUrl: "http://127.0.0.1:4320",
              callbackPath: "/v1/learning-plane/deliveries",
              healthEndpointPath: "/health",
              capabilities: ["health.report"],
              capabilityRevision: 2,
              enabled: true,
              credentialId: "cred_fixture_1",
              lastHealthAvailability: null,
              lastHealthAt: null,
              registeredAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
          })
        );
        return;
      }
      if (req.method === "POST" && url.includes("/health")) {
        healthCalls += 1;
        if (healthCalls === 2) {
          res.statusCode = 503;
          res.end(JSON.stringify({ error: { code: "UNAVAILABLE", message: "down" } }));
          return;
        }
        res.end(
          JSON.stringify({
            health: {
              checkId: `chk_${healthCalls}`,
              agentId: "marketplace-analysis-agent",
              availability: "healthy",
              serviceVersion: "0.19.0",
              reportedContractVersion: "1.0",
              diagnosticSummary: "ok",
              reportedAt: new Date().toISOString()
            }
          })
        );
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: url } }));
    });
    await new Promise<void>((resolveListen) => lp.listen(0, "127.0.0.1", resolveListen));
    const address = lp.address();
    if (!address || typeof address === "string") throw new Error("LP fixture bind failed");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const config = makeConfig({
      MAA_LEARNING_PLANE_ENABLED: "true",
      MAA_LEARNING_PLANE_BASE_URL: baseUrl
    });
    const container = startContainer(config);
    const app = createApp(container);

    const boot = await request(app)
      .post("/v1/integrations/learning-plane/bootstrap")
      .send({ operatorToken: "operator-token-fixture" })
      .expect(200);
    expect(boot.body).toMatchObject({
      status: "bootstrapped",
      agentId: "marketplace-analysis-agent",
      credentialId: "cred_fixture_1",
      capabilities: ["health.report"],
      operatorTokenRetained: false
    });
    expect(JSON.stringify(boot.body)).not.toContain("k".repeat(40));
    expect(existsSync(container.learningPlane!.config.secretFilePath)).toBe(true);
    const secretRaw = readFileSync(container.learningPlane!.config.secretFilePath, "utf8");
    expect(secretRaw).toContain("k".repeat(40));

    const settingsRows = container.database.db
      .prepare("SELECT credential_id FROM lp_adapter_settings")
      .all() as Array<{ credential_id: string }>;
    expect(settingsRows[0]?.credential_id).toBe("cred_fixture_1");
    expect(JSON.stringify(settingsRows)).not.toContain("k".repeat(40));

    const reconciled = await request(app)
      .post("/v1/integrations/learning-plane/registration/reconcile")
      .expect(200);
    expect(reconciled.body.registrationStatus).toBe("reconciled");

    const reported = await request(app)
      .post("/v1/integrations/learning-plane/health/report")
      .expect(200);
    expect(reported.body.availability).toBe("healthy");

    const failed = await request(app)
      .post("/v1/integrations/learning-plane/health/report")
      .expect(200);
    expect(failed.body.availability).toBe("unhealthy");
    const status = await request(app).get("/v1/integrations/learning-plane/status").expect(200);
    expect(status.body.lastErrorCode).toBe("LP_HEALTH_REPORT_FAILED");

    // Recovery
    const recovered = await request(app)
      .post("/v1/integrations/learning-plane/health/report")
      .expect(200);
    expect(recovered.body.availability).toBe("healthy");

    const backup = createBackup({
      databasePath: container.config.databasePath,
      backupDir: container.config.backupDir,
      serviceVersion: SERVICE_VERSION,
      databaseSchemaVersion: container.databaseSchemaVersion,
      notes: "lp8-i1-uat"
    });
    expect(JSON.stringify(backup.manifest)).not.toContain("k".repeat(40));
    const restoredPath = join(container.config.repoRoot, "restored.sqlite");
    restoreBackup({
      backupPath: backup.backupPath,
      databasePath: restoredPath,
      maxSupportedDatabaseSchemaVersion: "0017"
    });
    const restored = Database.open({ path: restoredPath });
    const restoredTables = (
      restored.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'lp_adapter_%'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(restoredTables).toHaveLength(5);
    expect(
      (
        restored.db
          .prepare("SELECT COUNT(*) AS c FROM lp_adapter_processing_events")
          .get() as { c: number }
      ).c
    ).toBeGreaterThan(0);
    expect(
      (
        restored.db.prepare("SELECT COUNT(*) AS c FROM lp_adapter_outbox").get() as { c: number }
      ).c
    ).toBe(0);
    restored.close();
    await new Promise<void>((resolveClose) => lp.close(() => resolveClose()));
  });

  it("rejects incompatible Learning Plane API compatibility during bootstrap", async () => {
    const http = await import("node:http");
    const lp = http.createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          status: "ok",
          service: "sales-os-learning-plane",
          serviceVersion: "0.7.0",
          apiCompat: "1999.01",
          milestone: "LP7"
        })
      );
    });
    await new Promise<void>((resolveListen) => lp.listen(0, "127.0.0.1", resolveListen));
    const address = lp.address();
    if (!address || typeof address === "string") throw new Error("bind failed");
    const config = makeConfig({
      MAA_LEARNING_PLANE_ENABLED: "true",
      MAA_LEARNING_PLANE_BASE_URL: `http://127.0.0.1:${address.port}`
    });
    const container = startContainer(config);
    const app = createApp(container);
    const failed = await request(app)
      .post("/v1/integrations/learning-plane/bootstrap")
      .send({ operatorToken: "operator-token-fixture" })
      .expect(400);
    expect(failed.body.error.message).toMatch(/compatibility/i);
    await new Promise<void>((resolveClose) => lp.close(() => resolveClose()));
  });
});
