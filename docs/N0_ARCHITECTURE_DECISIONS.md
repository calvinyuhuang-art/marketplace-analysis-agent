# N0 Architecture Decisions

**Milestone:** N0  
**Status:** Binding  
**Date:** 2026-07-28

Companion to [`COMPATIBILITY_MAP.md`](./COMPATIBILITY_MAP.md).

---

## 1. Immutable procedural-rule versioning

### Decision

Do **not** mutate a single `procedural_rules` row to represent new policy behavior.

Use an append-only versioned structure (implemented in **N4**; contracted in N1 stubs):

```text
procedural_rule_definitions   (stable rule_id, rule_type, title, created_at)
procedural_rule_versions      (version_id, rule_id, version_number, params_json,
                               policy_hash, created_at, created_by,
                               replay_report_artifact_id, immutable)
procedural_rule_activations   (activation_id, version_id, action:
                               stage|activate|retire|rollback,
                               actor_id, reason, created_at,
                               replaces_activation_id?)
```

Equivalent shapes are acceptable if they preserve:

1. Immutable version rows (no UPDATE of `params_json` after insert).
2. Activation/rollback events that **reference** `version_id`.
3. Runtime binds only to the currently active `version_id` for a `rule_type` + scope.

### Legacy bridge

- Existing `procedural_rules` free-text rows remain readable.
- `requireDirectCustomerEvidence = 1` becomes the first typed version of
  `require_direct_customer_evidence` during N4 migration (copy, do not mutate meaning silently).
- Free-form `statement` **never** becomes a runtime validator.

### Activation gate

```text
proposed version
  → human approval
  → historical replay + regression fixtures
  → stage (optional)
  → activate (references version_id)
  → rollback = activate prior version_id (new activation event)
```

---

## 2. Evidence-plan / collector capability-snapshot lineage

### Decision

Every collector capability snapshot is an **immutable artifact**:

| Field | Requirement |
|---|---|
| `artifactId` | `art_…` in `artifacts` table |
| `schemaVersion` | e.g. `maa.collector_capability_snapshot.v1` |
| `collector` | string |
| `collectorVersion` | string |
| `capturedAt` | ISO-8601 |
| `contentHash` | SHA-256 of canonical JSON bytes |
| MIME | `application/json` |
| accessClass | `internal` |

Evidence plans store `collector_capability_snapshot_artifact_id` (and hash echo).

Evidence-plan **reviews** must pin:

- `plan_id` + `plan_version`
- `collector_capability_snapshot_artifact_id`
- `collector_capability_snapshot_hash` (must match artifact hash at review time)

If the snapshot artifact is missing or hash mismatches → review fails closed (`VALIDATION_ERROR` / `EVIDENCE_PROVENANCE_INVALID`), **no model call**.

### Snapshot body (minimum)

```json
{
  "schema_version": "maa.collector_capability_snapshot.v1",
  "collector": "mcec",
  "collector_version": "1.0.0",
  "captured_at": "2026-07-28T12:00:00.000Z",
  "supported_evidence_types": ["listing", "review", "search_result"],
  "supported_fields": {
    "listing": ["price", "binding", "format", "page_count", "title"],
    "review": ["review_text", "rating", "review_date"]
  },
  "limits": {
    "max_items": 5000
  }
}
```

Plans may request fields the snapshot claims to support; N2 deterministic review checks **claim vs plan**, not collection quality.

---

## 3. Backup and schema-versioning

### Decision

Envelope remains **`maa-backup.v1`**, but every backup **must** record separately:

| Manifest field | Meaning |
|---|---|
| `schemaVersion` | Envelope: always `maa-backup.v1` |
| `serviceVersion` | MAA service semver (e.g. `0.10.0`) |
| `databaseSchemaVersion` | Highest applied migration version from `schema_migrations` (e.g. `0008`) |
| `artifactManifestVersion` | Version of the artifact inventory format inside the backup (start `maa-artifact-manifest.v1`) |

Optional but recommended: `integrity` (existing), `notes`.

### Restore rules (binding for N1+ ops updates)

1. Reject backups whose `schemaVersion` is unknown/future relative to the running binary.
2. Reject if `databaseSchemaVersion` is newer than migrations known to the binary.
3. Verify artifact files against the artifact manifest hashes when artifacts are included.
4. Restore DB file → run supported migrations forward as needed → `PRAGMA integrity_check` must pass.
5. Fail closed on integrity failure (do not mark restore OK).

N0 does not change runtime backup code; N1 must implement the expanded manifest fields and restore checks as part of ops hygiene.

---

## 4. Updated governing UAT sequence (pricing late-gap)

**Correction:** The evidence plan **must request** `binding` and `format`. The collector capability snapshot **must claim support** for those fields. The late gap arises because **collected values** are incomplete, inconsistent, or cannot be normalized — **not** because N2 plan review omitted required fields.

### Phase A — N2 (plan review)

1. Register collector capability snapshot artifact (claims listing fields include `price`, `binding`, `format`, `page_count`).
2. Submit evidence plan requesting pricing analysis and required fields including `binding` and `format`.
3. `review_evidence_plan` returns suitable / suitable_with_corrections **without** blocking on missing format fields (they are requested and claimed supportable).
4. Deterministic failures still apply for true plan defects (budget, unknown capability, fields **not** in snapshot).
5. Experience + evaluation recorded for the plan-review run.

### Phase B — N3 (late gap + supplemental loop) — completes the operational loop

6. Collection returns package where format/binding are missing, mixed without segmentation, or contradictory → readiness may still allow pricing to start (or partial).
7. During pricing analysis, MAA detects inability to normalize → structured insufficiency + `workflow_feedback_event` (`detected`) + collection request.
8. Research Team posts resolution (`supplemental_collection`) + supplemental package IDs (API only).
9. MAA revises; updates feedback to `resolved` / `partially_resolved` with `resolution_quality`, duration/cost/rounds.
10. Gap fingerprint recorded; **one** event → episodic only (no typed rule).
11. Optional: second **distinct project** later for promotion eligibility (not required to “complete” N3 loop).

**N3 exit criterion:** Late-gap detect → RT resolve → revise → resolution quality recorded; one-off does not activate runtime rule.

### Phase C — N4 (learning and prevention) — completes full UAT

12. Cross-project (or configured) support threshold met → typed procedural version proposed: `require_format_normalization_for_pricing`.
13. Human approval + historical replay + regression fixtures.
14. Activate immutable `version_id`.
15. **Next** similar plan/readiness/analysis detects format-normalization risk **earlier** (readiness/quality gate), before deep unsupported pricing synthesis.
16. Rollback test references prior `version_id`.

**N4 exit criterion:** Typed rule active; prevention demonstrated; free-form lessons cannot bind runtime.

---

## 5. Gap-recurrence thresholds (restated)

| Level | Default | Counts as support when |
|---|---|---|
| Episodic | 1 event | Distinct `workflow_feedback_id` |
| Project warning | ≥2 in one `project_id` | Distinct `run_id`s; same fingerprint version |
| Broader procedural eligibility | ≥2 projects | Distinct projects + runs |
| Non-counting | — | Retries, duplicate detects, same-run echoes |

Config keys (proposed for N3):  
`MAA_GAP_PROJECT_WARNING_THRESHOLD=2`,  
`MAA_GAP_CROSS_PROJECT_PROMOTION_THRESHOLD=2`.
