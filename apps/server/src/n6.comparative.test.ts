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

describe("N6 comparative analysis + deprecation hide", () => {
  let container: Container;
  let app: Express;
  let artifactRoot: string;
  let logRoot: string;

  beforeAll(() => {
    const repoRoot = findRepoRoot();
    artifactRoot = mkdtempSync(join(tmpdir(), "maa-n6-art-"));
    logRoot = mkdtempSync(join(tmpdir(), "maa-n6-log-"));
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

  it("runs comparative analysis and keeps propose_memory_update off capabilities", async () => {
    expect(SERVICE_VERSION).toMatch(/^0\.(16|17|18|19|20|21)\.\d+$/);
    expect(Number(CURRENT_DATABASE_SCHEMA_VERSION)).toBeGreaterThanOrEqual(14);

    const caps = await request(app).get("/v1/capabilities");
    expect(caps.status).toBe(200);
    const ops = caps.body.capabilities[0].supportedOperations as string[];
    expect(ops).not.toContain("propose_memory_update");
    expect(ops).toContain("comparative_analysis");

    // N7: allow-deprecated cannot restore a removed public operation.
    const capsAllow = await request(app)
      .get("/v1/capabilities")
      .set("X-Maa-Allow-Deprecated", "propose_memory_update");
    expect(capsAllow.body.capabilities[0].supportedOperations).not.toContain(
      "propose_memory_update"
    );

    const baselineId = "evpkg_n6_baseline";
    const compareId = "evpkg_n6_compare";
    await request(app).post("/v1/evidence-packages").send(completeKdpFixture(baselineId));
    await request(app).post("/v1/evidence-packages").send(completeKdpFixture(compareId));

    const created = await request(app)
      .post("/v1/analysis-requests")
      .send({
        client: "research-team",
        projectId: "proj_n6_compare",
        operation: "comparative_analysis",
        capability: CAPABILITY,
        productContext: {
          name: "N6 Comparative Book",
          salesGoal: "Contrast baseline vs current packages",
          constraints: []
        },
        requestedAnalysis: ["pricing", "market_structure"],
        evidencePackageIds: [compareId],
        baselineEvidencePackageIds: [baselineId]
      });
    expect(created.status).toBe(202);
    const runId = created.body.runId as string;
    const status = await waitForStatus(app, runId, (s) =>
      ["completed", "partial", "failed"].includes(s)
    );
    expect(status).not.toBe("failed");

    const findings = await request(app).get(`/v1/analysis-runs/${runId}/findings`);
    expect(findings.status).toBe(200);
    expect(findings.body.findings.length).toBeGreaterThan(0);
    expect(
      findings.body.findings.some(
        (f: { tags?: string[] }) =>
          Array.isArray(f.tags) &&
          (f.tags.includes("comparative_pricing") ||
            f.tags.includes("comparative_baseline"))
      )
    ).toBe(true);

    // Cross-capability package → reject before model/worker deep work.
    const foreignId = "evpkg_n6_foreign";
    const foreign = completeKdpFixture(foreignId);
    foreign.productType = "kids_workbook";
    foreign.items = foreign.items?.map((i) => ({ ...i, productType: "kids_workbook" }));
    await request(app).post("/v1/evidence-packages").send(foreign);

    const rejected = await request(app)
      .post("/v1/analysis-requests")
      .send({
        client: "research-team",
        projectId: "proj_n6_compare",
        operation: "comparative_analysis",
        capability: CAPABILITY,
        productContext: {
          name: "N6 Cross Cap",
          salesGoal: "Should reject",
          constraints: []
        },
        requestedAnalysis: ["pricing"],
        evidencePackageIds: [compareId],
        baselineEvidencePackageIds: [foreignId]
      });
    expect(rejected.status).toBe(422);
    expect(rejected.body.error.code).toBe("UNSUPPORTED_CAPABILITY");
  });
});
