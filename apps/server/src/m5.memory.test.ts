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

describe("M5 project memory and retrieval", () => {
  let container: Container;
  let app: Express;
  let artifactRoot: string;
  let logRoot: string;

  beforeAll(() => {
    const repoRoot = findRepoRoot();
    artifactRoot = mkdtempSync(join(tmpdir(), "maa-m5-art-"));
    logRoot = mkdtempSync(join(tmpdir(), "maa-m5-log-"));
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
    "accepts findings into memory, excludes rejects, retrieves on second run",
    async () => {
    const pkg1 = "evpkg_m5_a";
    await request(app).post("/v1/evidence-packages").send(completeKdpFixture(pkg1));

    const first = await request(app)
      .post("/v1/analysis-requests")
      .send({
        client: "research-team",
        projectId: "proj_m5_mem",
        operation: "full_marketplace_analysis",
        capability: CAPABILITY,
        productContext: {
          name: "Memory Test Product",
          salesGoal: "continuity",
          constraints: []
        },
        requestedAnalysis: ["market_structure", "pricing", "customer_evidence"],
        evidencePackageIds: [pkg1]
      });
    expect(first.status).toBe(202);
    await waitForStatus(app, first.body.runId, (s) =>
      ["completed", "partial"].includes(s)
    );

    const findings = await request(app).get(
      `/v1/analysis-runs/${first.body.runId}/findings`
    );
    expect(findings.body.findings.length).toBeGreaterThan(0);
    const acceptTarget = findings.body.findings[0];
    const rejectTarget = findings.body.findings[1] ?? findings.body.findings[0];

    const accept = await request(app)
      .post(`/v1/findings/${acceptTarget.findingId}/review`)
      .send({ action: "accept", reviewerId: "op-m5" });
    expect(accept.status).toBe(200);

    if (rejectTarget.findingId !== acceptTarget.findingId) {
      const reject = await request(app)
        .post(`/v1/findings/${rejectTarget.findingId}/review`)
        .send({
          action: "reject",
          reasonCode: "unsupported_conclusion",
          reviewerId: "op-m5"
        });
      expect(reject.status).toBe(200);
    }

    const mem = await request(app).get(`/v1/projects/proj_m5_mem/memory`);
    expect(mem.status).toBe(200);
    expect(mem.body.memory.length).toBeGreaterThan(0);
    const accepted = mem.body.memory.filter(
      (m: { authorityStatus: string }) => m.authorityStatus === "reviewed_project"
    );
    const rejected = mem.body.memory.filter(
      (m: { authorityStatus: string; memoryType: string }) =>
        m.authorityStatus === "rejected" || m.memoryType === "failure_correction"
    );
    expect(accepted.length).toBeGreaterThan(0);

    // Restart durability: reopen is in-memory same process — verify list persists in DB.
    const again = container.memoryService.getProjectMemory("proj_m5_mem");
    expect(again.length).toBe(mem.body.memory.length);

    const pkg2 = "evpkg_m5_b";
    await request(app).post("/v1/evidence-packages").send(completeKdpFixture(pkg2));
    const second = await request(app)
      .post("/v1/analysis-requests")
      .send({
        client: "research-team",
        projectId: "proj_m5_mem",
        operation: "full_marketplace_analysis",
        capability: CAPABILITY,
        productContext: {
          name: "Memory Test Product",
          salesGoal: "continuity round 2",
          constraints: []
        },
        requestedAnalysis: ["market_structure", "pricing", "customer_evidence"],
        evidencePackageIds: [pkg2]
      });
    expect(second.status).toBe(202);
    await waitForStatus(app, second.body.runId, (s) =>
      ["completed", "partial"].includes(s)
    );

    const retrieval = await request(app).get(
      `/v1/analysis-runs/${second.body.runId}/memory-retrieval`
    );
    expect(retrieval.status).toBe(200);
    expect(retrieval.body.retrievalEvents.length).toBeGreaterThan(0);
    const selected: string[] = retrieval.body.retrievalEvents[0].selectedMemoryIds;
    expect(selected.length).toBeGreaterThan(0);

    // Rejected memory must not appear as selected approved knowledge.
    for (const r of rejected) {
      const cand = retrieval.body.retrievalEvents[0].candidates.find(
        (c: { memoryId: string }) => c.memoryId === r.memoryId
      );
      if (cand && cand.selected) {
        // failure_correction may be selected into failure lessons — that is OK;
        // but rejected authority must not be in approved section.
        const assembly = await request(app).get(
          `/v1/analysis-runs/${second.body.runId}/context-assembly`
        );
        const approvedSection = assembly.body.sections.find(
          (s: { name: string }) => s.name === "approved_semantic_memory"
        );
        expect(approvedSection.memoryIds).not.toContain(r.memoryId);
      }
    }

    const assembly = await request(app).get(
      `/v1/analysis-runs/${second.body.runId}/context-assembly`
    );
    expect(assembly.status).toBe(200);
    expect(assembly.body.selectedMemoryIds.length).toBeGreaterThan(0);
    expect(Array.isArray(assembly.body.omitted)).toBe(true);

    const secondFindings = await request(app).get(
      `/v1/analysis-runs/${second.body.runId}/findings`
    );
    const cited = secondFindings.body.findings.some(
      (f: { memoryRefs?: string[]; classification: string }) =>
        f.classification === "validated_memory" && (f.memoryRefs?.length ?? 0) > 0
    );
    expect(cited).toBe(true);
  },
  20_000
);
});
