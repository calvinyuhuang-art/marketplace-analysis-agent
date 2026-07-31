# N2 Implementation Plan — Evidence Plans + Plan Review

**Status:** Accepted (continue after N1)  
**Depends on:** N1 (`0009`, experiences/evaluations, artifact store)  
**Service target:** `0.12.0` · schema `0010`

---

## 1. Objective

Ship **immutable collector capability snapshots**, **versioned evidence plans**, and **deterministic** `review_evidence_plan` that checks **plan vs claimed collector support** (not collection quality). Pin snapshot artifact id + hash on reviews; fail closed on missing/mismatched hash. Record experience + evaluation for the plan-review run.

---

## 2. Explicit non-goals

- Workflow feedback / late-gap loop (N3)
- Typed procedural rules (N4)
- Changing readiness scoring of collected evidence packages
- Model-based plan review
- Blocking plans that request fields the snapshot claims to support (governing UAT)

---

## 3. Data model (`0010_evidence_plans.sql`)

```text
evidence_plans
  plan_id + plan_version PK
  project_id, client
  status: draft|submitted|reviewed
  requested_analysis_json
  required_fields_json   -- { "listing": ["price","binding","format"], ... }
  budget_json NULL
  capability_json        -- platform/marketplace/category/productType
  collector_capability_snapshot_artifact_id
  collector_capability_snapshot_hash
  notes NULL
  created_at, updated_at

evidence_plan_reviews
  review_id PK
  plan_id, plan_version
  run_id NULL            -- plan-review analysis run
  decision: suitable|suitable_with_corrections|unsuitable
  collector_capability_snapshot_artifact_id
  collector_capability_snapshot_hash
  report_json
  report_artifact_id NULL
  created_at
```

---

## 4. APIs

| Method | Path | Behavior |
|---|---|---|
| `POST` | `/v1/collector-capability-snapshots` | Validate body → write immutable artifact → return `{ artifactId, contentHash, … }` |
| `POST` | `/v1/evidence-plans` | Create plan v1 pinning snapshot id+hash |
| `GET` | `/v1/evidence-plans/:planId` | Latest version (optional `?version=`) |
| `POST` | `/v1/evidence-plans/:planId/review` | Create `review_evidence_plan` run; worker reviews deterministically |
| — | `operation=review_evidence_plan` | Added to `OperationType` + capability allowlist |

`CreateAnalysisRequest`: for `review_evidence_plan`, require `evidencePlanId`; `evidencePackageIds` may be empty.

---

## 5. Deterministic review rules

Fail closed / `unsuitable` when:

- Snapshot artifact missing or content hash ≠ plan’s stored hash / review pin
- Snapshot schema invalid
- Requested evidence type unknown to snapshot
- Required field not in snapshot `supportedFields[type]`
- Requested analysis area not in capability pack
- Budget exceeded (if both plan and snapshot declare limits)

`suitable_with_corrections`: non-blocking advisories (e.g. budget near limit, optional notes).

`suitable`: all required fields claimed; areas allowed.

**Must not fail** solely because pricing plan requests `binding`/`format` when snapshot lists them (UAT Phase A).

---

## 6. Runtime

- Worker branch for `review_evidence_plan`: skip evidence readiness/analysis model; run `EvidencePlanService.review`; complete run; experience + deterministic evaluation (`sourceSystem=maa.deterministic`).
- Dual-write unchanged (one-way).

---

## 7. Client / console / docs

- Client: register snapshot, create/get plan, review plan, poll run.
- Console: optional plan review panel or skip UI if API+tests cover UAT (prefer thin console link on Run Inspector when operation is plan review).
- Update Sales OS integration + README; `docs/N2_COMPLETION.md`.

---

## 8. Tests

| Case | Expect |
|---|---|
| Snapshot register + plan create | 201; hash echoed |
| UAT: pricing + binding/format requested & claimed | `suitable` (or corrections), not blocked |
| Field not in snapshot | `unsuitable` / fail closed |
| Hash mismatch | `EVIDENCE_PROVENANCE_INVALID` or `VALIDATION_ERROR`, no model |
| Experience + deterministic evaluation on review run | present |
| typecheck / test / build / e2e | green |

---

## 9. Acceptance

1. Collector snapshots are immutable hashed artifacts.
2. Plan reviews pin plan version + snapshot id/hash.
3. Deterministic claim-vs-plan only; governing UAT Phase A passes.
4. Experience/evaluation recorded for review run.
5. No N3 feedback tables.
