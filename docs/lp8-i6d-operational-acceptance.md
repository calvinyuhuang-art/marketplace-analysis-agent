# docs(lp8-i6d): MAA operational acceptance

## Scope

I6d closes live external-reference authority gaps for analysis context assembly:

- Hard filters before ranking (challenge, catalog lifecycle, cache/hash, injection, offline grace)
- `recallAnalysisContextForRun` wires `assembleExternalKnowledgeForRun` into analysis prompts
- External section is delimited and placed below reviewed local memory
- Use traces record consideration; influence remains separate; no automatic memory/rules/activation

## Identity (unchanged)

- Service: **0.21.0**
- API compatibility: **2026.07**
- Schema: **0018** (no migration in I6d)

## Verification

- `lp8I6dRetrievalRanking.test.ts` (focused)
- Full `pnpm test` regression
- Status surfaces remain API/operator (LearningPlaneStatus); Learning Control remains authoritative for shared decisions

## Architecture confirmation

Publication remains untrusted/advisory. Discovery ≠ reference ≠ adoption. LP outage does not block normal analysis.
