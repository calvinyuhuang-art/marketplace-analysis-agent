# Sales OS ↔ Marketplace Analysis Agent (MAA) Integration Guide

**Audience:** Sales OS / Research Team developers  
**MAA version:** 0.10.0  
**Last updated:** 2026-07-27

This document describes how to connect Sales OS to MAA for marketplace analysis. MAA is a **standalone HTTP service** — integrate via API or the typed client only. **Do not** read or write the MAA SQLite database.

---

## 1. Project status

MAA is feature-complete through **M10** (service version **0.10.0**).

| Milestone | Capability |
|---|---|
| M0–M2 | Durable runtime, evidence packages, readiness evaluation |
| M3–M4 | Structured analysis, findings review, revisions |
| M5–M7 | Project memory, Error Book, reusable memory governance |
| M8 | Governed wiki (memory projection) |
| M9 | `@maa/client` + Research Team adapter |
| M10 | Local API auth, backup/ops, config profiles |

**Out of scope (separate design required):** cloud multi-tenancy, enterprise SSO/OIDC, public internet deployment.

---

## 2. Architecture

```
Sales OS (Research Team)
  │
  │  HTTP / @maa/client only
  │  (never touch MAA SQLite)
  ▼
MAA API  http://127.0.0.1:4320
  ├─ POST /v1/evidence-packages
  ├─ POST /v1/analysis-requests          → 202 Accepted
  ├─ GET  /v1/analysis-runs/:runId
  ├─ GET  /v1/analysis-runs/:runId/readiness
  ├─ GET  /v1/analysis-runs/:runId/collection-requests
  ├─ GET  /v1/analysis-runs/:runId/findings
  └─ GET  /v1/analysis-runs/:runId/output
```

MAA **does not call MCEC**. Sales OS owns the evidence-collection loop when MAA reports gaps.

---

## 3. Run MAA locally (for development)

In the MAA repository:

```bash
pnpm install
pnpm migrate
pnpm dev
```

| Service | URL |
|---|---|
| API | http://127.0.0.1:4320 |
| Operator console (optional) | http://127.0.0.1:5173 |

Smoke check:

```bash
curl http://127.0.0.1:4320/health
```

Expected: `{"status":"ok","version":"0.10.0",...}`

Default mode uses the **mock provider** (`MAA_DEFAULT_MODEL_PROFILE=mock-only`) — no LLM API key required for integration testing.

---

## 4. Environment variables

### MAA side (`.env`)

```env
MAA_HOST=127.0.0.1
MAA_PORT=4320
MAA_DEFAULT_MODEL_PROFILE=mock-only

# Optional — recommended for shared/local-hardened testing:
# MAA_API_KEY=your-shared-secret
# MAA_REQUIRE_API_KEY=true
# MAA_CONFIG_PROFILE=local-hardened
```

### Sales OS side

```env
MAA_BASE_URL=http://127.0.0.1:4320
MAA_API_KEY=your-shared-secret          # only if MAA auth is enabled
RESEARCH_TEAM_MAA_ENABLED=true
```

When `MAA_API_KEY` is set on MAA, all routes except `/health` and `/ready` require authentication.

---

## 5. Recommended integration approach

Use the typed client and adapter from the MAA repo:

| Package | Path | Purpose |
|---|---|---|
| `@maa/client` | `packages/client` | HTTP client, polling, evidence wrap/unwrap |
| `@maa/contracts` | `packages/contracts` | Shared types and Zod schemas |
| `ResearchTeamMaaAdapter` | `packages/client/src/research-adapter.ts` | Work-order mapping, orchestrator routing |

**Options for Sales OS:**

1. **Workspace/path dependency** — reference `packages/client` from a monorepo or `file:` link.
2. **Copy packages** — vendor `@maa/client` + `@maa/contracts` into Sales OS (keep versions in sync).
3. **Raw HTTP** — possible but not recommended; schemas and idempotency behavior are easier via the client.

Reference implementation: `examples/research-team-client.ts`  
UAT smoke script: `scripts/research-team-uat-smoke.ts`

---

## 6. Sales OS data model (persist on your side)

For each work order / research task, store:

| Field | Purpose |
|---|---|
| `externalWorkOrderId` | Your Sales OS task id |
| `maaRequestId` | MAA analysis request id |
| `maaRunId` | MAA run id (use for poll/reconnect) |
| `correlationId` | End-to-end tracing |
| `acceptedArtifact` | Snapshot when analysis is accepted into Sales OS |

On page reload or retry, call `adapter.reconnect(workOrder)` using stored `maaRunId` — do not create a duplicate run unless intentional.

---

## 7. Integration flow

### Step 0 — Feature flag and client bootstrap

