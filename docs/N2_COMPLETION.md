# N2 Completion — Evidence Plans + Plan Review

**Status:** Complete  
**Service version:** `0.12.0`  
**Database schema:** `0010`  
**API compat label:** `2026.07`  
**Date:** 2026-07-28

---

## Delivered

| Area | Evidence |
|---|---|
| Collector capability snapshots | `POST /v1/collector-capability-snapshots` → immutable hashed artifacts |
| Evidence plans | `POST/GET /v1/evidence-plans` pinning snapshot id + hash |
| Deterministic plan review | `POST /v1/evidence-plans/:planId/review` + `operation=review_evidence_plan` |
| Review pin | `evidence_plan_reviews` stores plan version + snapshot id/hash |
| Fail closed | Hash mismatch / missing artifact → `EVIDENCE_PROVENANCE_INVALID` |
| Experience | Plan-review run captures experience + deterministic evaluation |
| Client | `registerCollectorSnapshot`, `createEvidencePlan`, `getEvidencePlan`, `reviewEvidencePlan` |

---

## Governing UAT Phase A

Pricing plan requesting `binding` + `format` with snapshot claiming those listing fields → **`suitable`** (not blocked). Unsupported fields → **`unsuitable`**.

---

## Explicit non-goals (deferred)

- Workflow feedback / late-gap loop (**N3**)
- Typed procedural prevention (**N4**)
- Collection-quality checks inside plan review

---

## Test evidence

- `apps/server/src/n2.evidence-plans.test.ts` — UAT Phase A, unsupported field, hash mismatch
- Full suite + typecheck + build + e2e at ship

---

## Next

**N3** — workflow feedback events + supplemental resolution loop (completes operational late-gap UAT).
