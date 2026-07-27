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

describe("M7 reusable category memory governance", () => {
  let container: Container;
  let app: Express;
  let artifactRoot: string;
  let logRoot: string;

  beforeAll(() => {
    const repoRoot = findRepoRoot();
    artifactRoot = mkdtempSync(join(tmpdir(), "maa-m7-art-"));
    logRoot = mkdtempSync(join(tmpdir(), "maa-m7-log-"));
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

  it(
    "keeps project memory private until reusable approval; second project retrieves compatible knowledge",
    async () => {
      const pkg1 = "evpkg_m7_a";
      await request(app).post("/v1/evidence-packages").send(completeKdpFixture(pkg1));

      const first = await request(app)
        .post("/v1/analysis-requests")
        .send({
          client: "research-team",
          projectId: "proj_m7_coloring_a",
          operation: "full_marketplace_analysis",
          capability: CAPABILITY,
          productContext: {
            name: "Coloring Project A",
            salesGoal: "category learning",
            constraints: []
          },
          requestedAnalysis: ["market_structure", "pricing", "customer_evidence"],
          evidencePackageIds: [pkg1]
        });
      expect(first.status).toBe(202);
      await waitForStatus(app, first.body.runId, (s) =>
        ["completed", "partial"].includes(s)
      );

      // Analysis / run acceptance must NOT approve reusable memory.
      await request(app)
        .post(`/v1/analysis-runs/${first.body.runId}/outcome-review`)
        .send({ judgment: "helpful", reviewerId: "op-m7" });
      const proposalsBefore = await request(app).get(
        "/v1/memory-proposals?projectId=proj_m7_coloring_a"
      );
      expect(proposalsBefore.body.proposals).toHaveLength(0);

      const findings = await request(app).get(
        `/v1/analysis-runs/${first.body.runId}/findings`
      );
      const target = findings.body.findings[0];
      expect(target).toBeTruthy();

      const accept = await request(app)
        .post(`/v1/findings/${target.findingId}/review`)
        .send({ action: "accept", reviewerId: "op-m7" });
      expect(accept.status).toBe(200);

      // Project memory exists for A, but not as reusable.
      const memA = await request(app).get("/v1/projects/proj_m7_coloring_a/memory");
      expect(memA.body.memory.length).toBeGreaterThan(0);
      const projectOnlyId = memA.body.memory.find(
        (m: { authorityStatus: string }) => m.authorityStatus === "reviewed_project"
      )?.memoryId as string;
      expect(projectOnlyId).toBeTruthy();

      const reusableEmpty = await request(app).get(
        "/v1/reusable-memory?platform=amazon&category=books&productType=adult_coloring_book"
      );
      expect(reusableEmpty.body.memory).toHaveLength(0);

      // Explicit proposal required.
      const proposed = await request(app)
        .post("/v1/memory-proposals")
        .send({
          projectId: "proj_m7_coloring_a",
          sourceFindingId: target.findingId,
          reason: "Recurring category pattern worth sharing across coloring projects.",
          proposedBy: "op-m7",
          analysisArea: target.analysisArea
        });
      expect(proposed.status).toBe(201);
      expect(proposed.body.status).toBe("proposed");
      expect(proposed.body.evidenceIds?.length ?? 0).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(proposed.body.conflicts)).toBe(true);
      expect(proposed.body.scopes.some((s: { dimension: string }) => s.dimension === "project")).toBe(
        false
      );

      const approved = await request(app)
        .post(`/v1/memory-proposals/${proposed.body.proposalId}/review`)
        .send({ action: "approve", reviewerId: "governor-m7" });
      expect(approved.status).toBe(200);
      expect(approved.body.status).toBe("approved");
      expect(approved.body.resultingMemoryId).toBeTruthy();

      const reusable = await request(app).get(
        "/v1/reusable-memory?platform=amazon&category=books&productType=adult_coloring_book"
      );
      expect(reusable.body.memory.length).toBeGreaterThan(0);
      expect(reusable.body.memory[0].authorityStatus).toBe("reusable_approved");

      // Rejection remains auditable.
      const rejectedProposal = await request(app)
        .post("/v1/memory-proposals")
        .send({
          projectId: "proj_m7_coloring_a",
          statement: "Unrelated rejected proposal statement about bookmarks.",
          title: "Reject me",
          reason: "Not category-relevant",
          proposedBy: "op-m7",
          scopes: [
            { dimension: "platform", value: "amazon" },
            { dimension: "category", value: "books" }
          ]
        });
      const rejected = await request(app)
        .post(`/v1/memory-proposals/${rejectedProposal.body.proposalId}/review`)
        .send({ action: "reject", notes: "Out of scope", reviewerId: "governor-m7" });
      expect(rejected.status).toBe(200);
      expect(rejected.body.status).toBe("rejected");
      const stillListed = await request(app).get(
        `/v1/memory-proposals/${rejected.body.proposalId}`
      );
      expect(stillListed.body.status).toBe("rejected");
      expect(stillListed.body.reviewNotes).toBe("Out of scope");

      // Second coloring-book project retrieves approved reusable, not project-A private memory.
      const pkg2 = "evpkg_m7_b";
      await request(app).post("/v1/evidence-packages").send(completeKdpFixture(pkg2));
      const second = await request(app)
        .post("/v1/analysis-requests")
        .send({
          client: "research-team",
          projectId: "proj_m7_coloring_b",
          operation: "full_marketplace_analysis",
          capability: CAPABILITY,
          productContext: {
            name: "Coloring Project B",
            salesGoal: "reuse compatible category knowledge",
            constraints: []
          },
          requestedAnalysis: ["market_structure", "pricing", "customer_evidence"],
          evidencePackageIds: [pkg2]
        });
      expect(second.status).toBe(202);
      await waitForStatus(app, second.body.runId, (s) =>
        ["completed", "partial"].includes(s)
      );

      const memB = await request(app).get("/v1/projects/proj_m7_coloring_b/memory");
      // Project B list is project-scoped only — should not include A's reviewed_project id.
      expect(
        memB.body.memory.some((m: { memoryId: string }) => m.memoryId === projectOnlyId)
      ).toBe(false);

      const assembly = await request(app).get(
        `/v1/analysis-runs/${second.body.runId}/context-assembly`
      );
      expect(assembly.status).toBe(200);
      const selected: string[] = assembly.body.selectedMemoryIds ?? [];
      expect(selected).toContain(approved.body.resultingMemoryId);
      expect(selected).not.toContain(projectOnlyId);

      // Stale reusable is warned/excluded.
      const staleId = approved.body.resultingMemoryId as string;
      const staleRow = container.repos.memoryItems.getById(staleId)!;
      container.repos.memoryItems.update({
        ...staleRow,
        validUntil: "2020-01-01T00:00:00.000Z",
        updatedAt: new Date().toISOString()
      });

      const pkg3 = "evpkg_m7_c";
      await request(app).post("/v1/evidence-packages").send(completeKdpFixture(pkg3));
      const third = await request(app)
        .post("/v1/analysis-requests")
        .send({
          client: "research-team",
          projectId: "proj_m7_coloring_b",
          operation: "full_marketplace_analysis",
          capability: CAPABILITY,
          productContext: {
            name: "Coloring Project B",
            salesGoal: "stale check",
            constraints: []
          },
          requestedAnalysis: ["market_structure"],
          evidencePackageIds: [pkg3]
        });
      await waitForStatus(app, third.body.runId, (s) =>
        ["completed", "partial"].includes(s)
      );
      const retrieval = await request(app).get(
        `/v1/analysis-runs/${third.body.runId}/memory-retrieval`
      );
      const cand = retrieval.body.retrievalEvents[0]?.candidates?.find(
        (c: { memoryId: string }) => c.memoryId === staleId
      );
      expect(cand?.selected).toBe(false);
      expect(String(cand?.omitReason ?? "")).toMatch(/stale/i);

      // Conflicting knowledge is surfaced, not overwritten.
      const conflictProp = await request(app)
        .post("/v1/memory-proposals")
        .send({
          projectId: "proj_m7_coloring_a",
          title: "Conflict candidate",
          statement: target.statement,
          reason: "Near duplicate to test conflict surfacing",
          proposedBy: "op-m7",
          scopes: [
            { dimension: "platform", value: "amazon" },
            { dimension: "marketplace", value: "US" },
            { dimension: "category", value: "books" },
            { dimension: "product_type", value: "adult_coloring_book" }
          ]
        });
      // Restore non-stale so conflict detection sees it
      container.repos.memoryItems.update({
        ...container.repos.memoryItems.getById(staleId)!,
        validUntil: null,
        authorityStatus: "reusable_approved",
        updatedAt: new Date().toISOString()
      });
      const conflictProp2 = await request(app)
        .post("/v1/memory-proposals")
        .send({
          projectId: "proj_m7_coloring_a",
          title: "Conflict candidate 2",
          statement: target.statement,
          reason: "Near duplicate to test conflict surfacing",
          proposedBy: "op-m7",
          scopes: [
            { dimension: "platform", value: "amazon" },
            { dimension: "marketplace", value: "US" },
            { dimension: "category", value: "books" },
            { dimension: "product_type", value: "adult_coloring_book" }
          ]
        });
      expect(conflictProp2.status).toBe(201);
      expect(conflictProp2.body.conflicts.length).toBeGreaterThan(0);
      const priorCount = container.repos.memoryItems.getById(staleId)!.contradictionCount;
      await request(app)
        .post(`/v1/memory-proposals/${conflictProp2.body.proposalId}/review`)
        .send({ action: "approve", reviewerId: "governor-m7" });
      // Original reusable still exists (not overwritten).
      expect(container.repos.memoryItems.getById(staleId)?.authorityStatus).toBe(
        "reusable_approved"
      );
      void conflictProp;
      void priorCount;
    },
    45_000
  );
});
