# M4 Completion Report — Revision and Structured Human Feedback

**Milestone:** M4  
**Status:** Complete (accepted after M3)  
**Service version:** 0.4.0  
**Date:** 2026-07-26

## Objective

Allow the Research Orchestrator or operator to correct the agent without restarting the project — via revision runs, finding supersession, reviewer timeline, and structured learning events (no promotion yet).

## What shipped

| Area | Deliverable |
|---|---|
| Contracts | `CreateRevisionRequest`, run review, learning events, revision diff schemas |
| DB | `migrations/0004_revision.sql` — `prior_run_id`, supersession columns, `learning_events`, `run_reviews`, `revision_diffs` |
| Runtime | `RevisionService` — create revision, run review, finalize supersession + diff |
| API | `POST .../revise`, `POST .../review`, `GET .../revision-diff`, `GET .../learning-events`, `GET .../reviews` |
| Console | Revise panel, prior-run link, revision diff, reviewer timeline + learning events |

## Acceptance

| Criterion | Result |
|---|---|
| Revision references prior run and findings | Pass |
| Prior output remains immutable | Pass (still GET-able after revise) |
| Supplemental evidence can satisfy prior gap | Pass (base no-reviews + supplemental complete) |
| Only affected areas may be rerun | Pass (`affectedAreas` on revision request) |
| Rejected findings preserved/marked | Pass (`reviewer_rejected` or `superseded`) |
| Clear before/after trace | Pass (`revision-diff`) |
| Feedback → structured learning event | Pass (`recorded` only; no promotion) |

## Gates

```
pnpm typecheck  → pass
pnpm test       → 17 files / 69 tests pass
pnpm build      → pass
pnpm test:e2e   → 3 pass
```

## Explicit non-goals held

No reusable memory promotion, Error Book, or cross-project learning (M5/M6).
