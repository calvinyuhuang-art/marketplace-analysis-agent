# N0 Completion Report — Compatibility and Contract Freeze

**Milestone:** N0  
**Status:** Complete (documentation only)  
**Date:** 2026-07-28  
**Service version:** unchanged `0.10.0` (no runtime/migration ship)

## Objective

Freeze compatibility, ownership, dual-write direction, versioning, backup, UAT, and API deprecation **before** N1 coding.

## Artifacts delivered

| Artifact | Path |
|---|---|
| Compatibility map | [`docs/COMPATIBILITY_MAP.md`](./COMPATIBILITY_MAP.md) |
| Architecture decisions | [`docs/N0_ARCHITECTURE_DECISIONS.md`](./N0_ARCHITECTURE_DECISIONS.md) |
| API / deprecation map | [`docs/API_DEPRECATION_MAP.md`](./API_DEPRECATION_MAP.md) |
| Precise N1 plan | [`docs/N1_IMPLEMENTATION_PLAN.md`](./N1_IMPLEMENTATION_PLAN.md) |
| This report | [`docs/N0_COMPLETION.md`](./N0_COMPLETION.md) |

## Binding amendments captured

1. Governing UAT: plan requests binding/format; snapshot claims support; late gap from **collected** data quality — N3 completes loop; N4 completes prevention.
2. Scope-aware gap thresholds; same-run retries do not count.
3. One-way dual-write: legacy → `agent_evaluations` only; `sourceSystem` + `sourceRecordId` in idempotency.
4. Immutable procedural versions + activation events (N4 implement).
5. Collector capability snapshots as hashed immutable artifacts; reviews pin them (N2).
6. Backup envelope `maa-backup.v1` plus separate DB schema / service / artifact-manifest versions; restore reject/verify/migrate/integrity (N1+ ops).

## Explicitly not done in N0

- Migration `0009`
- `packages/agent-memory-contracts` package scaffolding
- Any experience/evaluation runtime hooks
- Backup manifest code changes (specified only)

## Next

Human review of N0 artifacts + [`N1_IMPLEMENTATION_PLAN.md`](./N1_IMPLEMENTATION_PLAN.md).  
**Do not start N1 until that plan is accepted.**
