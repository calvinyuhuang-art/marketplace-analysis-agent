import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfigSchema } from "@maa/contracts";
import {
  pricingMissingBindingFixture,
  pricingWithBindingFixture
} from "../../../fixtures/evidence/kdp-fixtures";
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

describe("N3 workflow feedback / late-gap loop", () => {
  let container: Container;
  let app: Express;
  let artifactRoot: string;
  let logRoot: string;

  beforeAll(() => {
    const repoRoot = findRepoRoot();
    artifactRoot = mkdtempSync(join(tmpdir(), "maa-n3-art-"));
    logRoot = mkdtempSync(join(tmpdir(), "maa-n3-log-"));
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

  it("detects late gap → RT resolve → revise → resolution quality (UAT Phase B)", async () => {
    expect(SERVICE_VERSION).toMatch(/^0\.(1[3-9]|[2-9]\d)\.\d+$/);
    expect(CURRENT_DATABASE_SCHEMA_VERSION).toMatch(/^001[1-6]$/);

    const pkgId = "evpkg_n3_no_binding";
    await request(app)
      .post("/v1/evidence-packages")
      .send(pricingMissingBindingFixture(pkgId));

    const created = await request(app)
      .post("/v1/analysis-requests")
      .send({
        client: "research-team",
        projectId: "proj_n3_late_gap",
        operation: "full_marketplace_analysis",
        capability: CAPABILITY,
        productContext: {
          name: "N3 Late Gap Book",
          salesGoal: "Pricing with late binding gap",
          constraints: []
        },
        requestedAnalysis: ["pricing", "market_structure"],
        evidencePackageIds: [pkgId]
      });
    expect(created.status).toBe(202);
    const runId = created.body.runId as string;
    await waitForStatus(app, runId, (s) =>
      ["completed", "partial", "failed"].includes(s)
    );

    const feedbackList = await request(app).get(
      `/v1/analysis-runs/${runId}/workflow-feedback`
    );
    expect(feedbackList.status).toBe(200);
    expect(feedbackList.body.events.length).toBe(1);
    expect(feedbackList.body.events[0].status).toBe("detected");
    expect(feedbackList.body.events[0].collectionRequestIds.length).toBeGreaterThan(0);
    expect(feedbackList.body.events[0].candidateLessonStatus).toBe("none");

    const feedbackId = feedbackList.body.events[0].workflowFeedbackId as string;
    const fp = await request(app).get(
      `/v1/gap-fingerprints/${feedbackList.body.events[0].gapFingerprintId}`
    );
    expect(fp.status).toBe(200);
    expect(fp.body.projectWarning).toBe(false);

    const suppId = "evpkg_n3_with_binding";
    await request(app)
      .post("/v1/evidence-packages")
      .send(pricingWithBindingFixture(suppId));

    const resolved = await request(app)
      .post(`/v1/workflow-feedback/${feedbackId}/resolve`)
      .send({
        resolutionAction: "supplemental_collection",
        supplementalEvidencePackageIds: [suppId],
        actorId: "research-team"
      });
    expect(resolved.status).toBe(200);
    expect(resolved.body.status).toBe("supplemental_attached");

    const revision = await request(app)
      .post(`/v1/analysis-runs/${runId}/revise`)
      .send({
        reasonCode: "missing_analysis",
        reviewerId: "research-team",
        affectedAreas: ["pricing"],
        supplementalEvidencePackageIds: [suppId],
        workflowFeedbackId: feedbackId
      });
    expect(revision.status).toBe(202);
    const revRunId = revision.body.runId as string;
    await waitForStatus(app, revRunId, (s) =>
      ["completed", "partial", "failed"].includes(s)
    );

    const after = await request(app).get(`/v1/workflow-feedback/${feedbackId}`);
    expect(after.status).toBe(200);
    expect(["resolved", "partially_resolved"]).toContain(after.body.status);
    expect(after.body.resolutionQuality).toBeTruthy();
    expect(after.body.revisionRunId).toBe(revRunId);
    expect(after.body.candidateLessonStatus).toBe("none");
    expect(typeof after.body.addedDurationMs).toBe("number");
  });
});
