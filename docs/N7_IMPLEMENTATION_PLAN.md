# N7 Implementation Plan — Hardening & Shared-Contract Alignment

**Status:** Complete  
**Depends on:** N0–N6 complete  
**Service target:** `0.17.0` · schema remains `0014` (no new tables)

---

## 1. Objective

Close the N0–N7 cycle: **remove public** `propose_memory_update` from the OperationType allowlist (→ `UNSUPPORTED_OPERATION` before any model call), soft-align phase display labels, confirm backup/restore covers N1–N6 tables, document `@maa/agent-memory-contracts` as the shared contract surface, and publish a capped live DeepSeek UAT checklist (manual, not CI).

---

## 2. Explicit non-goals

- Cloud / multi-tenant auth
- Embeddings / fine-tuning
- LangGraph rewrite
- New marketplaces

---

## 3. `propose_memory_update` Remove public

| Surface | Behavior |
|---|---|
| `OperationType` Zod | Value removed |
| Capability pack | Op removed from `supportedOperations` |
| `POST /v1/analysis-requests` | Unknown/removed op → `UNSUPPORTED_OPERATION` (or free-chat path) before model |
| `GET /v1/capabilities` | Already hidden; Hide header no longer restores a public op |
| Replacement | `POST /v1/memory-proposals` |

---

## 4. Soft phase aliases

Add display-label map for run phases/statuses (console + docs). Runtime status strings unchanged.

---

## 5. Contracts + client

- `@maa/agent-memory-contracts` README + export clarity
- `@maa/client` documents `minServerVersion` / compat expectations for N7

---

## 6. Backup / restore

API or unit test: migrate through `0014`, backup, restore, assert N1–N6 tables present.

---

## 7. Live DeepSeek UAT

`docs/N7_LIVE_UAT.md` — capped manual checklist (cost/time bounded). Not required for CI green.

---

## 8. Acceptance

N7 exit: public op removed; backup covers new tables; contracts documented; cycle N0–N7 complete for implemented scope.
