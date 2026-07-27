# M10 Completion Report — Hardening and Publishability Preparation

**Milestone:** M10  
**Status:** Complete (pending your acceptance)  
**Service version:** 0.10.0  
**Date:** 2026-07-27

## Objective

Prepare for broader local use without building cloud multi-tenancy.

## What shipped

| Area | Deliverable |
|---|---|
| Auth | Local `MAA_API_KEY` via Bearer / `x-api-key`; `/health`+`/ready` public |
| Profiles | `MAA_CONFIG_PROFILE=development\|test\|local-hardened` |
| Ops package | `@maa/ops` — integrity, backup/restore, artifact retention |
| Admin API | `/v1/admin/integrity`, `/backup`, `/backups`, `/restore`, `/retention/purge`, `/config-summary` |
| CLI | `pnpm maa integrity\|backup\|restore\|retention\|release-check` |
| Metrics | Latency p50/p95, HTTP status counters, auth counters |
| Docs | `docs/THREAT_MODEL.md`, `CHANGELOG.md`, `examples/research-team-client.ts` |
| Compat | Contract parse tests for health/metrics/capabilities |

## Acceptance (build candidates)

| Candidate | Result |
|---|---|
| Local API authentication | Pass |
| Packaging and release process | Pass (`CHANGELOG`, CLI release-check, version 0.10.0) |
| Configuration profiles | Pass |
| Backup/export/import | Pass (local folder backup + restore) |
| Artifact retention | Pass (CLI + admin purge) |
| Database integrity check | Pass |
| Metrics expansion | Pass |
| Performance profiling | Pass (rolling latency window on `/metrics`) |
| Threat review | Pass (`docs/THREAT_MODEL.md`) |
| API compatibility tests | Pass |
| Documentation and examples | Pass |

## Explicit non-goals held

External authentication, cloud deployment, and multi-tenancy (separate design).

## Gates

```
pnpm typecheck  → pass
pnpm test       → 30 files / 110 tests pass
pnpm build      → pass
pnpm test:e2e   → 3 pass
```
