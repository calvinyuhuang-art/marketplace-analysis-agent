# N7 Completion — Hardening & Shared-Contract Alignment

**Status:** Complete  
**Service version:** `0.17.0`  
**Database schema:** `0014` (unchanged)  
**API compat label:** `2026.07`  
**Date:** 2026-07-28

---

## Delivered

| Area | Evidence |
|---|---|
| Remove public `propose_memory_update` | Removed from `OperationType` + KDP capability pack; POST → `UNSUPPORTED_OPERATION` before model |
| Soft phase aliases | `PHASE_DISPLAY_LABELS` / `phaseDisplayLabel` in `@maa/contracts`; console Run Inspector labels |
| Shared contracts | `@maa/agent-memory-contracts` README + package docs |
| Client compat | `@maa/client` exports `MIN_SERVER_VERSION = "0.17.0"` |
| Backup coverage | Ops test: migrate → backup → restore asserts N1–N6 tables + `baseline_evidence_package_ids_json` |
| Live UAT | `docs/N7_LIVE_UAT.md` (manual, capped, not CI) |
| Docs | README, Sales OS, API deprecation map |

---

## Explicit non-goals (still out of scope)

- Cloud / multi-tenant auth
- Embeddings / fine-tuning
- LangGraph rewrite
- New marketplaces

---

## Test evidence

- `apps/server/src/n1.experience.test.ts` — removal rejects as `UNSUPPORTED_OPERATION`
- `apps/server/src/n6.comparative.test.ts` — allow-deprecated cannot restore removed op
- `packages/ops/src/ops.test.ts` — backup/restore through schema `0014`
- `packages/contracts/src/phase-aliases.test.ts`
- Full suite + typecheck + build + e2e at ship

---

## Cycle status

**N0–N7 complete** for the approved implementation scope.
