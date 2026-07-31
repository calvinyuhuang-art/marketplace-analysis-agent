import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfigSchema } from "@maa/contracts";
import { pricingWithBindingFixture } from "../../../fixtures/evidence/kdp-fixtures";
import { createApp } from "./app";
import type { ResolvedConfig } from "./config/index";
import { findRepoRoot } from "./config/paths";
import {
  CURRENT_DATABASE_SCHEMA_VERSION,
  type Container,
  createContainer,
  SERVICE_VERSION
} from "./composition/container";

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

describe("N5 outcome events / reassessment", () => {
  let container: Container;
  let app: Express;
  let artifactRoot: string;
  let logRoot: string;

  beforeAll(() => {
    const repoRoot = findRepoRoot();
    artifactRoot = mkdtempSync(join(tmpdir(), "maa-n5-art-"));
    logRoot = mkdtempSync(join(tmpdir(), "maa-n5-log-"));
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
      /* ignore */
    }
    try {
      rmSync(logRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("ingests outcomes, reassesses with responsibility filter, keeps history immutable", async () => {
    expect(SERVICE_VERSION).toMatch(/^0\.(15|16|17|18|19)\.\d+$/);
    expect(CURRENT_DATABASE_SCHEMA_VERSION).toMatch(/^001[3-6]$/);

    const pkgId = "evpkg_n5_pricing";
    await request(app).post("/v1/evidence-packages").send(pricingWithBindingFixture(pkgId));

    const created = await request(app)
      .post("/v1/analysis-requests")
      .send({
        client: "research-team",
        projectId: "proj_n5_outcomes",
        operation: "full_marketplace_analysis",
        capability: CAPABILITY,
        productContext: {
          name: "N5 Outcome Book",
          salesGoal: "Link outcomes to prior analysis",
          constraints: []
        },
        requestedAnalysis: ["pricing", "market_structure"],
        evidencePackageIds: [pkgId]
      });
    expect(created.status).toBe(202);
    const priorRunId = created.body.runId as string;
    await waitForStatus(app, priorRunId, (s) =>
      ["completed", "partial", "failed"].includes(s)
    );

    const priorRunRow = container.repos.runs.getById(priorRunId);
    expect(priorRunRow).toBeTruthy();
    const priorOutputId = priorRunRow!.outputArtifactId;
    expect(priorOutputId).toBeTruthy();
    const priorArtifact = container.repos.artifacts.getById(priorOutputId!);
    expect(priorArtifact).toBeTruthy();
    const priorBytes = readFileSync(
      resolve(artifactRoot, priorArtifact!.relativePath)
    );
    const priorHash = priorArtifact!.contentHash;

    const experience = await request(app).get(
      `/v1/analysis-runs/${priorRunId}/experience`
    );
    expect(experience.status).toBe(200);
    const experienceId = experience.body.experienceId as string;

    // 1) No-traffic → inconclusive (not analysis_failed)
    const noTraffic = await request(app)
      .post("/v1/outcomes")
      .send({
        projectId: "proj_n5_outcomes",
        eventType: "sales_window",
        metrics: { noTraffic: true, traffic: 0, sales: 0 },
        source: "research_team",
        linkedRunId: priorRunId,
        linkedExperienceId: experienceId,
        linkedFindingIds: [],
        occurredAt: new Date().toISOString()
      });
    expect(noTraffic.status).toBe(201);
    const outcomeA = noTraffic.body.outcomeId as string;

    const reassessA = await request(app)
      .post(`/v1/outcomes/${outcomeA}/reassess`)
      .send({ client: "research-team", actorId: "rt-n5" });
    expect(reassessA.status).toBe(202);
    const runA = reassessA.body.runId as string;
    const statusA = await waitForStatus(app, runA, (s) =>
      ["completed", "partial", "failed"].includes(s)
    );
    expect(statusA).toBe("completed");
    expect(statusA).not.toBe("failed");

    const gotA = await request(app).get(`/v1/outcomes/${outcomeA}`);
    expect(gotA.status).toBe(200);
    expect(gotA.body.reassessments.length).toBe(1);
    expect(gotA.body.reassessments[0].judgments[0].judgment).toBe(
      "inconclusive_traffic_or_execution"
    );

    // 2) Execution-only failure → outside_maa_responsibility
    const execFail = await request(app)
      .post("/v1/outcomes")
      .send({
        projectId: "proj_n5_outcomes",
        eventType: "listing_execution",
        metrics: { listingPublished: false, executionBlocked: true },
        source: "research_team",
        linkedRunId: priorRunId,
        linkedExperienceId: experienceId,
        occurredAt: new Date().toISOString()
      });
    expect(execFail.status).toBe(201);
    const outcomeB = execFail.body.outcomeId as string;
    const reassessB = await request(app)
      .post(`/v1/outcomes/${outcomeB}/reassess`)
      .send({ client: "research-team" });
    expect(reassessB.status).toBe(202);
    await waitForStatus(app, reassessB.body.runId, (s) =>
      ["completed", "failed"].includes(s)
    );
    const gotB = await request(app).get(`/v1/outcomes/${outcomeB}`);
    expect(gotB.body.reassessments[0].judgments[0].judgment).toBe(
      "outside_maa_responsibility"
    );

    // 3) Prior output artifact unchanged
    const afterArtifact = container.repos.artifacts.getById(priorOutputId!);
    expect(afterArtifact!.contentHash).toBe(priorHash);
    const afterBytes = readFileSync(
      resolve(artifactRoot, afterArtifact!.relativePath)
    );
    expect(Buffer.compare(priorBytes, afterBytes)).toBe(0);

    const evals = await request(app).get(
      `/v1/experiences/${experienceId}/evaluations`
    );
    expect(evals.status).toBe(200);
    expect(
      evals.body.evaluations.some(
        (e: { sourceSystem: string }) => e.sourceSystem === "maa.outcome_reassess"
      )
    ).toBe(true);

    const listed = await request(app).get(
      "/v1/projects/proj_n5_outcomes/outcomes"
    );
    expect(listed.status).toBe(200);
    expect(listed.body.outcomes.length).toBeGreaterThanOrEqual(2);
  });
});
