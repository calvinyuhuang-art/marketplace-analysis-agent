import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { API_COMPAT_LABEL, ConfigSchema } from "@maa/contracts";
import { completeKdpFixture } from "../../../fixtures/evidence/kdp-fixtures";
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

describe("N1 experience / evaluation capture", () => {
  let container: Container;
  let app: Express;
  let artifactRoot: string;
  let logRoot: string;

  beforeAll(() => {
    const repoRoot = findRepoRoot();
    artifactRoot = mkdtempSync(join(tmpdir(), "maa-n1-art-"));
    logRoot = mkdtempSync(join(tmpdir(), "maa-n1-log-"));
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
    await new Promise((r) => setTimeout(r, 200));
    try {
      rmSync(artifactRoot, { recursive: true, force: true });
    } catch {
      /* ignore Windows file locks */
    }
    try {
      rmSync(logRoot, { recursive: true, force: true });
    } catch {
      /* ignore Windows file locks */
    }
  });

  it("creates one experience per run with deterministic evaluation", async () => {
    const pkgId = "evpkg_n1_exp";
    await request(app).post("/v1/evidence-packages").send(completeKdpFixture(pkgId));

    const created = await request(app)
      .post("/v1/analysis-requests")
      .send({
        client: "research-team",
        projectId: "proj_n1_exp",
        operation: "full_marketplace_analysis",
        capability: CAPABILITY,
        productContext: {
          name: "N1 Experience Book",
          salesGoal: "Validate experience capture",
          constraints: []
        },
        requestedAnalysis: ["market_structure", "pricing"],
        evidencePackageIds: [pkgId]
      });
    expect(created.status).toBe(202);
    expect(created.headers["x-maa-api-compat"]).toBe(API_COMPAT_LABEL);

    const runId = created.body.runId as string;
    await waitForStatus(app, runId, (s) =>
      ["completed", "partial", "evidence_insufficient", "failed"].includes(s)
    );

    const expRes = await request(app).get(`/v1/analysis-runs/${runId}/experience`);
    expect(expRes.status).toBe(200);
    expect(expRes.body.runId).toBe(runId);
    expect(expRes.body.experienceId).toMatch(/^exp_/);
    expect(["completed", "failed", "cancelled"]).toContain(expRes.body.status);

    // Duplicate complete is safe — still one row.
    container.experienceService.complete({
      runId,
      status: "completed",
      summary: "duplicate"
    });
    const again = container.repos.experiences.getByRunId(runId);
    expect(again?.experienceId).toBe(expRes.body.experienceId);

    const evals = await request(app).get(
      `/v1/experiences/${expRes.body.experienceId}/evaluations`
    );
    expect(evals.status).toBe(200);
    const deterministic = (evals.body.evaluations as Array<{ sourceSystem: string }>).filter(
      (e) => e.sourceSystem === "maa.deterministic"
    );
    expect(deterministic.length).toBeGreaterThanOrEqual(1);
  });

  it("dual-writes finding reject without evaluation→learning_event loop", async () => {
    const pkgId = "evpkg_n1_dual";
    await request(app).post("/v1/evidence-packages").send(completeKdpFixture(pkgId));

    const created = await request(app)
      .post("/v1/analysis-requests")
      .send({
        client: "research-team",
        projectId: "proj_n1_dual",
        operation: "full_marketplace_analysis",
        capability: CAPABILITY,
        productContext: {
          name: "N1 Dual Write Book",
          salesGoal: "Validate dual-write",
          constraints: []
        },
        requestedAnalysis: ["market_structure", "pricing"],
        evidencePackageIds: [pkgId]
      });
    expect(created.status).toBe(202);
    const runId = created.body.runId as string;
    await waitForStatus(app, runId, (s) => s === "completed" || s === "partial");

    const findings = await request(app).get(`/v1/analysis-runs/${runId}/findings`);
    expect(findings.status).toBe(200);
    const target = findings.body.findings[0];
    expect(target).toBeTruthy();

    const learningBefore = container.repos.learningEvents
      ? (
          container.database.db
            .prepare(`SELECT COUNT(*) AS c FROM learning_events WHERE source_run_id = ?`)
            .get(runId) as { c: number }
        ).c
      : 0;

    const review = await request(app)
      .post(`/v1/findings/${target.findingId}/review`)
      .send({
        action: "reject",
        reasonCode: "unsupported_conclusion",
        notes: "n1 dual-write",
        reviewerId: "tester"
      });
    expect(review.status).toBe(200);

    const learningAfter = (
      container.database.db
        .prepare(`SELECT COUNT(*) AS c FROM learning_events WHERE source_run_id = ?`)
        .get(runId) as { c: number }
    ).c;
    expect(learningAfter).toBe(learningBefore + 1);

    const experience = container.experienceService.getByRunId(runId)!;
    const evaluations = container.experienceService.listEvaluations(experience.experienceId);
    const fromReview = evaluations.filter((e) => e.sourceSystem === "maa.finding_reviews");
    const fromLearning = evaluations.filter((e) => e.sourceSystem === "maa.learning_events");
    expect(fromReview.length).toBeGreaterThanOrEqual(1);
    expect(fromLearning.length).toBeGreaterThanOrEqual(1);

    // Idempotent replay of dual-write does not create extras.
    const beforeCount = evaluations.length;
    container.experienceService.recordFromLegacy({
      runId,
      evaluatorType: "human",
      decision: "reject",
      sourceSystem: "maa.finding_reviews",
      sourceRecordId: fromReview[0]!.sourceRecordId
    });
    expect(container.experienceService.listEvaluations(experience.experienceId).length).toBe(
      beforeCount
    );

    // No reverse path: evaluations never insert learning_events.
    const learningFinal = (
      container.database.db
        .prepare(`SELECT COUNT(*) AS c FROM learning_events WHERE source_run_id = ?`)
        .get(runId) as { c: number }
    ).c;
    expect(learningFinal).toBe(learningAfter);
  });

  it("rejects propose_memory_update as UNSUPPORTED_OPERATION (N7 remove)", async () => {
    const pkgId = "evpkg_n1_depr";
    await request(app).post("/v1/evidence-packages").send(completeKdpFixture(pkgId));

    const res = await request(app)
      .post("/v1/analysis-requests")
      .send({
        client: "research-team",
        projectId: "proj_n1_depr",
        operation: "propose_memory_update",
        capability: CAPABILITY,
        productContext: {
          name: "N1 Deprecation",
          salesGoal: "headers",
          constraints: []
        },
        requestedAnalysis: ["market_structure"],
        evidencePackageIds: [pkgId]
      });

    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe("UNSUPPORTED_OPERATION");
    expect(res.headers["x-maa-api-compat"]).toBe(API_COMPAT_LABEL);
  });
});
