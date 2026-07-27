/**
 * Minimal Research Team client example (API only — no DB coupling).
 *
 *   MAA_BASE_URL=http://127.0.0.1:4320 \
 *   MAA_API_KEY=optional-local-key \
 *   pnpm exec tsx examples/research-team-client.ts
 */
import {
  MarketplaceAnalysisClient,
  ResearchTeamMaaAdapter,
  isResearchTeamMaaEnabled,
  wrapEvidenceArtifact
} from "@maa/client";
import { completeKdpFixture } from "../fixtures/evidence/kdp-fixtures";

async function main() {
  if (!isResearchTeamMaaEnabled({ RESEARCH_TEAM_MAA_ENABLED: "true" })) {
    // Example forces enable for demo; production gates on env.
  }

  const client = new MarketplaceAnalysisClient({
    baseUrl: process.env.MAA_BASE_URL ?? "http://127.0.0.1:4320",
    apiKey: process.env.MAA_API_KEY,
    correlationId: `corr_example_${Date.now()}`
  });

  const health = await client.health();
  console.log("health", health.status, health.version);

  const adapter = new ResearchTeamMaaAdapter({
    client,
    enabled: true
  });

  const project = await client.createProject({
    name: "Example Project",
    capability: {
      platform: "amazon",
      marketplace: "US",
      category: "books",
      productType: "adult_coloring_book"
    },
    productContext: {
      name: "Lofi Rainy Day Coloring Book",
      salesGoal: "Example only",
      constraints: []
    }
  });

  const { packageId } = await adapter.submitEvidenceArtifact(
    wrapEvidenceArtifact({
      artifactId: `ex_${Date.now()}`,
      package: completeKdpFixture(`evpkg_ex_${Date.now()}`)
    })
  );

  const created = await client.createAnalysis({
    client: "research-team",
    projectId: project.projectId,
    operation: "full_marketplace_analysis",
    capability: {
      platform: "amazon",
      marketplace: "US",
      category: "books",
      productType: "adult_coloring_book"
    },
    productContext: {
      name: "Lofi Rainy Day Coloring Book",
      salesGoal: "Example only",
      constraints: []
    },
    requestedAnalysis: ["pricing", "competitor_set", "customer_evidence"],
    evidencePackageIds: [packageId],
    idempotencyKey: `example:${packageId}`
  });

  console.log("accepted", created.status, created.runId, created.correlationId);
  const terminal = await client.pollRun(created.runId, { intervalMs: 200, timeoutMs: 60_000 });
  console.log("terminal", terminal.status);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
