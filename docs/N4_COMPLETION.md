# N4 Completion — Typed Procedural Prevention

**Status:** Complete  
**Service version:** `0.14.0`  
**Database schema:** `0012`  
**API compat label:** `2026.07`  
**Date:** 2026-07-28

---

## Delivered

| Area | Evidence |
|---|---|
| Append-only registry | `procedural_rule_definitions` / `_versions` / `_activations` |
| Bridge | Seeded active `require_direct_customer_evidence` v1 (`prver_rdce_v1`) |
| Propose → replay → approve → activate | Typed procedural APIs under `/v1/typed-procedural-*` |
| Prevention | Active `require_format_normalization_for_pricing` blocks pricing at readiness when binding missing |
| Late-gap skip | N3 detect skipped when readiness already blocked pricing for binding |
| Free-form freeze | Legacy `procedural_rules` remain prompt-only; no runtime `requireDirectCustomerEvidence` from free-form |
| Rollback | New activation `action=rollback` referencing prior `version_id` |

---

## UAT Phase C

Propose/replay/approve/activate format-normalization → missing-binding package → readiness `allowedOutputLevel=none` on pricing, **no** late workflow feedback → activate v2 → rollback to v1.

---

## Explicit non-goals (deferred)

- N5 outcomes / reassess
- Auto-promotion of reusable memory
- Removing free-form `procedural_rules` rows

---

## Test evidence

- `apps/server/src/n4.typed-procedural.test.ts` — UAT Phase C
- Full suite + typecheck + build + e2e at ship (**125** unit/api tests)

---

## Next

**N5** — outcomes / reassess loop.
