# M9 Completion Report — Research Team Integration

**Milestone:** M9  
**Status:** Complete (pending your acceptance)  
**Service version:** 0.9.0  
**Date:** 2026-07-26

## Objective

Use MAA as a clean external tool from Sales OS Research Team — API/client only, no database coupling.

## What shipped

| Area | Deliverable |
|---|---|
| Contracts | `packages/contracts/src/research-integration.ts` — evidence artifact envelope, RT task states, status mapping |
| Package | `@maa/client` — typed HTTP client, poll helper, evidence wrap/unwrap |
| Adapter | `ResearchTeamMaaAdapter` behind `RESEARCH_TEAM_MAA_ENABLED` / `MAA_RESEARCH_TEAM_ADAPTER` |
| Workflow | Idempotent create → poll → refresh; revise with supplemental evidence; accept as RT artifact |
| Tests | Unit mapping + mocked HTTP integration (`m9.research-integration.test.ts`) |
| UAT | `scripts/research-team-uat-smoke.ts` (Lofi Rainy Day fixture) |

## Acceptance

| Criterion | Result |
|---|---|
| Research Team submits evidence package and receives `202` | Pass (client `createAnalysis`) |
| Reload reconnects to same external run | Pass (`reconnect` / idempotency key) |
| Evidence gap routes to orchestrator decision | Pass (`toOrchestratorDecision`) |
| MAA does not call MCEC | Pass (artifact exchange only) |
| Accepted analysis becomes Research Team artifact | Pass (`acceptAsResearchArtifact`) |
| Revisions and supplemental evidence work | Pass |
| Correlation IDs trace across services | Pass (`x-correlation-id`) |
| Integration uses API/client only | Pass (no SQLite access from client) |
| Failure in MAA does not corrupt Research Team state | Pass (accepted artifact preserved on error) |

## Research Team usage sketch

```ts
import {
  MarketplaceAnalysisClient,
  ResearchTeamMaaAdapter,
  isResearchTeamMaaEnabled,
  wrapEvidenceArtifact,
  runAnalysisWorkflow
} from "@maa/client";

const enabled = isResearchTeamMaaEnabled(process.env);
const client = new MarketplaceAnalysisClient({
  baseUrl: "http://127.0.0.1:4320",
  correlationId: workOrder.correlationId
});
const adapter = new ResearchTeamMaaAdapter({ client, enabled });
```

## Gates

```
pnpm typecheck  → pass
pnpm test       → 28 files / 100 tests pass
pnpm build      → pass
pnpm test:e2e   → 3 pass
```

## Explicit non-goals held

Local API auth, packaging, multi-tenancy (M10).
