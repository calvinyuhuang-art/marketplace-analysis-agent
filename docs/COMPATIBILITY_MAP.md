# N0 Compatibility Map — Canonical vs Legacy

**Milestone:** N0 (documentation / compatibility freeze)  
**Status:** Binding for N1–N7  
**Date:** 2026-07-28  
**Service baseline:** 0.10.0 (migrations `0001`–`0008`)  
**Authorities:** Design Spec v0.3 + Learning Architecture v0.2 + approved N0–N7 plan amendments

This document freezes how existing MAA tables and APIs map to v0.3 canonical
concepts. **No migration `0009` and no N1 runtime code ship in N0.**

---

## 1. Ownership summary

| Layer | Role |
|---|---|
| **Canonical (target)** | Experience / evaluation / workflow-feedback / outcome-event / typed procedural-version / evidence-plan models introduced N1–N5 |
| **Legacy (retained)** | Pre-N1 tables that remain readable and, where noted, writable for compatibility |
| **Projection** | Wiki, FTS indexes, console views |

**Rule:** New product logic prefers canonical tables. Legacy writes that represent
human/orchestrator decisions may continue, but must **project one-way into**
canonical evaluations (N1+). Canonical writes must **never** synthesize legacy
`learning_events` that then re-enter the evaluation path.

---

## 2. Final compatibility map

| Existing record | Canonical concept | Ownership | Disposition |
|---|---|---|---|
| `analysis_projects` | Project context | Canonical runtime | **Remain** |
| `analysis_requests` / `analysis_runs` / `run_events` | Execution spine; experience anchors on run attempt | Canonical runtime | **Remain**; experiences reference `run_id` |
| `execution_locks` / `idempotency_records` | Durable execution | Canonical runtime | **Remain** |
| `artifacts` | Immutable blobs (prompts, outputs, collector snapshots, replay reports) | Canonical | **Remain**; N2+ pins collector snapshots here |
| `audit_events` | Append-only audit | Canonical | **Remain** |
| `settings_model_profiles` | Provider profiles | Canonical | **Remain** |
| `evidence_packages` / `evidence_items` / links | Evidence packages | Canonical | **Remain** |
| `collection_requests` | Supplemental asks | Canonical | **Remain**; N3 links to workflow feedback |
| `run_readiness` | Readiness evaluations | Canonical | **Remain** |
| `analysis_findings` / `analysis_outputs` / `model_calls` | Findings & outputs | Canonical | **Remain**; experience graph children |
| `finding_reviews` / `run_reviews` | Human decisions | **Legacy decision source** | **Remain**; N1+ emit canonical `agent_evaluations` |
| `learning_events` | Thin decision audit (not full experiences) | **Legacy** | **Remain** through N6; one-way → evaluations; deprecate as primary write API after N6 |
| `revision_diffs` | Revision lineage artifact metadata | Canonical | **Remain** |
| `outcome_reviews` | Human judgment on analysis quality | **Legacy / parallel** | **Remain forever**; distinct from market `outcome_events` (N5) |
| `lesson_candidates` | Lesson candidates | Canonical (evolving) | **Remain**; N3+ also from gap fingerprints |
| `error_book_entries` | Negative memory | Canonical | **Remain**; link experiences + fingerprints |
| `procedural_rules` (free-text `statement`) | Legacy procedural proposals | **Legacy** | **Remain** rows; N4+ no new runtime binding; migrate to typed versions or retire |
| `procedural_rules.requireDirectCustomerEvidence` | Seed typed behavior | Bridge | N4 maps into immutable typed version `require_direct_customer_evidence` |
| `memory_evaluations` | Evaluation of a *memory item* | Canonical (memory domain) | **Remain**; not interchangeable with experience evaluations |
| `memory_items` / `memory_scopes` / links / versions | Memory store | Canonical | **Remain**; authority includes MAA extension `expired` |
| `memory_proposals` | Reusable promotion | Canonical | **Remain** |
| `context_assemblies` / `memory_retrieval_events` / `memory_usage_events` | Retrieval traces | Canonical | **Remain**; described by agent-memory-contracts in N1 |
| Wiki tables (`0008`) | Projection of approved memory | Projection | **Remain** |
| *(missing)* `agent_experiences` / `agent_evaluations` | Experience lifecycle | Canonical | **N1** |
| *(missing)* `evidence_plans` / `evidence_plan_reviews` | Plan review | Canonical | **N2** |
| *(missing)* `workflow_feedback_events` / `gap_fingerprints` | Late-gap learning | Canonical | **N3** |
| *(missing)* typed procedural definitions/versions/activations | Governed runtime rules | Canonical | **N4** |
| *(missing)* `outcome_events` | Real-world outcomes | Canonical | **N5** |

---

## 3. Canonical versus legacy table ownership

### Canonical write owners (N1+)

