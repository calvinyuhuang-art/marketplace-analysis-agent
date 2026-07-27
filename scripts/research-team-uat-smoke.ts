/**
 * Capped Research Team ↔ MAA UAT smoke (Lofi Rainy Day fixture).
 * Uses @maa/client only — no DB coupling.
 *
 * Against a running server:
 *   MAA_BASE_URL=http://127.0.0.1:4320 pnpm exec tsx scripts/research-team-uat-smoke.ts
 *
 * Or embed a local server (default):
 *   pnpm exec tsx scripts/research-team-uat-smoke.ts
 */
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  MarketplaceAnalysisClient,
  ResearchTeamMaaAdapter,
  runAnalysisWorkflow,
  wrapEvidenceArtifact,
  type ResearchWorkOrderRecord
} from "@maa/client";
import { completeKdpFixture } from "../fixtures/evidence/kdp-fixtures";
import { loadConfig } from "../apps/server/src/config/index";
import { createContainer } from "../apps/server/src/composition/container";
import { createApp } from "../apps/server/src/app";
import { findRepoRoot } from "../apps/server/src/config/paths";

const CAPABILITY = {
  platform: "amazon",
  marketplace: "US",
  category: "books",
  productType: "adult_coloring_book"
};

const PRODUCT = {
  name: "Lofi Rainy Day Coloring Book",
  salesGoal: "Research Team UAT — marketplace analysis artifact",
  constraints: [] as string[]
};

async function main() {
  const externalUrl = process.env.MAA_BASE_URL?.trim();
  let baseUrl = externalUrl;
  let shutdown: (() => Promise<void>) | undefined;

  if (!baseUrl) {
    const repoRoot = findRepoRoot();
    const artifactRoot = mkdtempSync(join(tmpdir(), "maa-rt-uat-art-"));
    const logRoot = mkdtempSync(join(tmpdir(), "maa-rt-uat-log-"));
    const base = loadConfig();
    const container = createContainer(
      {
        ...base,
        databasePath: join(artifactRoot, "uat.sqlite"),
        artifactRoot,
        logRoot,
        migrationsDir: resolve(repoRoot, "migrations"),
        raw: {
          ...base.raw,
          MAA_DEEPSEEK_ENABLED: false,
          MAA_WORKER_POLL_MS: 50,
          MAA_FAKE_PHASE_DELAY_MS: 5,
          MAA_API_KEY: "",
          MAA_REQUIRE_API_KEY: false
        }
      },
      { startWorker: true }
    );
    const app = createApp(container);
    const server = createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no address");
    baseUrl = `http://127.0.0.1:${addr.port}`;
    shutdown = async () => {
      await new Promise<void>((resolveClose, reject) =>
        server.close((e) => (e ? reject(e) : resolveClose()))
      );
      await container.shutdown();
      rmSync(artifactRoot, { recursive: true, force: true });
      rmSync(logRoot, { recursive: true, force: true });
    };
  }

  const correlationId = `corr_rt_uat_${Date.now()}`;
  const client = new MarketplaceAnalysisClient({
    baseUrl,
    timeoutMs: 30_000,
    correlationId
  });
  const adapter = new ResearchTeamMaaAdapter({
    client,
    enabled: true,
    defaultCorrelationId: correlationId
  });

  const health = await client.health();
  console.log("health", health.status, health.version);

  const project = await client.createProject({
    name: "Lofi Rainy Day (Research Team UAT)",
    capability: CAPABILITY,
    productContext: PRODUCT,
    externalProjectId: "rt_uat_lofi_rainy_day"
  });

  const envelope = wrapEvidenceArtifact({
    artifactId: `rt_art_${Date.now()}`,
    package: completeKdpFixture(`evpkg_rt_uat_${Date.now()}`),
    correlationId,
    externalWorkOrderId: "wo_rt_uat_lofi"
  });
  const { packageId } = await adapter.submitEvidenceArtifact(envelope);

  const workOrder: ResearchWorkOrderRecord = {
    externalWorkOrderId: "wo_rt_uat_lofi",
    status: "open",
    correlationId
  };

  const { view } = await runAnalysisWorkflow({
    adapter,
    client,
    workOrder,
    brief: {
      client: "research-team",
      projectId: project.projectId,
      externalWorkOrderId: "wo_rt_uat_lofi",
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
      idempotencyKey: `wo_rt_uat_lofi:marketplace-analysis:${packageId}`
    },
    poll: { intervalMs: 100, timeoutMs: 60_000 }
  });

  console.log("taskState", view.taskState, "maaStatus", view.maaStatus);
  console.log("correlationId", view.correlationId);
  console.log("runId", view.maaRunId);

  if (view.taskState === "ready_for_review") {
    const artifact = await adapter.acceptAsResearchArtifact(workOrder);
    console.log("RESEARCH_TEAM_UAT_OK accepted artifact for", artifact?.maaRunId);
  } else if (view.taskState === "needs_orchestrator_decision") {
    const decision = await adapter.toOrchestratorDecision(workOrder);
    console.log("RESEARCH_TEAM_UAT_OK orchestrator decision", decision.decision);
  } else {
    console.log("RESEARCH_TEAM_UAT_OK terminal view", view.taskState);
  }

  if (shutdown) await shutdown();
}

main().catch((err) => {
  console.error("RESEARCH_TEAM_UAT_FAIL", err);
  process.exit(1);
});
