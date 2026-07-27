# M5 Completion Report — Project Memory, FTS5 Retrieval, and Context Assembly

**Milestone:** M5  
**Status:** Complete (pending your acceptance)  
**Service version:** 0.5.0  
**Date:** 2026-07-26

## Objective

Give the agent project continuity and inspectable retrieval: durable project memory, FTS5 search, ranked context assembly, and memory-aware analysis prompts.

## What shipped

| Area | Deliverable |
|---|---|
| Contracts | `packages/contracts/src/memory.ts` — memory items, scopes, authority, retrieval/assembly schemas |
| DB | `migrations/0005_memory.sql` — items, scopes, links, FTS5, versions, assemblies, retrieval/usage events |
| Package | `@maa/memory` — FTS query builder, ranking, `MemoryService.recallForRun`, finding-review upsert, working-memory save |
| Runtime | `recalling_memory` + `proposing_memory` in durable workflow; analysis receives `approvedMemory` / `failureCorrections` |
| Analysis | Prompt cites validated memory; soft coerce of common LLM shape drift; quality skips customer-evidence gate for `validated_memory` |
| API | `GET /v1/projects/:id/memory`, `.../memory-retrieval`, `.../context-assembly` |
| Console | Project Memory inspector (`/projects/:projectId/memory`); link from Run Inspector |
| Finding review | Accept → `reviewed_project`; reject → `failure_correction` (not active knowledge) |

## Acceptance

| Criterion | Result |
|---|---|
| Project memory survives restart | Pass (SQLite + migration 0005) |
| Second run retrieves accepted project findings | Pass (unit/API `m5.memory.test.ts`) |
| Rejected findings are not active knowledge | Pass (`failure_correction` only in failure-lessons section) |
| Retrieval trace explains selection/omission | Pass (retrieval events + assembly artifact) |
| Exact and phrase FTS search works | Pass (`buildFtsMatchQuery` + tests) |
| Narrow scope outranks broad scope | Pass (ranking + broad-scope penalty) |
| Token budget is enforced | Pass (assembly budget trim) |
| Output cites memory IDs used | Pass (`memoryRefs` / validated_memory) |
| Irrelevant fixture memory excluded | Pass |

## Live DeepSeek smoke (post-development)

```
pnpm exec tsx scripts/live-deepseek-smoke.ts
→ status=completed provider=deepseek model=deepseek-chat
→ model_calls=1 (analysis ok)
→ findings=5
→ LIVE_DEEPSEEK_SMOKE_OK
```

Fix applied during smoke: DeepSeek initially returned a nested `areas` shape; runner now coerces common drift and the prompt includes `requiredOutputExample`.

## Gates

```
pnpm typecheck  → pass
pnpm test       → 20 files / 75 tests pass
pnpm build      → pass
pnpm test:e2e   → 3 pass
```

## Explicit non-goals held

No Error Book, procedural-rule promotion, or reusable cross-project memory (M6/M7).
