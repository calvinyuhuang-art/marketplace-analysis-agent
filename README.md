# Marketplace Analysis Agent (MAA)

A standalone, local-first, **constrained** marketplace intelligence service. MAA
turns normalized marketplace evidence into decision-ready commercial
intelligence, checks evidence sufficiency before making claims, produces
traceable findings, and learns through governed memory — all behind a stable
HTTP API. It is **not** a chatbot or an autonomous agent.

The authoritative product specification for the completed M0–M10 cycle is
[`Marketplace_Analysis_Agent_Development_Plan.md`](./Marketplace_Analysis_Agent_Development_Plan.md).

The **next architecture cycle (N0–N7)** is governed by Design Spec v0.3 / Learning
Architecture v0.2. N0 compatibility freeze artifacts live under [`docs/`](./docs/):

- [`docs/COMPATIBILITY_MAP.md`](./docs/COMPATIBILITY_MAP.md)
- [`docs/N0_ARCHITECTURE_DECISIONS.md`](./docs/N0_ARCHITECTURE_DECISIONS.md)
- [`docs/API_DEPRECATION_MAP.md`](./docs/API_DEPRECATION_MAP.md)
- [`docs/N1_IMPLEMENTATION_PLAN.md`](./docs/N1_IMPLEMENTATION_PLAN.md)
- [`docs/N1_COMPLETION.md`](./docs/N1_COMPLETION.md)
- [`docs/N2_IMPLEMENTATION_PLAN.md`](./docs/N2_IMPLEMENTATION_PLAN.md)
- [`docs/N2_COMPLETION.md`](./docs/N2_COMPLETION.md)
- [`docs/N3_IMPLEMENTATION_PLAN.md`](./docs/N3_IMPLEMENTATION_PLAN.md)
- [`docs/N3_COMPLETION.md`](./docs/N3_COMPLETION.md)
- [`docs/N4_IMPLEMENTATION_PLAN.md`](./docs/N4_IMPLEMENTATION_PLAN.md)
- [`docs/N4_COMPLETION.md`](./docs/N4_COMPLETION.md)
- [`docs/N5_IMPLEMENTATION_PLAN.md`](./docs/N5_IMPLEMENTATION_PLAN.md)
- [`docs/N5_COMPLETION.md`](./docs/N5_COMPLETION.md)
- [`docs/N6_IMPLEMENTATION_PLAN.md`](./docs/N6_IMPLEMENTATION_PLAN.md)
- [`docs/N6_COMPLETION.md`](./docs/N6_COMPLETION.md)
- [`docs/N7_IMPLEMENTATION_PLAN.md`](./docs/N7_IMPLEMENTATION_PLAN.md)
- [`docs/N7_COMPLETION.md`](./docs/N7_COMPLETION.md)
- [`docs/N7_LIVE_UAT.md`](./docs/N7_LIVE_UAT.md)
- [`docs/SALES_OS_INTEGRATION.md`](./docs/SALES_OS_INTEGRATION.md)

> Research direction, product, topic, and evidence are always supplied per
> request by the upstream Sales OS Research Orchestrator. Platform/category/
> product are capability-pack coordinates, never hardcoded request defaults.

## Status: LP8-I1a complete — Learning Plane client compatibility (0.18.1)

M0–M10 + N0–N7 remain shipped. **LP8-I1** foundation (0.18.0 / schema **0015**)
plus **LP8-I1a** advances service to **0.18.1** with corrected
`@learning-plane/client@0.7.1` / `@learning-plane/contracts@0.7.1` artifacts
(no new migration). API compatibility remains **2026.07**. The adapter still
registers as `marketplace-analysis-agent`, reports health, and stores secrets
outside SQLite. Production event publish/receive is intentionally not implemented.

Prior N7 (0.17.0 / schema 0014) hardening notes remain in `docs/N7_COMPLETION.md`.
Learning Plane adapter details: Learning Plane repo
`docs/LP8_I1_MAA_ADAPTER_FOUNDATION.md` and `docs/LP8_I1A_CLIENT_COMPATIBILITY_CLOSURE.md`.

## Prerequisites

- Node.js 20.10+ (plan targets Node 24; this repo runs on Node 20 LTS)
- pnpm 9+

## Quick start (run the agent)

