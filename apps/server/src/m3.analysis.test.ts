import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfigSchema } from "@maa/contracts";
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

describe("M3 analysis and quality gates", () => {
  let container: Container;
  let app: Express;
  let artifactRoot: string;
  let logRoot: string;

  beforeAll(() => {
    const repoRoot = findRepoRoot();
    artifactRoot = mkdtempSync(join(tmpdir(), "maa-m3-art-"));
    logRoot = mkdtempSync(join(tmpdir(), "maa-m3-log-"));
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

  it("complete evidence produces structured findings with evidence refs", async () => {
    const pkgId = "evpkg_m3_complete";
    await request(app).post("/v1/evidence-packages").send(completeKdpFixture(pkgId));

    const created = await request(app)
      .post("/v1/analysis-requests")
      .send({
        client: "research-team",
        projectId: "proj_m3_complete",
        operation: "full_marketplace_analysis",
        capability: CAPABILITY,
        productContext: {
          name: "Upstream Product From Orchestrator",
          salesGoal: "Understand market structure and pricing",
          constraints: []
        },
        requestedAnalysis: [
          "market_structure",
          "customer_evidence",
          "pricing",
          "positioning"
        ],
        evidencePackageIds: [pkgId]
      });
    expect(created.status).toBe(202);

    const status = await waitForStatus(
      app,
      created.body.runId,
      (s) => s === "completed" || s === "partial"
    );
    expect(["completed", "partial"]).toContain(status);

    const findings = await request(app).get(
      `/v1/analysis-runs/${created.body.runId}/findings`
    );
    expect(findings.status).toBe(200);
    expect(findings.body.findings.length).toBeGreaterThan(0);
    for (const f of findings.body.findings) {
      if (f.classification === "observed_fact" || f.classification === "source_reported_claim") {
        expect(f.evidenceRefs.length).toBeGreaterThan(0);
      }
    }

    const output = await request(app).get(`/v1/analysis-runs/${created.body.runId}/output`);
    expect(output.status).toBe(200);
    expect(output.body.qualityPassed).toBe(true);
    expect(output.body.output?.summary ?? output.body.summary).toBeTruthy();

    const modelCalls = await request(app).get(
      `/v1/analysis-runs/${created.body.runId}/model-calls`
    );
    expect(modelCalls.status).toBe(200);
    expect(modelCalls.body.modelCalls.length).toBeGreaterThan(0);
    expect(modelCalls.body.modelCalls[0].inputArtifactId).toBeTruthy();
    expect(modelCalls.body.modelCalls[0].outputArtifactId).toBeTruthy();

    const first = findings.body.findings[0];
    const review = await request(app)
      .post(`/v1/findings/${first.findingId}/review`)
      .send({
        action: "accept",
        notes: "Looks grounded",
        reviewerId: "operator-m3"
      });
    expect(review.status).toBe(200);
    expect(review.body.validationStatus).toBe("reviewer_accepted");

    const after = await request(app).get(
      `/v1/analysis-runs/${created.body.runId}/findings`
    );
    const updated = after.body.findings.find(
      (f: { findingId: string }) => f.findingId === first.findingId
    );
    expect(updated.validationStatus).toBe("reviewer_accepted");
  });

  it("live DeepSeek provider stays disabled by default", async () => {
    expect(container.config.raw.MAA_DEEPSEEK_ENABLED).toBe(false);
    expect(container.providers.deepseek).toBeUndefined();
    const profiles = container.repos.modelProfiles.list();
    const deepseek = profiles.filter((p) => p.provider === "deepseek");
    expect(deepseek.every((p) => !p.enabled)).toBe(true);
  });
});
