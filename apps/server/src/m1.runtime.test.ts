import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfigSchema } from "@maa/contracts";
import { minimalFixture } from "../../../fixtures/evidence/kdp-fixtures";
import { createApp } from "./app";
import { findRepoRoot } from "./config/paths";
import { type Container, createContainer } from "./composition/container";
import type { ResolvedConfig } from "./config/index";

const CAPABILITY = {
  platform: "amazon",
  marketplace: "US",
  category: "books",
  productType: "adult_coloring_book"
};

const SHARED_PACKAGE_ID = "evpkg_m1_shared";

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    client: "research-team",
    projectId: "proj_test_lofi",
    operation: "full_marketplace_analysis",
    capability: CAPABILITY,
    productContext: {
      name: "Lofi Rainy Day Coloring Book",
      salesGoal: "Validate pricing and competitor set for launch",
      constraints: []
    },
    requestedAnalysis: ["market_structure", "pricing"],
    evidencePackageIds: [SHARED_PACKAGE_ID],
    ...overrides
  };
}

async function waitForStatus(
  app: Express,
  runId: string,
  predicate: (status: string) => boolean,
  timeoutMs = 5000
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await request(app).get(`/v1/analysis-runs/${runId}`);
    if (res.status === 200 && predicate(res.body.status)) {
      return res.body.status as string;
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  const final = await request(app).get(`/v1/analysis-runs/${runId}`);
  throw new Error(`Timeout waiting for status. Last status=${final.body.status}`);
}

describe("M1 durable analysis runtime", () => {
  let container: Container;
  let app: Express;
  let artifactRoot: string;
  let logRoot: string;

  beforeAll(() => {
    const repoRoot = findRepoRoot();
    artifactRoot = mkdtempSync(join(tmpdir(), "maa-m1-art-"));
    logRoot = mkdtempSync(join(tmpdir(), "maa-m1-log-"));
    const config: ResolvedConfig = {
      raw: ConfigSchema.parse({
        NODE_ENV: "test",
        MAA_WORKER_POLL_MS: "20",
        MAA_HEARTBEAT_MS: "50",
        MAA_FAKE_PHASE_DELAY_MS: "10",
        MAA_STALE_EXECUTION_MS: "200"
      }),
      repoRoot,
      databasePath: ":memory:",
      artifactRoot,
      logRoot,
      backupDir: join(artifactRoot, "backups"),
      migrationsDir: resolve(repoRoot, "migrations")
    };
    // Start worker so durable fake workflow advances in these tests.
    container = createContainer(config, { startWorker: true });
    app = createApp(container);
    container.evidenceService.register(minimalFixture(SHARED_PACKAGE_ID));
  });

  afterAll(async () => {
    await container.shutdown();
    // Brief pause so any late async writes don't race directory deletion.
    await new Promise((r) => setTimeout(r, 50));
    rmSync(artifactRoot, { recursive: true, force: true });
    rmSync(logRoot, { recursive: true, force: true });
  });

  it("rejects free-chat with UNSUPPORTED_CAPABILITY and zero model calls", async () => {
    container.providers.fake.resetCallCount();
    const res = await request(app)
      .post("/v1/analysis-requests")
      .send({ message: "hey, analyze the market for me" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("UNSUPPORTED_CAPABILITY");
    expect(container.providers.fake.generateCallCount).toBe(0);
  });

  it("rejects unknown operation before any model call", async () => {
    container.providers.fake.resetCallCount();
    const res = await request(app)
      .post("/v1/analysis-requests")
      .send(validBody({ operation: "write_social_posts" }));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("UNSUPPORTED_CAPABILITY");
    expect(container.providers.fake.generateCallCount).toBe(0);
  });

  it("rejects unsupported capability pack before model call", async () => {
    container.providers.fake.resetCallCount();
    const res = await request(app)
      .post("/v1/analysis-requests")
      .send(
        validBody({
          capability: {
            platform: "etsy",
            marketplace: "US",
            category: "books",
            productType: "adult_coloring_book"
          }
        })
      );
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("UNSUPPORTED_CAPABILITY");
    expect(container.providers.fake.generateCallCount).toBe(0);
  });

  it("returns 202 with durable IDs for a valid request", async () => {
    const res = await request(app).post("/v1/analysis-requests").send(validBody());
    expect(res.status).toBe(202);
    expect(res.body.requestId).toMatch(/^req_/);
    expect(res.body.runId).toMatch(/^run_/);
    expect(res.body.statusUrl).toBe(`/v1/analysis-runs/${res.body.runId}`);
    expect(res.headers["x-correlation-id"]).toBeTruthy();
  });

  it("reuses the same canonical run on double submit with identical idempotency key", async () => {
    const body = validBody({
      projectId: "proj_idem_1",
      idempotencyKey: "wo-123:marketplace-analysis:v1"
    });
    const first = await request(app).post("/v1/analysis-requests").send(body);
    const second = await request(app).post("/v1/analysis-requests").send(body);
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(second.body.requestId).toBe(first.body.requestId);
    expect(second.body.runId).toBe(first.body.runId);
  });

  it("conflicts when idempotency key is reused with a different payload", async () => {
    const key = "wo-conflict:v1";
    const first = await request(app)
      .post("/v1/analysis-requests")
      .send(validBody({ projectId: "proj_idem_2", idempotencyKey: key }));
    expect(first.status).toBe(202);
    const second = await request(app)
      .post("/v1/analysis-requests")
      .send(
        validBody({
          projectId: "proj_idem_2",
          idempotencyKey: key,
          requestedAnalysis: ["customer_evidence"]
        })
      );
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("worker advances the run to completed after the HTTP response", async () => {
    const res = await request(app)
      .post("/v1/analysis-requests")
      .send(validBody({ projectId: "proj_complete_1" }));
    expect(res.status).toBe(202);
    const status = await waitForStatus(app, res.body.runId, (s) => s === "completed");
    expect(status).toBe("completed");

    const events = await request(app).get(`/v1/runs/${res.body.runId}/events`);
    expect(events.status).toBe(200);
    const transitions = (events.body.events as { eventType: string; toStatus: string }[]).filter(
      (e) => e.eventType === "status_transition"
    );
    expect(transitions.some((t) => t.toStatus === "planning")).toBe(true);
    expect(transitions.some((t) => t.toStatus === "completed")).toBe(true);

    const audit = await request(app).get(`/v1/runs/${res.body.runId}/audit`);
    expect(audit.status).toBe(200);
    expect(audit.body.events.length).toBeGreaterThan(0);
  });

  it("cancels a run durably", async () => {
    container.worker.stop();
    try {
      const res = await request(app)
        .post("/v1/analysis-requests")
        .send(validBody({ projectId: "proj_cancel_1", timeoutSeconds: 60 }));
      expect(res.status).toBe(202);

      const cancel = await request(app)
        .post(`/v1/analysis-runs/${res.body.runId}/cancel`)
        .send({ client: "research-team" });
      expect(cancel.status).toBe(200);
      expect(cancel.body.status).toBe("cancelled");
      expect(cancel.body.cancelRequestedAt).toBeTruthy();

      const run = await request(app).get(`/v1/analysis-runs/${res.body.runId}`);
      expect(run.body.status).toBe("cancelled");
    } finally {
      container.worker.start();
    }
  });

  it("recovers a stale held lock and completes the run", async () => {
    container.worker.stop();

    const res = await request(app)
      .post("/v1/analysis-requests")
      .send(validBody({ projectId: "proj_stale_1" }));
    expect(res.status).toBe(202);
    const runId = res.body.runId as string;

    // Simulate a crashed worker holding an expired lease mid-phase.
    const lockKey = `run:${runId}`;
    container.database.db
      .prepare(
        `INSERT INTO execution_locks
          (lock_key, run_id, execution_id, owner_instance, acquired_at,
           lease_expires_at, heartbeat_at, released_at, status)
         VALUES (?, ?, 'exec_dead', 'dead-instance', ?, ?, ?, NULL, 'held')
         ON CONFLICT(lock_key) DO UPDATE SET
           run_id = excluded.run_id,
           execution_id = excluded.execution_id,
           owner_instance = excluded.owner_instance,
           lease_expires_at = excluded.lease_expires_at,
           heartbeat_at = excluded.heartbeat_at,
           status = 'held',
           released_at = NULL`
      )
      .run(
        lockKey,
        runId,
        new Date(Date.now() - 60_000).toISOString(),
        new Date(Date.now() - 60_000).toISOString(),
        new Date(Date.now() - 60_000).toISOString()
      );

    container.repos.runs.update({
      runId,
      status: "planning",
      currentPhase: "planning",
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      heartbeatAt: new Date(Date.now() - 60_000).toISOString(),
      updatedAt: new Date().toISOString()
    });

    container.worker.start();
    await container.worker.tick();
    await container.worker.tick();

    const status = await waitForStatus(app, runId, (s) => s === "completed", 8000);
    expect(status).toBe("completed");
  }, 15_000);

  it("creates and fetches projects from upstream product context", async () => {
    const created = await request(app)
      .post("/v1/projects")
      .send({
        name: "Upstream Product X",
        capability: CAPABILITY,
        productContext: {
          name: "Upstream Product X",
          salesGoal: "Find whitespace in niche",
          constraints: ["no hardcover"]
        }
      });
    expect(created.status).toBe(201);
    expect(created.body.productContext.name).toBe("Upstream Product X");

    const fetched = await request(app).get(`/v1/projects/${created.body.projectId}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.name).toBe("Upstream Product X");
  });
});
