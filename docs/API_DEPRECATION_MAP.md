# API and Client Compatibility / Deprecation Map

**Milestone:** N0  
**Status:** Binding  
**Compat label:** `2026.07` (emitted as `x-maa-api-compat` starting N1)

---

## 1. Compatibility rules

| Rule | Detail |
|---|---|
| Additive first | New optional JSON fields; new `/v1/...` routes |
| Compat header | N1+ responses include `x-maa-api-compat: 2026.07` |
| Client package | `@maa/client` documents `minServerVersion` / required compat label per method |
| Breaking change | New path or major bump + deprecation window ≥ one milestone |
| Auth | Unchanged: Bearer / `x-api-key` when configured; `/health` `/ready` public |

---

## 2. Endpoint stability (current → N7)

| Surface | N0 status | Plan |
|---|---|---|
| `/health`, `/ready`, `/metrics` | Stable | Keep; metrics may gain fields |
| `/v1/projects`, evidence packages, analysis-requests/runs | Stable | Keep |
| Findings, revise, reviews | Stable | Keep; dual-write evaluations N1+ |
| Memory, governance, wiki, admin/ops | Stable | Keep; backup manifest fields expand N1 |
| `/v1/analysis-runs/:id/outcome-review` | Stable (human judgment) | Keep forever; parallel to N5 `outcome_events` |
| Evidence plans / plan review | Absent | **Add N2** |
| Workflow feedback | Absent | **Add N3** |
| Outcomes / reassess | Absent | **Add N5** |
| Experience/evaluation GET | Absent | **Add N1** |

---

## 3. `propose_memory_update` deprecation map

**Verified:** Present on public `OperationType` allowlist (`packages/contracts/src/enums.ts`).  
**Assumption:** Not a fully productized standalone workflow; reusable memory uses `/v1/memory-proposals`.

| Stage | Milestone | Server behavior | Client / RT behavior |
|---|---|---|---|
| **Document** | N0 | Listed here as deprecated | Do not start new integrations on this op |
| **Warn** | N1 | If request uses op: respond with headers `Deprecation: true` and `Sunset: <ISO date ≥ N7 target>`; body may include `warning` in metadata if 2xx/4xx path exists. Prefer `UNSUPPORTED_OPERATION` if op was never executable end-to-end | Log deprecation; use `/v1/memory-proposals` |
| **Hide** | N6 | Omit from `GET /v1/capabilities` supportedOperations unless `X-Maa-Allow-Deprecated: propose_memory_update` | Remove from examples |
| **Remove public** | N7 | Remove from public `OperationType` Zod allowlist → `UNSUPPORTED_OPERATION` before model call | — |

**N6 status:** Hide stage shipped (service ≥ 0.16.0).  
**N7 status:** Remove-public stage **shipped** (service ≥ 0.17.0). Direct POST → `UNSUPPORTED_OPERATION` before model; capability advertisement never restores the op.

**Replacement:** `POST /v1/memory-proposals` + governor review APIs (already present).

---

## 4. Planned additive APIs (non-breaking)

| Milestone | APIs |
|---|---|
| N1 | `GET /v1/analysis-runs/:runId/experience`, `GET /v1/experiences/:id/evaluations`; `x-maa-api-compat` |
| N2 | `POST/GET /v1/evidence-plans`, reviews; `operation=review_evidence_plan` |
| N3 | `GET/POST /v1/workflow-feedback...` |
| N4 | Procedural version/activation admin APIs (governor) |
| N5 | `POST/GET /v1/outcomes`, `POST .../reassess` |
| N6 | Comparative analysis completion; capability advertisement cleanup |

---

## 5. Error contract stability

Keep `ErrorResponse` shape. New machine codes (examples) introduced additively:

- `UNAUTHORIZED` / `FORBIDDEN` (already in M10)
- Future: collector snapshot hash mismatch may reuse `EVIDENCE_PROVENANCE_INVALID` or `VALIDATION_ERROR`

Do not repurpose existing code meanings.
