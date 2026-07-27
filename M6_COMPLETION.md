# M6 Completion Report — Learning from Outcomes and Error Book

**Milestone:** M6  
**Status:** Complete (pending your acceptance)  
**Service version:** 0.6.0  
**Date:** 2026-07-26

## Objective

Convert reviewed success and failure into governed lessons that change future behavior — Error Book, lesson candidates, procedural rules, recurrence, and controlled inclusion of active rules in model context.

## What shipped

| Area | Deliverable |
|---|---|
| Contracts | `packages/contracts/src/learning.ts` — outcome review, lessons, Error Book, procedural rules, memory evaluations |
| DB | `migrations/0006_learning.sql` |
| Package | `@maa/learning` — deterministic lesson extraction, `LearningService` |
| Runtime | Finding reject → lesson + Error Book + proposed rule; active rules in context assembly + analysis prompt |
| API | Error Book, lessons review, procedural-rule review, outcome review, memory evaluations |
| Console | Error Book page (`/error-book`) with lesson/rule approval |
| Regression link | `quality.gates.unsupported-customer-claim` |

## Acceptance

| Criterion | Result |
|---|---|
| Rejected unsupported customer finding → Error Book entry | Pass |
| Approved procedural rule retrieved on future run | Pass (context assembly `procedural_rules` section) |
| Future run returns collection request rather than repeating mistake | Pass (listings-without-reviews → collection requests) |
| Rule authority and scope enforced | Pass (`procedural_active` + scope filters) |
| One accepted run does not automatically become causal truth | Pass (outcome review without `proposeLesson` creates no lesson) |
| Recurrence status visible | Pass (`first_seen` → `recurring`) |
| Regression test linked to correction passes | Pass (quality gate still fails unsupported customer claim) |

## Gates

```
pnpm typecheck  → pass
pnpm test       → 22 files / 77 tests pass
pnpm build      → pass
pnpm test:e2e   → 3 pass
```

## Explicit non-goals held

No reusable cross-project memory promotion or wiki compiler (M7/M8).
