# N3 Completion — Workflow Feedback / Late-Gap Loop

**Status:** Complete  
**Service version:** `0.13.0`  
**Database schema:** `0011`  
**API compat label:** `2026.07`  
**Date:** 2026-07-28

---

## Delivered

| Area | Evidence |
|---|---|
| Gap fingerprints | `gap_fingerprints` + `GET /v1/gap-fingerprints/:id` with project-warning flags |
| Workflow feedback | `workflow_feedback_events` + GET by id / by run |
| Late-gap detect | After pricing analysis when binding/format incomplete → `detected` + collection request |
| RT resolve | `POST /v1/workflow-feedback/:id/resolve` (`supplemental_collection` + package IDs) |
| Revision close | `workflowFeedbackId` on revise → `revision_in_progress` → `resolved`/`partially_resolved` + quality metrics |
| Episodic only | `candidateLessonStatus=none`; no typed procedural activation |
| Config | `MAA_GAP_PROJECT_WARNING_THRESHOLD`, `MAA_GAP_CROSS_PROJECT_PROMOTION_THRESHOLD` |

---

## UAT Phase B

Pricing package with format but **no binding** → analysis proceeds → feedback `detected` → RT resolve with supplemental binding package → revise → resolution quality recorded.

---

## Explicit non-goals (deferred)

- Typed `require_format_normalization_for_pricing` (**N4**)
- Cross-project promotion automation

---

## Test evidence

- `apps/server/src/n3.workflow-feedback.test.ts` — full detect → resolve → revise loop
- Full suite + typecheck + build + e2e at ship

---

## Next

**N4** — immutable typed procedural versions + activation / prevention UAT Phase C.
