import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfigSchema } from "@maa/contracts";
import {
  completeKdpFixture,
  listingsWithoutReviewsFixture
} from "../../../fixtures/evidence/kdp-fixtures";
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

describe("M4 revision and learning events", () => {
  let container: Container;
  let app: Express;
  let artifactRoot: string;
  let logRoot: string;

  beforeAll(() => {
    const repoRoot = findRepoRoot();
    artifactRoot = mkdtempSync(join(tmpdir(), "maa-m4-art-"));
    logRoot = mkdtempSync(join(tmpdir(), "maa-m4-log-"));
    const config: ResolvedConfig = {
      raw: ConfigSchema.parse({
        NODE_ENV: "test",
        MAA_WORKER_POLL_MS: "20",
        MAA_HEARTBEAT_MS: "50",
        MAA_FAKE_PHASE_DELAY_MS: "5",
        MAA_STALE_EXECUTION_MS: "200"
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

  it("revises a completed run with supplemental evidence and records learning + diff", async () => {
    const basePkg = "evpkg_m4_base";
    const suppPkg = "evpkg_m4_supp";
    await request(app)
      .post("/v1/evidence-packages")
      .send(listingsWithoutReviewsFixture(basePkg));
    await request(app).post("/v1/evidence-packages").send(completeKdpFixture(suppPkg));

    const created = await request(app)
      .post("/v1/analysis-requests")
      .send({
        client: "research-team",
        projectId: "proj_m4_rev",
        operation: "full_marketplace_analysis",
        capability: CAPABILITY,
        productContext: {
          name: "Upstream Product",
          salesGoal: "pricing + customer",
          constraints: []
        },
        requestedAnalysis: ["market_structure", "pricing", "customer_evidence"],
        evidencePackageIds: [basePkg]
      });
    expect(created.status).toBe(202);

    const priorStatus = await waitForStatus(
      app,
      created.body.runId,
      (s) => s === "completed" || s === "partial" || s === "evidence_insufficient"
    );
    expect(["completed", "partial", "evidence_insufficient"]).toContain(priorStatus);

    const priorFindings = await request(app).get(
      `/v1/analysis-runs/${created.body.runId}/findings`
    );
    expect(priorFindings.status).toBe(200);

    // Reject a finding if present; otherwise revise customer_evidence area explicitly.
    const firstFinding = priorFindings.body.findings[0] as
      | { findingId: string; analysisArea: string }
      | undefined;
    if (firstFinding) {
      const review = await request(app)
        .post(`/v1/findings/${firstFinding.findingId}/review`)
        .send({
          action: "reject",
          reasonCode: "unsupported_conclusion",
          notes: "Needs better evidence",
          reviewerId: "operator-m4"
        });
      expect(review.status).toBe(200);
      expect(review.body.validationStatus).toBe("reviewer_rejected");
    }

    const revise = await request(app)
      .post(`/v1/analysis-runs/${created.body.runId}/revise`)
      .send({
        reasonCode: "missing_analysis",
        notes: "Add reviews and re-run customer + pricing",
        reviewerId: "operator-m4",
        affectedAreas: ["customer_evidence", "pricing"],
        findingIds: firstFinding ? [firstFinding.findingId] : [],
        supplementalEvidencePackageIds: [suppPkg]
      });
    expect(revise.status).toBe(202);
    expect(revise.body.priorRunId).toBe(created.body.runId);
    expect(revise.body.attemptNumber).toBeGreaterThan(1);
    expect(revise.body.affectedAreas).toEqual(
      expect.arrayContaining(["customer_evidence", "pricing"])
    );
    expect(revise.body.evidencePackageIds).toEqual(
      expect.arrayContaining([basePkg, suppPkg])
    );
    expect(revise.body.learningEventId).toMatch(/^learn_/);

    // Prior output remains available (immutable).
    const priorOutput = await request(app).get(
      `/v1/analysis-runs/${created.body.runId}/output`
    );
    expect(priorOutput.status).toBe(200);

    const revStatus = await waitForStatus(
      app,
      revise.body.runId,
      (s) => s === "completed" || s === "partial"
    );
    expect(["completed", "partial"]).toContain(revStatus);

    const revRun = await request(app).get(`/v1/analysis-runs/${revise.body.runId}`);
    expect(revRun.body.priorRunId).toBe(created.body.runId);

    const diff = await request(app).get(
      `/v1/analysis-runs/${revise.body.runId}/revision-diff`
    );
    expect(diff.status).toBe(200);
    expect(diff.body.priorRunId).toBe(created.body.runId);
    expect(diff.body.revisionRunId).toBe(revise.body.runId);
    expect(Array.isArray(diff.body.entries)).toBe(true);

    const learning = await request(app).get(
      `/v1/analysis-runs/${revise.body.runId}/learning-events`
    );
    expect(learning.status).toBe(200);
    const types = learning.body.learningEvents.map(
      (e: { eventType: string }) => e.eventType
    );
    expect(types).toContain("revision_requested");
    expect(types).toContain("revision_completed");

    // Rejected prior finding stays preserved (or superseded if replaced).
    if (firstFinding) {
      const priorAfter = await request(app).get(
        `/v1/analysis-runs/${created.body.runId}/findings`
      );
      const stillThere = priorAfter.body.findings.find(
        (f: { findingId: string }) => f.findingId === firstFinding.findingId
      );
      expect(stillThere).toBeTruthy();
      expect(["reviewer_rejected", "superseded"]).toContain(stillThere.validationStatus);
    }

    const runReview = await request(app)
      .post(`/v1/analysis-runs/${revise.body.runId}/review`)
      .send({
        action: "accept_run",
        notes: "Looks good after revision",
        reviewerId: "operator-m4"
      });
    expect(runReview.status).toBe(200);

    const timeline = await request(app).get(
      `/v1/analysis-runs/${created.body.runId}/reviews`
    );
    expect(timeline.status).toBe(200);
  });
});
