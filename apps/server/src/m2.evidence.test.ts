import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfigSchema } from "@maa/contracts";
import {
  completeKdpFixture,
  listingsWithoutReviewsFixture,
  mixedFormatsFixture,
  promptInjectionFixture,
  staleEvidenceFixture
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
  timeoutMs = 8000
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

describe("M2 evidence packages and readiness", () => {
  let container: Container;
  let app: Express;
  let artifactRoot: string;
  let logRoot: string;

  beforeAll(() => {
    const repoRoot = findRepoRoot();
    artifactRoot = mkdtempSync(join(tmpdir(), "maa-m2-art-"));
    logRoot = mkdtempSync(join(tmpdir(), "maa-m2-log-"));
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

  it("registers a complete evidence package", async () => {
    const res = await request(app)
      .post("/v1/evidence-packages")
      .send(completeKdpFixture("evpkg_m2_complete"));
    expect(res.status).toBe(201);
    expect(res.body.packageId).toBe("evpkg_m2_complete");
    expect(res.body.itemCount).toBeGreaterThan(5);
    expect(res.body.contentHash).toBeTruthy();
  });

  it("rejects malformed provenance", async () => {
    const bad = completeKdpFixture("evpkg_bad_prov");
    // Strip required provenance fields
    bad.items = bad.items.map((i: { evidenceId: string }, idx: number) =>
      idx === 0
        ? {
            ...i,
            provenance: {
              collector: "",
              collectorVersion: "",
              observedAt: "not-a-date"
            }
          }
        : i
    ) as typeof bad.items;
    const res = await request(app).post("/v1/evidence-packages").send(bad);
    expect(res.status).toBe(400);
    expect(["EVIDENCE_PROVENANCE_INVALID", "VALIDATION_ERROR"]).toContain(res.body.error.code);
  });

  it("complete fixture run produces ready areas and completes", async () => {
    const pkgId = "evpkg_m2_run_complete";
    await request(app).post("/v1/evidence-packages").send(completeKdpFixture(pkgId));

    const created = await request(app)
      .post("/v1/analysis-requests")
      .send({
        client: "research-team",
        projectId: "proj_m2_complete",
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

    const readiness = await request(app).get(
      `/v1/analysis-runs/${created.body.runId}/readiness`
    );
    expect(readiness.status).toBe(200);
    expect(readiness.body.readyAreas).toContain("customer_evidence");
    expect(readiness.body.overallStatus).toBe("ready");
  });

  it("missing reviews blocks customer evidence and emits collection request", async () => {
    const pkgId = "evpkg_m2_no_reviews";
    await request(app).post("/v1/evidence-packages").send(listingsWithoutReviewsFixture(pkgId));

    const created = await request(app)
      .post("/v1/analysis-requests")
      .send({
        client: "research-team",
        projectId: "proj_m2_partial",
        operation: "full_marketplace_analysis",
        capability: CAPABILITY,
        productContext: {
          name: "Product Without Reviews Yet",
          salesGoal: "Assess what we can conclude without reviews",
          constraints: []
        },
        requestedAnalysis: ["market_structure", "customer_evidence", "pricing"],
        evidencePackageIds: [pkgId]
      });
    expect(created.status).toBe(202);

    const status = await waitForStatus(
      app,
      created.body.runId,
      (s) => s === "partial" || s === "completed" || s === "evidence_insufficient"
    );
    expect(status).toBe("partial");

    const readiness = await request(app).get(
      `/v1/analysis-runs/${created.body.runId}/readiness`
    );
    expect(readiness.body.blockedAreas).toContain("customer_evidence");
    expect(readiness.body.readyAreas).toContain("market_structure");

    const collections = await request(app).get(
      `/v1/analysis-runs/${created.body.runId}/collection-requests`
    );
    expect(collections.status).toBe(200);
    expect(collections.body.collectionRequests.length).toBeGreaterThan(0);
    const customer = collections.body.collectionRequests.find(
      (c: { analysisAreasBlocked: string[] }) =>
        c.analysisAreasBlocked.includes("customer_evidence")
    );
    expect(customer.requiredEvidence.length).toBeGreaterThan(0);
    expect(customer.completionRule.minimumReviews).toBe(5);
    expect(customer.reason).toContain("customer_evidence");
  });

  it("mixed formats produce pricing warnings or block when unsegmented", async () => {
    const pkgId = "evpkg_m2_mixed";
    await request(app).post("/v1/evidence-packages").send(mixedFormatsFixture(pkgId));
    const readiness = await request(app).get(
      `/v1/evidence-packages/${pkgId}/readiness?areas=pricing`
    );
    expect(readiness.status).toBe(200);
    expect(readiness.body.areas[0].warnings.join(" ")).toMatch(/Mixed formats|format/i);
  });

  it("stale evidence yields insufficient overall status for listing areas", async () => {
    const pkgId = "evpkg_m2_stale";
    await request(app).post("/v1/evidence-packages").send(staleEvidenceFixture(pkgId));
    const readiness = await request(app).get(
      `/v1/evidence-packages/${pkgId}/readiness?areas=market_structure,customer_evidence`
    );
    expect(readiness.status).toBe(200);
    expect(readiness.body.warnings.some((w: string) => w.includes("stale"))).toBe(true);
    expect(readiness.body.overallStatus).toBe("insufficient");
  });

  it("prompt injection in evidence remains stored data and does not bypass readiness", async () => {
    const pkgId = "evpkg_m2_inject";
    const registered = await request(app)
      .post("/v1/evidence-packages")
      .send(promptInjectionFixture(pkgId));
    expect(registered.status).toBe(201);

    const items = await request(app).get(`/v1/evidence-packages/${pkgId}/items`);
    expect(items.body.items.some((i: { textContent?: string }) =>
      (i.textContent ?? "").includes("Ignore previous instructions")
    )).toBe(true);

    // Readiness still uses deterministic rules — injection text does not force-ready blocked areas.
    const noReviewPkg = "evpkg_m2_inject_control";
    await request(app)
      .post("/v1/evidence-packages")
      .send(listingsWithoutReviewsFixture(noReviewPkg));
    const blocked = await request(app).get(
      `/v1/evidence-packages/${noReviewPkg}/readiness?areas=customer_evidence`
    );
    expect(blocked.body.areas[0].status).toBe("insufficient");
  });

  it("rejects analysis requests that reference missing evidence packages", async () => {
    const res = await request(app)
      .post("/v1/analysis-requests")
      .send({
        client: "research-team",
        projectId: "proj_missing_ev",
        operation: "evaluate_evidence_readiness",
        capability: CAPABILITY,
        productContext: {
          name: "Whatever Upstream Sent",
          salesGoal: "Check readiness",
          constraints: []
        },
        requestedAnalysis: ["evidence_sufficiency"],
        evidencePackageIds: ["evpkg_does_not_exist"]
      });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("EVIDENCE_PACKAGE_NOT_FOUND");
  });
});
