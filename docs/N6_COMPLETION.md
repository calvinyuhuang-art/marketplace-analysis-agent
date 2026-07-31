# N6 Completion — Comparative Analysis + Integration Polish

**Status:** Complete  
**Service version:** `0.16.0`  
**Database schema:** `0014`  
**API compat label:** `2026.07`  
**Date:** 2026-07-28

---

## Delivered

| Area | Evidence |
|---|---|
| Comparative analysis | `baselineEvidencePackageIds` + `comparative_analysis` fixture `analysis.v1.comparative` |
| Capability guard | Cross-capability packages → `UNSUPPORTED_CAPABILITY` before model |
| Deprecation Hide | `propose_memory_update` omitted from `GET /v1/capabilities` unless `X-Maa-Allow-Deprecated` |
| Client | Capabilities, feedback, outcomes, `createComparativeAnalysis` helper |
| Docs | README + Sales OS + API deprecation map updated |

---

## Explicit non-goals (deferred)

- N7 public removal of `propose_memory_update` from OperationType
- New marketplaces

---

## Test evidence

- `apps/server/src/n6.comparative.test.ts` — happy path + hide + cross-capability reject
- `packages/client/src/m9.client.test.ts` — comparative helper
- Full suite + typecheck + build + e2e at ship

---

## Next

**N0–N7 cycle complete.** See `docs/N7_COMPLETION.md`.
