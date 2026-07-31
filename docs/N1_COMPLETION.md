# N1 Completion — Contracts + Experience/Evaluation Capture

**Status:** Complete  
**Service version:** `0.11.0`  
**Database schema:** `0009`  
**API compat label:** `2026.07`  
**Date:** 2026-07-28

---

## Delivered

| Area | Evidence |
|---|---|
| `@maa/agent-memory-contracts` | Zod package (authority, scope, experience, evaluation, workflow-feedback/outcome/procedural/snapshot stubs) |
| Migration `0009_experiences.sql` | `agent_experiences` (UNIQUE `run_id`), `agent_evaluations` (idempotent unique key) |
| Runtime capture | Workflow hooks: start → complete; deterministic readiness evaluation |
| One-way dual-write | Finding reviews, run reviews, learning events → evaluations only |
| APIs | `GET /v1/analysis-runs/:runId/experience`, `GET /v1/experiences/:experienceId/evaluations` |
| Headers | `x-maa-api-compat: 2026.07` on `/v1/*`; `propose_memory_update` Warn (`Deprecation` + `Sunset`) |
| Ops | Backup manifest requires `databaseSchemaVersion`, `serviceVersion`, `artifactManifestVersion`; restore rejects future schema |
| Client | `getRunExperience`, `listExperienceEvaluations` |
| Console | Run Inspector **Experience** panel |

---

## Explicit non-goals (still deferred)

- Evidence plans / collector snapshots persistence (N2)
- Workflow feedback store (N3)
- Typed procedural registry (N4)
- Outcomes / reassessment (N5)
- Bidirectional sync with `learning_events`
- Historical backfill CLI (optional; not shipped)

---

## Binding amendments honored

1. Dual-write is **one-way** (legacy → evaluations).
2. Idempotency includes `sourceSystem` + `sourceRecordId`.
3. Backup envelope remains `maa-backup.v1` with required schema/service/artifact-manifest metadata.
4. `propose_memory_update` Sunset: `2026-10-26T00:00:00.000Z` (Warn stage).

---

## Test evidence

- `apps/server/src/n1.experience.test.ts` — one experience/run, deterministic eval, dual-write no-loop, deprecation headers
- `packages/ops/src/ops.test.ts` — backup/restore fields + reject future `databaseSchemaVersion`
- `packages/agent-memory-contracts/src/contracts.test.ts` — contract unit tests
- Full suite: `pnpm typecheck && pnpm test && pnpm build` (run at ship)

---

## Next

Await acceptance, then plan **N2** (evidence plans + plan review + collector capability snapshots).