| Table / concept | Written by |
|---|---|
| `agent_experiences` | Durable workflow hooks only |
| `agent_evaluations` | Deterministic gates, model graders (optional), adapters from legacy reviews, RT/human APIs, outcome reassessment |
| `evidence_plans` / reviews | N2 APIs |
| `workflow_feedback_events` | N3 MAA detect + RT resolve + MAA post-revision update |
| Typed procedural definition/version/activation | N4 governor + replay pipeline |
| `outcome_events` | N5 ingest API |

### Legacy write owners (continue)

| Table | Who may write | Notes |
|---|---|---|
| `learning_events` | Existing revision / finding-review paths | May continue for audit UX; each insert **also** creates canonical evaluation (N1+) |
| `finding_reviews` / `run_reviews` | Review APIs | Same one-way projection |
| `outcome_reviews` | `/v1/analysis-runs/:runId/outcome-review` | Human quality judgment only |
| Free-text `procedural_rules` | Learning service until N4 freezes creation | Cannot gain new runtime effects after N4 registry ships |

### Forbidden

- Canonical `agent_evaluations` **must not** insert `learning_events` (or any legacy row that would re-trigger evaluation creation).
- Backfill jobs must not invent reusable-approved memory from historical outputs.

---

## 4. One-directional dual-write rules (binding)

```text
Legacy decision record created
  → create or upsert agent_evaluation
  → stop

agent_evaluation created
  → MUST NOT create learning_events / finding_reviews / run_reviews
```

### Evaluation identity (N1 contract; documented now)

Every evaluation carries:

| Field | Purpose |
|---|---|
| `sourceSystem` | `maa.learning_events` \| `maa.finding_reviews` \| `maa.run_reviews` \| `maa.outcome_reviews` \| `maa.deterministic` \| `maa.model` \| `research_team` \| `maa.outcome_reassess` \| … |
| `sourceRecordId` | Stable ID of the originating row or gate result |

**Idempotency key (unique):**

```text
(experience_id, evaluator_type, rubric_version, sourceSystem, sourceRecordId)
```

Retries and dual-write replays must no-op on conflict.

### Dual-write timeline

| Milestone | Behavior |
|---|---|
| N0 | Rules frozen (this doc) |
| N1–N6 | Legacy → evaluation dual-write active |
| N6+ | Prefer canonical evaluation APIs for new integrations |
| N7 | Legacy `learning_events` write path deprecated for new callers; table retained read-only for history |

---

## 5. Historical backfill policy

| Source | Backfill action | Authority / confidence |
|---|---|---|
| Historical `analysis_runs` | Optional N1 job → `agent_experiences` | `raw_record`; confidence low if artifacts incomplete |
| Historical `learning_events` / reviews | Optional → `agent_evaluations` linked when experience exists | Preserve `sourceSystem` + `sourceRecordId` |
| Historical outputs / findings | **Do not** auto-promote to `reusable_approved` | Remain project artifacts |
| Historical free-text procedural rules | Inventory in N4; map only if expressible as typed `rule_type` | Else `retired` / display-only |
| Missing provenance | Mark `provenanceIncomplete=true`; exclude from promotion eligibility | — |

Backfill is **offline / CLI**, idempotent, and off by default in production profiles.

---

## 6. Gap-recurrence counting (binding amendment)

Configurable thresholds (env / settings; defaults below):

| Support level | Default rule | Effect |
|---|---|---|
| Episodic | 1 distinct supporting event | Experience + optional lesson candidate; **no** procedural proposal |
| Project warning | ≥2 events **same project**, distinct runs | Project-scoped warning memory / Error Book recurrence; **not** product-type rule |
| Cross-project procedural eligibility | ≥2 projects (configurable) with distinct runs | May propose **typed** procedural version (N4); still requires human + replay |
| Exclusions | Same `run_id` retries, duplicate detects, resolve/revise echoes | **Do not** count as independent support |

Fingerprint algorithm version (`gap_fingerprint_version`) is part of the grouping key.

---

## 7. Related N0 decision docs

| Topic | Document |
|---|---|
| Immutable procedural versioning | [`N0_ARCHITECTURE_DECISIONS.md`](./N0_ARCHITECTURE_DECISIONS.md) §1 |
| Collector snapshot lineage | same §2 |
| Backup / schema versioning | same §3 |
| Governing UAT sequence | same §4 |
| API + `propose_memory_update` deprecation | [`API_DEPRECATION_MAP.md`](./API_DEPRECATION_MAP.md) |
| Precise N1 plan | [`N1_IMPLEMENTATION_PLAN.md`](./N1_IMPLEMENTATION_PLAN.md) |

---

## 8. N0 acceptance checklist

- [x] Compatibility map frozen
- [x] Canonical vs legacy ownership stated
- [x] One-directional dual-write + idempotency fields defined
- [x] Historical backfill policy defined
- [x] Gap-recurrence scope-aware rules defined
- [x] Cross-links to procedural, snapshot, backup, UAT, API deprecation
- [x] No migration `0009` / no N1 runtime in this milestone
