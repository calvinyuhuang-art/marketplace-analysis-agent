import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Express } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfigSchema } from "@maa/contracts";
import {
  MarketplaceAnalysisClient,
  ResearchTeamMaaAdapter,
  runAnalysisWorkflow,
  wrapEvidenceArtifact,
  type ResearchWorkOrderRecord
} from "@maa/client";
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

const PRODUCT = {
  name: "Lofi Rainy Day Coloring Book",
  salesGoal: "Validate KDP coloring niche via Research Team",
  constraints: [] as string[]
};

describe("M9 Research Team integration (API client only)", () => {
  let container: Container;
  let app: Express;
  let server: Server;
  let baseUrl: string;
  let artifactRoot: string;
  let logRoot: string;

  beforeAll(async () => {
    const repoRoot = findRepoRoot();
    artifactRoot = mkdtempSync(join(tmpdir(), "maa-m9-art-"));
    logRoot = mkdtempSync(join(tmpdir(), "maa-m9-log-"));
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
    server = createServer(app);
    await new Promise<void>((resolveListen) => {
      server.listen(0, "127.0.0.1", () => resolveListen());
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no listen address");
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolveClose, reject) => {
      server.close((err) => (err ? reject(err) : resolveClose()));
    });
    await container.shutdown();
    await new Promise((r) => setTimeout(r, 50));
    rmSync(artifactRoot, { recursive: true, force: true });
    rmSync(logRoot, { recursive: true, force: true });
  });

  it("submits evidence package via client and receives 202 on analysis create", async () => {
    const client = new MarketplaceAnalysisClient({
      baseUrl,
      timeoutMs: 10_000,
      correlationId: "corr_m9_happy"
    });
    const adapter = new ResearchTeamMaaAdapter({ client, enabled: true });

    const project = await client.createProject({
      name: "RT Lofi Rainy Day",
      capability: CAPABILITY,
      productContext: PRODUCT,
      externalProjectId: "rt_proj_lofi"
    });

    const envelope = wrapEvidenceArtifact({
      artifactId: "rt_art_complete",
      package: completeKdpFixture("evpkg_m9_complete"),
      correlationId: "corr_m9_happy",
      externalWorkOrderId: "wo_m9_1"
    });
    const { packageId } = await adapter.submitEvidenceArtifact(envelope);
    expect(packageId).toBe("evpkg_m9_complete");

    const workOrder: ResearchWorkOrderRecord = {
      externalWorkOrderId: "wo_m9_1",
      status: "open",
      correlationId: "corr_m9_happy"
    };

    const { create, view } = await adapter.submitAnalysis(
      {
        client: "research-team",
        projectId: project.projectId,
        externalWorkOrderId: "wo_m9_1",
        operation: "full_marketplace_analysis",
        capability: CAPABILITY,
        productContext: PRODUCT,
        requestedAnalysis: [
          "market_structure",
          "competitor_set",
          "customer_evidence",
          "pricing",
          "positioning",
          "keywords_categories",
          "risk_ip_policy"
        ],
        evidencePackageIds: [packageId],
        idempotencyKey: "wo_m9_1:marketplace-analysis:v1"
      },
      workOrder
    );

    expect(create.requestId).toBeTruthy();
    expect(create.runId).toBeTruthy();
    expect(create.correlationId).toBe("corr_m9_happy");
    expect(view.taskState).toBe("queued");
    expect(workOrder.maaRunId).toBe(create.runId);

    // Idempotent replay returns same run (identical payload)
    const again = await client.createAnalysis(
      {
        client: "research-team",
        projectId: project.projectId,
        externalWorkOrderId: "wo_m9_1",
        operation: "full_marketplace_analysis",
        capability: CAPABILITY,
        productContext: PRODUCT,
        requestedAnalysis: [
          "market_structure",
          "competitor_set",
          "customer_evidence",
          "pricing",
          "positioning",
          "keywords_categories",
          "risk_ip_policy"
        ],
        evidencePackageIds: [packageId],
        idempotencyKey: "wo_m9_1:marketplace-analysis:v1"
      },
      { correlationId: "corr_m9_happy" }
    );
    expect(again.runId).toBe(create.runId);

    await client.pollRun(create.runId, { intervalMs: 40, timeoutMs: 15_000 });
    const refreshed = await adapter.reconnect(workOrder);
    expect(["ready_for_review", "needs_orchestrator_decision"]).toContain(
      refreshed.taskState
    );
    expect(refreshed.correlationId).toBe("corr_m9_happy");

    if (refreshed.taskState === "ready_for_review") {
      const artifact = await adapter.acceptAsResearchArtifact(workOrder);
      expect(artifact?.maaRunId).toBe(create.runId);
      expect(workOrder.status).toBe("artifact_accepted");
      expect(workOrder.acceptedArtifact).toBeTruthy();
    }
  });

  it("routes evidence gaps to orchestrator decision without calling MCEC", async () => {
    const client = new MarketplaceAnalysisClient({
      baseUrl,
      correlationId: "corr_m9_gap"
    });
    const adapter = new ResearchTeamMaaAdapter({ client, enabled: true });
    const project = await client.createProject({
      name: "RT Gap Project",
      capability: CAPABILITY,
      productContext: PRODUCT
    });
    const envelope = wrapEvidenceArtifact({
      artifactId: "rt_art_gap",
      package: listingsWithoutReviewsFixture("evpkg_m9_gap"),
      correlationId: "corr_m9_gap",
      externalWorkOrderId: "wo_m9_gap"
    });
    const { packageId } = await adapter.submitEvidenceArtifact(envelope);
    const workOrder: ResearchWorkOrderRecord = {
      externalWorkOrderId: "wo_m9_gap",
      status: "open",
      correlationId: "corr_m9_gap"
    };

    const { view } = await runAnalysisWorkflow({
      adapter,
      client,
      workOrder,
      brief: {
        client: "research-team",
        projectId: project.projectId,
        externalWorkOrderId: "wo_m9_gap",
        operation: "full_marketplace_analysis",
        capability: CAPABILITY,
        productContext: PRODUCT,
        requestedAnalysis: ["customer_evidence", "pricing", "competitor_set"],
        evidencePackageIds: [packageId],
        idempotencyKey: "wo_m9_gap:v1"
      },
      poll: { intervalMs: 40, timeoutMs: 15_000 }
    });

    expect(view.taskState).toBe("needs_orchestrator_decision");
    const decision = await adapter.toOrchestratorDecision(workOrder);
    expect(decision.decision).toBe("collect_evidence");
    expect(decision.reason).toBe("maa_evidence_gap");
    expect(decision.correlationId).toBe("corr_m9_gap");
    expect(Array.isArray(decision.collectionRequests)).toBe(true);
  });

  it("does not corrupt accepted RT artifact when MAA call fails", async () => {
    const client = new MarketplaceAnalysisClient({
      baseUrl: "http://127.0.0.1:1",
      timeoutMs: 500
    });
    const adapter = new ResearchTeamMaaAdapter({ client, enabled: true });
    const workOrder: ResearchWorkOrderRecord = {
      externalWorkOrderId: "wo_corrupt_guard",
      status: "artifact_accepted",
      acceptedArtifact: {
        kind: "marketplace_analysis",
        maaRunId: "run_prior",
        output: { ok: true },
        acceptedAt: "2026-07-01T00:00:00.000Z"
      }
    };
    await expect(
      adapter.submitAnalysis(
        {
          client: "research-team",
          projectId: "proj_x",
          operation: "full_marketplace_analysis",
          capability: CAPABILITY,
          productContext: PRODUCT,
          requestedAnalysis: ["pricing"],
          evidencePackageIds: ["missing"],
          idempotencyKey: "wo_corrupt_guard:v1"
        },
        workOrder
      )
    ).rejects.toThrow();
    expect(workOrder.status).toBe("artifact_accepted");
    expect(workOrder.acceptedArtifact?.output).toEqual({ ok: true });
  });

  it("respects feature flag — disabled adapter never calls MAA", async () => {
    const client = new MarketplaceAnalysisClient({ baseUrl });
    const adapter = new ResearchTeamMaaAdapter({ client, enabled: false });
    await expect(
      adapter.submitEvidenceArtifact(
        wrapEvidenceArtifact({
          artifactId: "x",
          package: completeKdpFixture("evpkg_disabled")
        })
      )
    ).rejects.toThrow(/disabled/i);
  });

  it("supports revision with supplemental evidence via client", async () => {
    const client = new MarketplaceAnalysisClient({
      baseUrl,
      correlationId: "corr_m9_rev"
    });
    const adapter = new ResearchTeamMaaAdapter({ client, enabled: true });
    const project = await client.createProject({
      name: "RT Revision",
      capability: CAPABILITY,
      productContext: PRODUCT
    });
    const { packageId } = await adapter.submitEvidenceArtifact(
      wrapEvidenceArtifact({
        artifactId: "rt_art_rev",
        package: completeKdpFixture("evpkg_m9_rev_base"),
        externalWorkOrderId: "wo_m9_rev"
      })
    );
    const workOrder: ResearchWorkOrderRecord = {
      externalWorkOrderId: "wo_m9_rev",
      status: "open",
      correlationId: "corr_m9_rev"
    };
    await runAnalysisWorkflow({
      adapter,
      client,
      workOrder,
      brief: {
        client: "research-team",
        projectId: project.projectId,
        externalWorkOrderId: "wo_m9_rev",
        operation: "full_marketplace_analysis",
        capability: CAPABILITY,
        productContext: PRODUCT,
        requestedAnalysis: ["pricing", "competitor_set", "customer_evidence"],
        evidencePackageIds: [packageId],
        idempotencyKey: "wo_m9_rev:v1"
      },
      poll: { intervalMs: 40, timeoutMs: 15_000 }
    });

    const priorRunId = workOrder.maaRunId!;
    await adapter.acceptAsResearchArtifact(workOrder);
    expect(workOrder.status).toBe("artifact_accepted");

    const view = await adapter.reviseWithSupplementalEvidence(workOrder, {
      reasonCode: "missing_analysis",
      instructions: "Add denser competitor set from supplemental listings",
      supplementalPackage: completeKdpFixture("evpkg_m9_rev_extra"),
      affectedAreas: ["competitor_set", "pricing"]
    });
    expect(workOrder.maaRunId).not.toBe(priorRunId);
    expect(workOrder.acceptedArtifact).toBeTruthy();
    expect(workOrder.status).toBe("waiting_maa");
    expect(view.maaRunId).toBe(workOrder.maaRunId);

    await client.pollRun(workOrder.maaRunId!, { intervalMs: 40, timeoutMs: 15_000 });
    const after = await adapter.refreshView(workOrder);
    expect(["ready_for_review", "needs_orchestrator_decision", "running"]).toContain(
      after.taskState
    );
  });
});