```bash
pnpm install
pnpm migrate        # apply SQL migrations to SQLite
pnpm dev            # API :4320 + console :5173
```

Or separately:

```bash
pnpm dev:server
pnpm dev:console
```

Open http://127.0.0.1:5173 for the operator console.  
API base: http://127.0.0.1:4320

Default mode uses the **fake** provider (`MAA_DEFAULT_MODEL_PROFILE=mock-only`) —
no API key required.

## Configure a live LLM (DeepSeek)

1. Copy env template and edit:

```bash
copy .env.example .env
```

2. Set:

```env
MAA_DEEPSEEK_ENABLED=true
DEEPSEEK_API_KEY=sk-your-key-here
MAA_DEFAULT_MODEL_PROFILE=budget-deepseek
# or: recommended-deepseek
```

3. Restart the server (`pnpm dev` or `pnpm dev:server`).

4. Confirm profiles:

```bash
curl http://127.0.0.1:4320/v1/model-profiles
```

DeepSeek profiles show `enabled: true` only when the flag is on and the key is
non-empty. Leave `MAA_DEEPSEEK_ENABLED=false` to fully disable live calls.

Cost caps come from the model profile (`costCapUsd`). Analysis aborts if the
run exceeds the cap.

## How to test

### Automated gates

```bash
pnpm typecheck
pnpm lint
pnpm test           # unit + API (Vitest)
pnpm test:e2e       # Playwright (starts server + console)
pnpm build
```

### Manual smoke (fake provider)

1. Start `pnpm dev`.
2. Console → **Evidence** — or register via API:

```bash
curl -X POST http://127.0.0.1:4320/v1/evidence-packages ^
  -H "Content-Type: application/json" ^
  -d @- < fixtures path — or use console New Analysis with a package id
```

Easiest path in the console:

1. **New Analysis** — fill product name / sales goal from upstream, paste an
   evidence package id after registering one (e2e uses `completeKdpFixture`).
2. Wait for **completed** / **partial** on Run Inspector.
3. **Open Finding Review** — accept/reject a finding.
4. On Run Inspector → **Start revision** (optional notes/reason).
5. Open the new revision run — check revision diff + learning events.

### API revision example

```bash
curl -X POST http://127.0.0.1:4320/v1/analysis-runs/<PRIOR_RUN_ID>/revise ^
  -H "Content-Type: application/json" ^
  -d "{\"reasonCode\":\"missing_analysis\",\"affectedAreas\":[\"customer_evidence\",\"pricing\"],\"supplementalEvidencePackageIds\":[\"evpkg_extra\"],\"reviewerId\":\"operator\"}"
```

### Live DeepSeek smoke (optional, costs money)

With DeepSeek enabled in `.env`:

```bash
pnpm exec tsx scripts/live-deepseek-smoke.ts
```

Expect `LIVE_DEEPSEEK_SMOKE_OK`, `provider=deepseek`, and at least one ok
model call. Set `MAA_LIVE_KEEP_ARTIFACTS=1` to keep the temp SQLite/artifacts
dir for inspection.

Or manually: register a complete evidence package, create a
`full_marketplace_analysis` with a small `costCapUsd`, then confirm
`/v1/analysis-runs/:id/model-calls` shows `provider: deepseek`.

## Layout

```text
apps/       server (Express) and console (React/Vite)
packages/   contracts, analysis, quality, agent-core, evidence, …
migrations/ numbered SQL migrations
fixtures/   evidence fixtures for tests
e2e/        Playwright specs
```

## Configuration

Copy `.env.example` to `.env`. Invalid required config fails fast at startup.
Secrets (`DEEPSEEK_API_KEY`, `MAA_API_KEY`) are redacted from logs.

### Local API auth

Set `MAA_API_KEY` (or `MAA_CONFIG_PROFILE=local-hardened`) to require
`Authorization: Bearer …` or `x-api-key` on all routes except `/health` and
`/ready`. Production refuses to start without auth. Console: set
`VITE_MAA_API_KEY` to match.

### Ops CLI

```bash
pnpm maa integrity
pnpm maa backup [--artifacts]
pnpm maa restore <backupPath> [--artifacts]
pnpm maa retention [--days=30] [--execute]   # dry-run by default
pnpm maa release-check
```
