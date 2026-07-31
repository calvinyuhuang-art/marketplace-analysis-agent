# N3 Implementation Plan — Workflow Feedback / Late-Gap Loop

**Status:** Accepted (continue after N2)  
**Depends on:** N2 (plans/snapshots), N1 (experiences/evaluations)  
**Service target:** `0.13.0` · schema `0011`

---

## 1. Objective

Persist **workflow feedback events** and **gap fingerprints**. Detect **late evidence gaps during analysis** (not plan review): e.g. pricing proceeds because readiness has `format`, but collected `binding`/`format` values are missing, mixed, or contradictory → emit `detected` feedback + collection request. Research Team resolves via API (`supplemental_collection` + package IDs); revision updates feedback to `resolved` / `partially_resolved` with quality metrics. One event remains **episodic** (no typed rule).

---

## 2. Explicit non-goals

- Typed procedural activation (`require_format_normalization_for_pricing`) — **N4**
- Changing N2 plan-review to block claimed-supported fields
- Bidirectional sync with `learning_events`
- Auto-promotion of reusable memory

---

## 3. Data model (`0011_workflow_feedback.sql`)

```text
gap_fingerprints
  fingerprint_id PK
  fingerprint_key UNIQUE   -- formatGapFingerprintKey output
  fingerprint_version
  components_json
  project_id
  first_seen_at, last_seen_at
  distinct_run_count
  distinct_project_count   -- updated when seen across projects

workflow_feedback_events
  workflow_feedback_id PK
  status
  project_id, run_id, request_id, experience_id NULL
  external_work_order_id NULL, correlation_id NULL
  source_agent_id, discovering_agent_id
  upstream_step_key, downstream_step_key
  feedback_type  -- late_evidence_gap
  gap_fingerprint_id FK
  missing_requirement_json
  original_artifact_ids_json
  collection_request_ids_json
  resolution_action NULL
  supplemental_evidence_package_ids_json
  revision_run_id NULL
  resolution_quality NULL
  resolved INTEGER NULL
  added_duration_ms, added_cost_usd, added_collection_rounds
  candidate_lesson_status
  report_artifact_id NULL
  detected_at, updated_at, resolved_at NULL
```

---

## 4. Detection (analysis-time)

After structured analysis when `pricing` was requested/analyzed:

| Signal | Condition |
|---|---|
| Missing binding | Priced listings lack `fields.binding` (readiness may still be ready — binding not required) |
| Missing format on price | Priced listing missing format (partial path) |
| Contradictory | `binding` vs `format` disagree |
| Unsegmented mixed | Quality/tags `mixed_format_unsegmented` |

On detect (once per run, idempotent on run_id):

1. Upsert gap fingerprint (count distinct runs; same-run retries do not increment).
2. Insert workflow feedback `status=detected`.
3. Insert supplemental `collection_request` (requiredEvidence includes binding/format normalization).
4. Record deterministic evaluation on the run experience (`decision=late_evidence_gap_detected`).
5. Do **not** invent typed procedural rules.

---

## 5. APIs

| Method | Path | Behavior |
|---|---|---|
| `GET` | `/v1/workflow-feedback/:id` | Event DTO |
| `GET` | `/v1/analysis-runs/:runId/workflow-feedback` | List for run |
| `POST` | `/v1/workflow-feedback/:id/resolve` | RT resolution: action + optional package IDs → `resolution_proposed` / `supplemental_attached` |
| `GET` | `/v1/gap-fingerprints/:fingerprintId` | Fingerprint + counts (project warning when ≥ threshold) |

Config: `MAA_GAP_PROJECT_WARNING_THRESHOLD=2`, `MAA_GAP_CROSS_PROJECT_PROMOTION_THRESHOLD=2`.

---

## 6. Revision linkage

When `POST .../revise` includes `workflowFeedbackId` (optional) or packages that match a pending feedback’s supplemental ids:

- Set feedback `revision_run_id`, status `revision_in_progress`.
- On `finalizeRevision`: compute `resolution_quality` (full/partial/ineffective), `addedDurationMs` / cost / rounds; status `resolved` or `partially_resolved`; `candidateLessonStatus=none` for first episodic event.

---

## 7. Tests (UAT Phase B)

1. Ready pricing package with prices+format but **no binding** → analysis completes/partial → feedback `detected` + collection request.
2. RT `resolve` with `supplemental_collection` + package → status advances.
3. Revise with supplemental → feedback `resolved`/`partially_resolved` + quality fields.
4. Same fingerprint second detect same project increments run count; one-off does not activate a rule.
5. Gates green.

---

## 8. Acceptance

N3 exit: late-gap detect → RT resolve → revise → resolution quality recorded; episodic only.
