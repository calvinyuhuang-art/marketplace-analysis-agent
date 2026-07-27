# M8 Completion Report — Governed Wiki Compiler and Linter

**Milestone:** M8  
**Status:** Complete (pending your acceptance)  
**Service version:** 0.8.0  
**Date:** 2026-07-26

## Objective

Create a human-readable marketplace wiki as a governed projection of canonical memory — with versions, reviewable patches, and lint.

## What shipped

| Area | Deliverable |
|---|---|
| Contracts | `packages/contracts/src/wiki.ts` |
| DB | `migrations/0008_wiki.sql` |
| Package | `@maa/wiki` — hierarchy seed, deterministic compile, lint, `WikiService` |
| Hook | Approving reusable memory auto-creates wiki update proposals |
| API | seed, pages, versions, proposals approve/reject, lint, rebuild |
| Console | Wiki browser + version compare + proposals (`/wiki`) |

## Acceptance

| Criterion | Result |
|---|---|
| Every substantive wiki statement links to approved memory | Pass (`[[mem:…]]` citations) |
| Rejected/expired memory cannot publish as current truth | Pass (publish validation + lint) |
| New approved memory generates a reviewable patch | Pass (governor → wiki proposals) |
| Previous page version remains accessible | Pass (`/versions`) |
| Lint detects missing provenance, stale, broken links, undisclosed contradiction | Pass |
| Wiki is rebuildable from canonical memory | Pass (`POST /v1/wiki/rebuild`) |

## Gates

```
pnpm typecheck  → pass
pnpm test       → 26 files / 82 tests pass
pnpm build      → pass
pnpm test:e2e   → 3 pass
```

## Explicit non-goals held

No Research Team client package (M9).
