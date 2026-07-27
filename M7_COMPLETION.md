# M7 Completion Report — Reusable Category Memory and Governance

**Milestone:** M7  
**Status:** Complete (pending your acceptance)  
**Service version:** 0.7.0  
**Date:** 2026-07-26

## Objective

Allow validated knowledge to compound across projects under explicit approval — without leaking project memory.

## What shipped

| Area | Deliverable |
|---|---|
| Contracts | `packages/contracts/src/governance.ts` — proposals, conflicts, review actions |
| DB | `migrations/0007_reusable_memory.sql` — `memory_proposals` |
| Package | `MemoryGovernorService` + conflict detection in `@maa/memory` |
| Retrieval | Cross-project `reusable_approved` recall by category/platform scope; stale exclusion |
| API | `POST/GET /v1/memory-proposals`, review, `GET /v1/reusable-memory` |
| Console | Memory Governor (`/memory-governor`) |

## Acceptance

| Criterion | Result |
|---|---|
| Project memory cannot leak across projects unless approved reusable | Pass |
| Proposal shows evidence, scope, confidence, and conflicts | Pass |
| Approval creates versioned active reusable memory | Pass (`reusable_semantic` / `reusable_approved`) |
| Rejection remains auditable | Pass (status + reviewNotes retained) |
| Stale reusable knowledge warned or excluded | Pass (`omitReason` includes stale) |
| Conflicting knowledge surfaced, not overwritten | Pass (conflicts on proposal; prior memory kept) |
| Second project retrieves only compatible approved knowledge | Pass (`proj_m7_coloring_b` assembly) |
| Analysis acceptance does not approve memory | Pass (outcome review creates no proposal) |

## Gates

```
pnpm typecheck  → pass
pnpm test       → 24 files / 79 tests pass
pnpm build      → pass
pnpm test:e2e   → 3 pass
```

## Explicit non-goals held

No wiki compiler / lint engine (M8).