```ts
import {
  MarketplaceAnalysisClient,
  ResearchTeamMaaAdapter,
  isResearchTeamMaaEnabled,
  wrapEvidenceArtifact,
  runAnalysisWorkflow
} from "@maa/client";

const client = new MarketplaceAnalysisClient({
  baseUrl: process.env.MAA_BASE_URL!,
  apiKey: process.env.MAA_API_KEY,       // optional in dev
  correlationId: workOrder.correlationId  // from Sales OS request context
});

const adapter = new ResearchTeamMaaAdapter({
  client,
  enabled: isResearchTeamMaaEnabled(process.env)
});
```

Gate all MAA calls behind `RESEARCH_TEAM_MAA_ENABLED` (or equivalent).

### Step 1 — Create project (once per product/research line)

```ts
const project = await client.createProject({
  name: "Lofi Rainy Day Coloring Book",
  externalProjectId: "sales_os_project_123",  // optional
  capability: {
    platform: "amazon",
    marketplace: "US",
    category: "books",
    productType: "adult_coloring_book"
  },
  productContext: {
    name: "Lofi Rainy Day Coloring Book",
    description: "Optional",
    salesGoal: "Validate KDP coloring niche",
    constraints: []
  }
});
// project.projectId → use in analysis requests
```

Capability coordinates identify the capability pack — they are **not** product defaults. Product/topic always come from `productContext` and upstream orchestrator.

### Step 2 — Register evidence

Wrap MCEC/orchestrator output as an evidence artifact envelope, then register:

```ts
const envelope = wrapEvidenceArtifact({
  artifactId: `rt_${workOrderId}`,
  package: evidencePackage,              // EvidencePackageInput — see §10
  correlationId: workOrder.correlationId,
  externalWorkOrderId: workOrderId
});

const { packageId } = await adapter.submitEvidenceArtifact(envelope, workOrder);
```

### Step 3 — Submit analysis (expect HTTP 202)

```ts
const { create, view } = await adapter.submitAnalysis(
  {
    client: "research-team",
    projectId: project.projectId,
    externalWorkOrderId: workOrderId,
    operation: "full_marketplace_analysis",
    capability: {
      platform: "amazon",
      marketplace: "US",
      category: "books",
      productType: "adult_coloring_book"
    },
    productContext: {
      name: "Lofi Rainy Day Coloring Book",
      salesGoal: "Validate KDP coloring niche",
      constraints: []
    },
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
    idempotencyKey: `${workOrderId}:marketplace-analysis:v1`
  },
  workOrder
);

// create.runId, create.requestId, create.correlationId → persist on work order
// HTTP status is 202 Accepted
```

**Idempotency:** Re-sending the same `idempotencyKey` with an identical payload returns the same run. Changing the payload with the same key returns `409 IDEMPOTENCY_CONFLICT`.

### Step 4 — Poll until terminal

```ts
await client.pollRun(create.runId, {
  intervalMs: 500,
  timeoutMs: 120_000
});

const view = await adapter.refreshView(workOrder);
```

Or use the combined helper:

```ts
const { view } = await runAnalysisWorkflow({
  adapter,
  client,
  workOrder,
  brief: { /* same as submitAnalysis */ },
  poll: { intervalMs: 500, timeoutMs: 120_000 }
});
```

### Step 5 — Map MAA state to Sales OS task UI

`view.taskState` values:

| `taskState` | Meaning | Sales OS action |
|---|---|---|
| `queued` | Accepted, not started | Show waiting |
| `running` | Planning / analyzing | Show in progress |
| `needs_orchestrator_decision` | Evidence gap or partial with collection requests | Route to Research Orchestrator |
| `ready_for_review` | `completed` or reviewable `partial` | Show findings / review UI |
| `accepted_artifact` | (Sales OS local state after accept) | Show stored artifact |
| `failed` / `cancelled` | Terminal error | Show error; do not wipe prior accepted artifacts |

Underlying MAA status is in `view.maaStatus` and `view.currentPhase`.

### Step 6 — Evidence gap → Research Orchestrator

When `view.taskState === "needs_orchestrator_decision"`:

```ts
const decision = await adapter.toOrchestratorDecision(workOrder);
// decision.decision === "collect_evidence"
// decision.reason === "maa_evidence_gap"
// decision.collectionRequests → array of collection requests for orchestrator
// decision.correlationId, decision.maaRunId → for tracing
```

Sales OS collects supplemental evidence via MCEC/orchestrator, then either:

- Submit a **revision** with supplemental package (§8), or  
- Register new evidence and start a new analysis with a new idempotency key.

### Step 7 — Accept analysis as Sales OS artifact

When `view.taskState === "ready_for_review"` and the operator accepts:

