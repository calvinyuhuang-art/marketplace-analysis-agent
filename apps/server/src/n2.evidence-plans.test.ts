import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COLLECTOR_SNAPSHOT_SCHEMA, ConfigSchema } from "@maa/contracts";
import { createApp } from "./app";
import type { ResolvedConfig } from "./config/index";
import { findRepoRoot } from "./config/paths";
import { type Container, createContainer } from "./composition/container";

const CAPABILITY = {
  platform: "amazon",
  marketplace: "US",
  category: "books",
  productType: "adult_coloring_book"
};

async function waitForStatus(
  app: Express,
  runId: string,
  predicate: (status: string) => boolean,
  timeoutMs = 12_000
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

function snapshotBody(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: COLLECTOR_SNAPSHOT_SCHEMA,
    collector: "mcec",
    collectorVersion: "1.0.0",
    capturedAt: "2026-07-28T12:00:00.000Z",
    supportedEvidenceTypes: ["listing", "review"],
    supportedFields: {
      listing: ["price", "binding", "format", "page_count", "title"],
      review: ["review_text", "rating", "review_date"]
    },
    limits: { maxItems: 5000 },
    ...overrides
  };
}

describe("N2 evidence plans / plan review", () => {
  let container: Container;
  let app: Express;
  let artifactRoot: string;
  let logRoot: string;

  beforeAll(() => {
    const repoRoot = findRepoRoot();
    artifactRoot = mkdtempSync(join(tmpdir(), "maa-n2-art-"));
    logRoot = mkdtempSync(join(tmpdir(), "maa-n2-log-"));
    const config: ResolvedConfig = {
      raw: ConfigSchema.parse({
        NODE_ENV: "test",
        MAA_WORKER_POLL_MS: "20",
        MAA_HEARTBEAT_MS: "50",
        MAA_FAKE_PHASE_DELAY_MS: "5",
        MAA_STALE_EXECUTION_MS: "200",
        MAA_DEEPSEEK_ENABLED: "false"
      }),
      repoRoot,
      databasePath: ":memory:",
      artifactRoot,
      logRoot,
      backupDir: join(artifactRoot, "backups"),
      migrationsDir: resolve(repoRoot, "migrations")
    };
    container = createContainer(config, { startWorker: true });
    app = createApp(container);
  });

  afterAll(async () => {
    await container.shutdown();
    await new Promise((r) => setTimeout(r, 50));
    rmSync(artifactRoot, { recursive: true, force: true });
    rmSync(logRoot, { recursive: true, force: true });
  });

  it("UAT Phase A: pricing plan requesting binding/format is suitable when snapshot claims support", async () => {
    const snap = await request(app)
      .post("/v1/collector-capability-snapshots")
      .send(snapshotBody());
    expect(snap.status).toBe(201);
    expect(snap.body.artifactId).toMatch(/^art_/);
    expect(snap.body.contentHash).toBeTruthy();

    const plan = await request(app)
      .post("/v1/evidence-plans")
      .send({
        projectId: "proj_n2_uat",
        client: "research-team",
        capability: CAPABILITY,
        requestedAnalysis: ["pricing"],
        requiredFields: {
          listing: ["price", "binding", "format"]
        },
        collectorCapabilitySnapshotArtifactId: snap.body.artifactId,
        collectorCapabilitySnapshotHash: snap.body.contentHash
      });
    expect(plan.status).toBe(201);
    expect(plan.body.planVersion).toBe(1);

    const review = await request(app)
      .post(`/v1/evidence-plans/${plan.body.planId}/review`)
      .send({ client: "research-team" });
    expect([200, 202]).toContain(review.status);
    const runId = review.body.runId as string;
    await waitForStatus(app, runId, (s) => s === "completed" || s === "failed");

    const reviews = await request(app).get(`/v1/evidence-plans/${plan.body.planId}/reviews`);
    expect(reviews.status).toBe(200);
    expect(reviews.body.reviews.length).toBeGreaterThanOrEqual(1);
    expect(reviews.body.reviews[0].decision).toBe("suitable");
    expect(reviews.body.reviews[0].collectorCapabilitySnapshotHash).toBe(snap.body.contentHash);

    const exp = await request(app).get(`/v1/analysis-runs/${runId}/experience`);
    expect(exp.status).toBe(200);
    expect(exp.body.operation).toBe("review_evidence_plan");
    expect(exp.body.status).toBe("completed");

    const evals = await request(app).get(
      `/v1/experiences/${exp.body.experienceId}/evaluations`
    );
    const det = (evals.body.evaluations as Array<{ decision: string; sourceSystem: string }>).find(
      (e) => e.sourceSystem === "maa.deterministic"
    );
    expect(det?.decision).toBe("suitable");
  });

  it("rejects plan fields not claimed by snapshot as unsuitable", async () => {
    const snap = await request(app)
      .post("/v1/collector-capability-snapshots")
      .send(
        snapshotBody({
          supportedFields: {
            listing: ["price", "title"],
            review: ["review_text"]
          }
        })
      );
    expect(snap.status).toBe(201);

    const plan = await request(app)
      .post("/v1/evidence-plans")
      .send({
        projectId: "proj_n2_bad_field",
        client: "research-team",
        capability: CAPABILITY,
        requestedAnalysis: ["pricing"],
        requiredFields: { listing: ["price", "binding", "format"] },
        collectorCapabilitySnapshotArtifactId: snap.body.artifactId,
        collectorCapabilitySnapshotHash: snap.body.contentHash
      });
    expect(plan.status).toBe(201);

    const review = await request(app)
      .post(`/v1/evidence-plans/${plan.body.planId}/review`)
      .send({});
    const runId = review.body.runId as string;
    await waitForStatus(app, runId, (s) => s === "completed");

    const reviews = await request(app).get(`/v1/evidence-plans/${plan.body.planId}/reviews`);
    expect(reviews.body.reviews[0].decision).toBe("unsuitable");
    const issues = reviews.body.reviews[0].report.issues as Array<{ code: string }>;
    expect(issues.some((i) => i.code === "UNSUPPORTED_FIELD")).toBe(true);
  });

  it("fails closed on snapshot hash mismatch at plan create", async () => {
    const snap = await request(app)
      .post("/v1/collector-capability-snapshots")
      .send(snapshotBody());
    expect(snap.status).toBe(201);

    const bad = await request(app)
      .post("/v1/evidence-plans")
      .send({
        projectId: "proj_n2_hash",
        client: "research-team",
        capability: CAPABILITY,
        requestedAnalysis: ["pricing"],
        requiredFields: { listing: ["price"] },
        collectorCapabilitySnapshotArtifactId: snap.body.artifactId,
        collectorCapabilitySnapshotHash: "deadbeef".repeat(8)
      });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("EVIDENCE_PROVENANCE_INVALID");
  });
});
