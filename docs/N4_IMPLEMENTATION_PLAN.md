# N4 Implementation Plan — Typed Procedural Prevention

**Status:** Accepted (continue after N3)  
**Depends on:** N3 (late-gap loop), N0 immutable versioning decision  
**Service target:** `0.14.0` · schema `0012`

---

## 1. Objective

Ship an **append-only typed procedural registry** (`definitions` / `versions` / `activations`). Bridge legacy `requireDirectCustomerEvidence` into the first typed version of `require_direct_customer_evidence`. Activate `require_format_normalization_for_pricing` after propose → replay → approve → activate. Runtime applies the active version at **readiness** so missing binding is caught **before** deep pricing synthesis. Free-form `procedural_rules.statement` never becomes a runtime validator. Rollback = new activation referencing a prior `version_id`.

---

## 2. Explicit non-goals

- N5 outcomes / reassess
- Auto-promotion of reusable memory
- Bidirectional learning sync
- Removing free-form `procedural_rules` rows (remain readable / prompt-only)

---

## 3. Data model (`0012_typed_procedural.sql`)

```text
procedural_rule_definitions
  rule_id PK, rule_type UNIQUE, title, created_at

procedural_rule_versions
  version_id PK, rule_id FK, version_number,
  params_json (immutable after insert), policy_hash,
  lifecycle_status (proposed|replayed|approved),
  replay_report_artifact_id NULL,
  approved_by/at NULL, created_by, created_at
  UNIQUE(rule_id, version_number)

procedural_rule_activations
  activation_id PK, version_id FK,
  action (stage|activate|retire|rollback),
  actor_id, reason NULL, replaces_activation_id NULL, created_at
```

Seed: definitions for `require_direct_customer_evidence` and `require_format_normalization_for_pricing`; version+activate bridge for RDCE.

---

## 4. Runtime prevention

When active `require_format_normalization_for_pricing`:

1. After base readiness evaluate, enrich **pricing** area: critical `binding` gap, `allowedOutputLevel=none`.
2. Planner skips pricing → no deep unsupported pricing synthesis.
3. Late-gap detect skips when readiness already blocked pricing for binding (prevention earlier than N3 path).

Free-form approve: prompt text only; `requireDirectCustomerEvidence` runtime flag comes **only** from active typed RDCE version.

---

## 5. APIs

| Method | Path | Behavior |
|---|---|---|
| `GET` | `/v1/typed-procedural-rules` | Definitions + active version summary |
| `POST` | `/v1/typed-procedural-rules/:ruleType/versions` | Propose immutable version |
| `POST` | `/v1/typed-procedural-versions/:versionId/replay` | Historical + fixture report artifact |
| `POST` | `/v1/typed-procedural-versions/:versionId/approve` | Human approval gate |
| `POST` | `/v1/typed-procedural-versions/:versionId/activate` | Activate (requires replayed+approved) |
| `POST` | `/v1/typed-procedural-versions/:versionId/rollback` | Rollback activation to this version |
| `GET` | `/v1/typed-procedural-versions/:versionId` | Version detail |

---

## 6. Tests (UAT Phase C)

1. Propose → replay → approve → activate `require_format_normalization_for_pricing`.
2. Missing-binding package → readiness blocks pricing; no late workflow feedback.
3. Free-form rule approve does not create prevention.
4. Rollback to prior `version_id` restores prior active binding.
5. Gates green.

---

## 7. Acceptance

N4 exit: typed rule active; prevention at readiness; free-form cannot bind runtime; rollback references prior `version_id`.