```ts
const artifact = await adapter.acceptAsResearchArtifact(workOrder);
// artifact = { kind: "marketplace_analysis", maaRunId, output, acceptedAt }
// Store in Sales OS as immutable research artifact
```

`output` is the full analysis payload from `GET /v1/analysis-runs/:runId/output`.

### Step 8 — Reconnect after reload

```ts
const view = await adapter.reconnect(workOrder);
// Uses workOrder.maaRunId — no new run created
```

---

## 8. Revision with supplemental evidence

After a completed/partial run, when more evidence is available:

```ts
const view = await adapter.reviseWithSupplementalEvidence(workOrder, {
  reasonCode: "missing_analysis",   // see FindingReviewReasonCode in contracts
  instructions: "Add competitor reviews from three ASINs",
  supplementalPackage: extraEvidencePackage,
  affectedAreas: ["customer_evidence", "competitor_set"]
});
// Creates new run; prior run output remains immutable
// workOrder.maaRunId updates to new run
```

Valid `reasonCode` values: `unsupported_conclusion`, `incorrect_evidence_interpretation`, `missing_analysis`, `wrong_scope`, `stale_memory_or_evidence`, `contradiction_ignored`, `confidence_miscalibrated`, `other`.

---

## 9. HTTP API reference (if not using `@maa/client`)

### Authentication

When `MAA_API_KEY` is configured:

| Header | Value |
|---|---|
| `Authorization` | `Bearer <MAA_API_KEY>` |
| `x-api-key` | `<MAA_API_KEY>` |

Public (no auth): `GET /health`, `GET /ready` only.

### Tracing and idempotency

| Header | When |
|---|---|
| `x-correlation-id` | Every request — propagate from Sales OS |
| `Idempotency-Key` | `POST /v1/analysis-requests`, `POST /v1/analysis-runs/:id/revise` |

### Key endpoints

| Method | Path | Status | Notes |
|---|---|---|---|
| GET | `/health` | 200 | Liveness |
| GET | `/ready` | 200 | DB + artifact root ready |
| GET | `/metrics` | 200 | JSON metrics |
| POST | `/v1/projects` | 201 | Create project |
| POST | `/v1/evidence-packages` | 201 | Register evidence |
| POST | `/v1/analysis-requests` | **202** | Start analysis |
| GET | `/v1/analysis-runs/:runId` | 200 | Poll status |
| GET | `/v1/analysis-runs/:runId/readiness` | 200 | Per-area readiness |
| GET | `/v1/analysis-runs/:runId/collection-requests` | 200 | Evidence gaps |
| GET | `/v1/analysis-runs/:runId/findings` | 200 | Structured findings |
| GET | `/v1/analysis-runs/:runId/output` | 200 | Full analysis output |
| POST | `/v1/analysis-runs/:runId/revise` | **202** | Start revision |

### Error contract

All errors return:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "...",
    "requestId": "req_...",
    "correlationId": "corr_...",
    "details": [],
    "retryable": false
  }
}
```

Common codes: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `NOT_FOUND` (404), `IDEMPOTENCY_CONFLICT` (409).

---

## 10. Evidence package shape

Evidence must conform to `EvidencePackageInput` (`packages/contracts/src/evidence.ts`).

Minimal structure:

```json
{
  "packageId": "evpkg_sales_os_001",
  "sourceClient": "research-team",
  "schemaVersion": "1.0.0",
  "platform": "amazon",
  "marketplace": "US",
  "category": "books",
  "productType": "adult_coloring_book",
  "items": [
    {
      "evidenceId": "evid_l1",
      "sourceType": "listing",
      "platform": "amazon",
      "marketplace": "US",
      "subjectId": "B001",
      "title": "Competitor title",
      "textContent": "Positioning text",
      "fields": { "price": 9.99, "format": "paperback", "pageCount": 80 },
      "confidence": 1,
      "validationStatus": "valid",
      "provenance": {
        "sourceUrl": "https://www.amazon.com/dp/B001",
        "collector": "mcec",
        "collectorVersion": "1.0.0",
        "observedAt": "2026-06-01T12:00:00.000Z"
      }
    },
    {
      "evidenceId": "evid_r1",
      "sourceType": "review",
      "platform": "amazon",
      "marketplace": "US",
      "subjectId": "B001",
      "title": "Customer review",
      "textContent": "Review text here",
      "fields": { "rating": 4 },
      "provenance": {
        "collector": "mcec",
        "collectorVersion": "1.0.0",
        "observedAt": "2026-06-01T12:00:00.000Z"
      }
    }
  ]
}
```

**Test fixtures** in the MAA repo: `fixtures/evidence/kdp-fixtures.ts`  
(`completeKdpFixture` = full package; `listingsWithoutReviewsFixture` = triggers evidence gap).

---

## 11. curl smoke test (no Sales OS code)

```bash
# Health
curl http://127.0.0.1:4320/health

