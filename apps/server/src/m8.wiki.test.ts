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

describe("M8 governed wiki", () => {
  let container: Container;
  let app: Express;
  let artifactRoot: string;
  let logRoot: string;

  beforeAll(() => {
    const repoRoot = findRepoRoot();
    artifactRoot = mkdtempSync(join(tmpdir(), "maa-m8-art-"));
    logRoot = mkdtempSync(join(tmpdir(), "maa-m8-log-"));
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
    "seeds hierarchy, proposes patches from approved memory, preserves versions, and lints",
    async () => {
      const seeded = await request(app).post("/v1/wiki/seed").send({});
      expect(seeded.status).toBe(200);
      expect(seeded.body.pages.length).toBeGreaterThan(5);

      const pages = await request(app).get("/v1/wiki/pages");
      expect(pages.body.pages.some((p: { slug: string }) => p.slug === "error-book-summary")).toBe(
        true
      );

      const pkg = "evpkg_m8";
      await request(app).post("/v1/evidence-packages").send(completeKdpFixture(pkg));
      const created = await request(app)
        .post("/v1/analysis-requests")
        .send({
          client: "research-team",
          projectId: "proj_m8_wiki",
          operation: "full_marketplace_analysis",
          capability: CAPABILITY,
          productContext: {
            name: "Wiki Project",
            salesGoal: "wiki learning",
            constraints: []
          },
          requestedAnalysis: ["market_structure", "pricing", "customer_evidence"],
          evidencePackageIds: [pkg]
        });
      expect(created.status).toBe(202);
      await waitForStatus(app, created.body.runId, (s) =>
        ["completed", "partial"].includes(s)
      );

      const findings = await request(app).get(
        `/v1/analysis-runs/${created.body.runId}/findings`
      );
      const target =
        findings.body.findings.find(
          (f: { analysisArea: string }) => f.analysisArea === "customer_evidence"
        ) ?? findings.body.findings[0];
      await request(app)
        .post(`/v1/findings/${target.findingId}/review`)
        .send({ action: "accept", reviewerId: "op-m8" });

      const proposal = await request(app)
        .post("/v1/memory-proposals")
        .send({
          projectId: "proj_m8_wiki",
          sourceFindingId: target.findingId,
          reason: "Category complaint pattern for wiki",
          proposedBy: "op-m8",
          analysisArea: target.analysisArea
        });
      expect(proposal.status).toBe(201);

      const approved = await request(app)
        .post(`/v1/memory-proposals/${proposal.body.proposalId}/review`)
        .send({ action: "approve", reviewerId: "gov-m8" });
      expect(approved.status).toBe(200);
      const memoryId = approved.body.resultingMemoryId as string;

      const wikiProposals = await request(app).get("/v1/wiki/proposals?status=proposed");
      expect(wikiProposals.body.proposals.length).toBeGreaterThan(0);
      const wikiProp = wikiProposals.body.proposals[0];
      expect(wikiProp.proposedSourceMemoryIds).toContain(memoryId);
      expect(wikiProp.proposedContentMarkdown).toContain(`[[mem:${memoryId}]]`);

      const pageBefore = await request(app).get(`/v1/wiki/pages/${wikiProp.pageId}`);
      const priorVersionId = pageBefore.body.version?.versionId as string;
      const priorVersionNo = pageBefore.body.version?.versionNo as number;

      const published = await request(app)
        .post(`/v1/wiki/proposals/${wikiProp.proposalId}/approve`)
        .send({ reviewerId: "wiki-op" });
      expect(published.status).toBe(200);
      expect(published.body.status).toBe("approved");
      expect(published.body.resultingVersionId).toBeTruthy();

      const pageAfter = await request(app).get(`/v1/wiki/pages/${wikiProp.pageId}`);
      expect(pageAfter.body.version.versionNo).toBeGreaterThan(priorVersionNo);
      expect(pageAfter.body.sourceMemoryIds).toContain(memoryId);
      expect(pageAfter.body.version.contentMarkdown).toContain(`[[mem:${memoryId}]]`);

      const versions = await request(app).get(
        `/v1/wiki/pages/${wikiProp.pageId}/versions`
      );
      expect(versions.body.versions.length).toBeGreaterThanOrEqual(2);
      expect(
        versions.body.versions.some((v: { versionId: string }) => v.versionId === priorVersionId)
      ).toBe(true);

      // Rejected memory cannot publish as current truth.
      const rejectedMem = container.repos.memoryItems.getById(memoryId)!;
      container.repos.memoryItems.update({
        ...rejectedMem,
        authorityStatus: "rejected",
        updatedAt: new Date().toISOString()
      });
      const blocked = await request(app)
        .post("/v1/wiki/rebuild")
        .send({});
      expect(blocked.status).toBe(200);
      const rebuildProp = blocked.body.proposals.find(
        (p: { pageId: string }) => p.pageId === wikiProp.pageId
      );
      if (rebuildProp) {
        const badPublish = await request(app)
          .post(`/v1/wiki/proposals/${rebuildProp.proposalId}/approve`)
          .send({ reviewerId: "wiki-op" });
        // Either no sources (ok) or blocked if still citing rejected
        if ((rebuildProp.proposedSourceMemoryIds as string[]).includes(memoryId)) {
          expect(badPublish.status).toBeGreaterThanOrEqual(400);
        }
      }

      // Restore for lint
      container.repos.memoryItems.update({
        ...container.repos.memoryItems.getById(memoryId)!,
        authorityStatus: "reusable_approved",
        updatedAt: new Date().toISOString()
      });

      const lint = await request(app).post("/v1/wiki/lint").send({});
      expect(lint.status).toBe(200);
      expect(Array.isArray(lint.body.issues)).toBe(true);

      // Rebuildability from canonical memory
      const rebuild = await request(app).post("/v1/wiki/rebuild").send({});
      expect(rebuild.status).toBe(200);
      expect(rebuild.body.proposals.length).toBeGreaterThan(0);
    },
    45_000
  );
});
