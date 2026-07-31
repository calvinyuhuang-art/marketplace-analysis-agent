import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfigSchema } from "@maa/contracts";
import { pricingMissingBindingFixture } from "../../../fixtures/evidence/kdp-fixtures";
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

async function proposeReplayApproveActivate(
  app: Express,
  ruleType: string,
  params: Record<string, unknown>,
  actorId: string
): Promise<string> {
  const proposed = await request(app)
    .post(`/v1/typed-procedural-rules/${ruleType}/versions`)
    .send({ params, createdBy: actorId });
  expect(proposed.status).toBe(201);
  const versionId = proposed.body.versionId as string;

  const replayed = await request(app).post(
    `/v1/typed-procedural-versions/${versionId}/replay`
  );
  expect(replayed.status).toBe(200);
  expect(replayed.body.replayReportArtifactId).toBeTruthy();

  const approved = await request(app)
    .post(`/v1/typed-procedural-versions/${versionId}/approve`)
    .send({ actorId });
  expect(approved.status).toBe(200);
  expect(approved.body.lifecycleStatus).toBe("approved");

  const activated = await request(app)
    .post(`/v1/typed-procedural-versions/${versionId}/activate`)
    .send({ actorId, reason: "UAT Phase C activation" });
  expect(activated.status).toBe(200);
  expect(activated.body.action).toBe("activate");
  return versionId;
}

describe("N4 typed procedural prevention", () => {
  let container: Container;
  let app: Express;
  let artifactRoot: string;
  let logRoot: string;

  beforeAll(() => {
    const repoRoot = findRepoRoot();
    artifactRoot = mkdtempSync(join(tmpdir(), "maa-n4-art-"));
    logRoot = mkdtempSync(join(tmpdir(), "maa-n4-log-"));
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

  it("activates format-normalization rule → readiness prevention → rollback (UAT Phase C)", async () => {
    expect(SERVICE_VERSION).toMatch(/^0\.(1[4-9]|[2-9]\d)\.\d+$/);
    expect(CURRENT_DATABASE_SCHEMA_VERSION).toMatch(/^001[2-7]$/);

    const listed = await request(app).get("/v1/typed-procedural-rules");
    expect(listed.status).toBe(200);
    expect(
      listed.body.rules.some(
        (r: { ruleType: string }) => r.ruleType === "require_direct_customer_evidence"
      )
    ).toBe(true);
    expect(
      listed.body.rules.find(
        (r: { ruleType: string; activeVersionId?: string }) =>
          r.ruleType === "require_direct_customer_evidence"
      )?.activeVersionId
    ).toBe("prver_rdce_v1");

    const v1 = await proposeReplayApproveActivate(
      app,
      "require_format_normalization_for_pricing",
      { requireBinding: true },
      "op-n4"
    );

    const pkgId = "evpkg_n4_no_binding";
    await request(app)
      .post("/v1/evidence-packages")
      .send(pricingMissingBindingFixture(pkgId));

    const created = await request(app)
      .post("/v1/analysis-requests")
      .send({
        client: "research-team",
        projectId: "proj_n4_prevention",
        operation: "full_marketplace_analysis",
        capability: CAPABILITY,
        productContext: {
          name: "N4 Prevention Book",
          salesGoal: "Pricing blocked early by typed rule",
          constraints: []
        },
        requestedAnalysis: ["pricing", "market_structure"],
        evidencePackageIds: [pkgId]
      });
    expect(created.status).toBe(202);
    const runId = created.body.runId as string;
    await waitForStatus(app, runId, (s) =>
      ["completed", "partial", "failed", "evidence_insufficient"].includes(s)
    );

    const readiness = await request(app).get(`/v1/analysis-runs/${runId}/readiness`);
    expect(readiness.status).toBe(200);
    const pricing = readiness.body.areas.find(
      (a: { area: string }) => a.area === "pricing"
    );
    expect(pricing.allowedOutputLevel).toBe("none");
    expect(pricing.gaps.some((g: { field: string }) => g.field === "binding")).toBe(true);

    const feedbackList = await request(app).get(
      `/v1/analysis-runs/${runId}/workflow-feedback`
    );
    expect(feedbackList.status).toBe(200);
    expect(feedbackList.body.events.length).toBe(0);

    // Free-form approve cannot create typed prevention (runtime validators stay typed-only).
    const freeForm = container.repos.proceduralRules.list({ status: "active" });
    for (const rule of freeForm) {
      expect(rule.authority).toBe("procedural_active");
    }
    const promptOnly = container.learningService.resolveActiveProceduralRules({
      projectId: "proj_n4_prevention",
      analysisAreas: ["pricing"]
    });
    expect(promptOnly.every((r) => r.requireDirectCustomerEvidence === false)).toBe(true);

    const v2 = await proposeReplayApproveActivate(
      app,
      "require_format_normalization_for_pricing",
      { requireBinding: true, strictness: "high" },
      "op-n4"
    );
    expect(v2).not.toBe(v1);

    const activeBefore = await request(app).get(`/v1/typed-procedural-versions/${v2}`);
    expect(activeBefore.body.isActive).toBe(true);

    const rolled = await request(app)
      .post(`/v1/typed-procedural-versions/${v1}/rollback`)
      .send({ actorId: "op-n4", reason: "UAT Phase C rollback to v1" });
    expect(rolled.status).toBe(200);
    expect(rolled.body.action).toBe("rollback");
    expect(rolled.body.versionId).toBe(v1);
    expect(rolled.body.replacesActivationId).toBeTruthy();

    const afterV1 = await request(app).get(`/v1/typed-procedural-versions/${v1}`);
    const afterV2 = await request(app).get(`/v1/typed-procedural-versions/${v2}`);
    expect(afterV1.body.isActive).toBe(true);
    expect(afterV2.body.isActive).toBe(false);
  });
});