# Register evidence (save JSON from fixture or build manually)
curl -X POST http://127.0.0.1:4320/v1/evidence-packages \
  -H "Content-Type: application/json" \
  -d @evidence-package.json

# Create project
curl -X POST http://127.0.0.1:4320/v1/projects \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Integration test",
    "capability": {"platform":"amazon","marketplace":"US","category":"books","productType":"adult_coloring_book"},
    "productContext": {"name":"Test","salesGoal":"Smoke test","constraints":[]}
  }'

# Start analysis (replace ids)
curl -X POST http://127.0.0.1:4320/v1/analysis-requests \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: wo_smoke:v1" \
  -H "x-correlation-id: corr_smoke" \
  -d '{
    "client": "research-team",
    "projectId": "proj_...",
    "operation": "full_marketplace_analysis",
    "capability": {"platform":"amazon","marketplace":"US","category":"books","productType":"adult_coloring_book"},
    "productContext": {"name":"Test","salesGoal":"Smoke test","constraints":[]},
    "requestedAnalysis": ["pricing","competitor_set","customer_evidence"],
    "evidencePackageIds": ["evpkg_..."]
  }'

# Poll (expect 202 on create, then 200 on poll until completed/partial/failed)
curl http://127.0.0.1:4320/v1/analysis-runs/run_...
```

Bundled UAT:

```bash
pnpm exec tsx scripts/research-team-uat-smoke.ts
```

---

## 12. Implementation rules (must follow)

1. **API/client only** — never access `maa.sqlite` or MAA artifact directories directly.
2. **Idempotency** — always set `Idempotency-Key` on create and revise; use `${workOrderId}:marketplace-analysis:v1` pattern.
3. **Correlation** — propagate `x-correlation-id` from Sales OS request through every MAA call.
4. **Reconnect** — on reload, use stored `maaRunId`; do not create duplicate runs.
5. **Failure isolation** — MAA errors must not corrupt Sales OS accepted artifacts (`ResearchTeamMaaAdapter` preserves `acceptedArtifact` on failure).
6. **Evidence gaps** — route to Research Orchestrator; MAA does not call MCEC.
7. **Feature flag** — gate integration on `RESEARCH_TEAM_MAA_ENABLED`.
8. **Auth** — when MAA has `MAA_API_KEY` set, send `Authorization: Bearer` or `x-api-key` on every non-health request.

---

## 13. Suggested Sales OS module structure

```
sales-os/
  src/
    integrations/
      maa/
        config.ts              # MAA_BASE_URL, MAA_API_KEY, feature flag
        client.ts              # MarketplaceAnalysisClient singleton
        adapter.ts             # ResearchTeamMaaAdapter wrapper
        work-order-store.ts    # Persist maaRunId, correlationId, artifact
        poll-job.ts            # Background poll / webhook-style refresh
        map-task-state.ts      # view.taskState → Sales OS UI states
        types.ts               # Re-export from @maa/contracts as needed
```

**Polling:** Poll `GET /v1/analysis-runs/:runId` every 1–2s until status is terminal (`completed`, `partial`, `evidence_insufficient`, `failed`, `cancelled`). Use `client.pollRun()` or equivalent.

---

## 14. Related documentation in MAA repo

| File | Content |
|---|---|
| `M9_COMPLETION.md` | Research Team integration acceptance criteria |
| `M10_COMPLETION.md` | Auth, backup, ops |
| `docs/THREAT_MODEL.md` | Trust boundaries and security |
| `examples/research-team-client.ts` | Minimal working client |
| `Marketplace_Analysis_Agent_Development_Plan.md` | Full product specification |
| `.env.example` | All configuration keys |

---

## 15. Support checklist for first integration test

- [ ] MAA running at `MAA_BASE_URL` (`pnpm dev`)
- [ ] `GET /health` returns `0.10.0`
- [ ] `RESEARCH_TEAM_MAA_ENABLED=true` in Sales OS
- [ ] Auth headers configured if `MAA_API_KEY` is set on MAA
- [ ] Evidence package registers with `201`
- [ ] Analysis create returns `202` with `runId`
- [ ] Poll reaches `completed` or `partial` (mock provider ~seconds)
- [ ] Reload reconnects to same `runId` via idempotency / stored ids
- [ ] Evidence-gap fixture triggers `needs_orchestrator_decision`
- [ ] Accepted output stored as Sales OS artifact

---

*Questions or schema changes: coordinate with the MAA repo maintainers before altering API contracts.*
