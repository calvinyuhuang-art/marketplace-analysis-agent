# N5 Implementation Plan — Outcome Events + Reassessment

**Status:** Accepted (continue after N4)  
**Depends on:** N1 experiences/evaluations, N0 responsibility filter  
**Service target:** `0.15.0` · schema `0013`

---

## 1. Objective

Ingest **real-world outcome events** (traffic/sales/execution signals) via API. Run **`reassess_with_outcome`** as a short deterministic workflow that judges **only MAA-owned conclusions** using the responsibility filter. Write canonical evaluations (`sourceSystem=maa.outcome_reassess`). Propose scoped lesson candidates when contradicted/overconfident. **Never** mutate prior analysis output artifacts. Keep legacy `outcome_reviews` forever (human quality judgment ≠ market outcomes).

---

## 2. Explicit non-goals

- N6 comparative analysis / client polish / deprecation Hide stage
- Auto-promotion of reusable memory
- Rewriting historical accepted findings
- Blaming MAA for zero-traffic or execution-only failures

---

## 3. Data model (`0013_outcome_events.sql`)

```text
outcome_events
  outcome_id PK
  project_id, event_type, source, confidence NULL
  measurement_window_json, metrics_json
  linked_artifact_ids_json, linked_finding_ids_json
  linked_experience_id NULL, linked_run_id NULL
  occurred_at, received_at, created_at

outcome_reassessments
  reassessment_id PK, outcome_id FK
  experience_id NULL, run_id NULL
  judgments_json, report_artifact_id
  lesson_candidate_ids_json
  created_at

ALTER analysis_requests ADD COLUMN outcome_id TEXT
```

---

## 4. Responsibility filter (mandatory)

Each judgment ∈  
`supported | contradicted | overconfident | limitation_disclosed_ok | inconclusive_traffic_or_execution | outside_maa_responsibility | causal_attribution_impossible`

| Signal | Judgment |
|---|---|
| No traffic / zero impressions / no-sales window | `inconclusive_traffic_or_execution` (not analysis failure) |
| Listing unpublished / campaign not launched / execution blocked | `outside_maa_responsibility` |
| Explicit causal impossibility | `causal_attribution_impossible` |
| Clear support / contradiction flags in metrics | `supported` / `contradicted` / `overconfident` |

---

## 5. APIs

| Method | Path | Behavior |
|---|---|---|
| `POST` | `/v1/outcomes` | Ingest outcome event → 201 |
| `GET` | `/v1/outcomes/:id` | Outcome DTO + reassessments |
| `GET` | `/v1/projects/:projectId/outcomes` | List |
| `POST` | `/v1/outcomes/:id/reassess` | Create `reassess_with_outcome` run → **202** |

---

## 6. Runtime

- Add `reassess_with_outcome` to `OperationType` + capability allowlist.
- Short workflow (like plan review): no model / no readiness gate.
- Persist reassessment + report artifact; link evaluations to experience.
- Do not rewrite prior `output_artifact_id` content.

---

## 7. Tests

1. No-traffic → `inconclusive_traffic_or_execution` (not `analysis_failed`).
2. Execution-only failure → `outside_maa_responsibility`.
3. Prior output artifact bytes unchanged after reassess.
4. Gates green.

---

## 8. Acceptance

N5 exit: outcomes ingested; reassess 202 + judgments; history immutable; misattribution prevented.
