# M3 Completion Report — Stateless Analysis and Quality Gates

**Milestone:** M3 — Stateless Amazon KDP Analysis and Quality Gates  
**Status:** Complete (awaiting gate acceptance)  
**Service version:** 0.3.0  
**Date:** 2026-07-26

## Objective

Produce the first useful integrated analysis from a complete evidence package using the fake provider, with DeepSeek available only behind a feature flag. Persist findings, enforce deterministic quality gates, and support Finding Review in the operator console.

## What shipped

| Area | Deliverable |
|---|---|
| Contracts | Finding / AnalysisOutput / QualityReport / FindingReview schemas |
| DB | `migrations/0003_findings.sql` — findings, outputs, model_calls, finding_reviews |
| `@maa/quality` | Deterministic evidence / structural / reasoning / decision-readiness gates |
| `@maa/analysis` | Planner, prompt builders, `generateFromEvidence`, repair loop, `runStructuredAnalysis`, fake fixtures |
| `@maa/model-router` | DeepSeek provider (disabled unless `MAA_DEEPSEEK_ENABLED` + API key) |
| Runtime | Analyzing phase wired into durable workflow after readiness |
| API | `GET .../findings`, `GET .../output`, `GET .../model-calls`, `POST /v1/findings/:id/review` |
| Console | Finding Review page (one finding at a time) + link from Run Inspector |

## Acceptance criteria

| Criterion | Result |
|---|---|
| Complete evidence produces integrated structured output | Pass — M3 API test |
| Every fact has resolvable evidence references | Pass — fixture + gates |
| Unsupported customer claim fixture fails quality gate | Pass — unit (`CUSTOMER_PREFERENCE_FROM_RATING_COUNT`) |
| Incompatible-format price conclusion fails / is segmented | Pass — unit (`MIXED_FORMAT_PRICE_UNSEGMENTED`); good path segments formats |
| Invalid provider output is repaired or fails safely | Pass — repair fixture unit test |
| Live provider can be disabled completely | Pass — DeepSeek profiles disabled when flag false |
| Capped live acceptance run within budget | Deferred — requires explicit enable + API key (not run) |
| Full prompt/input/output are artifacts | Pass — model-calls expose input/output artifact IDs |
| Finding review actions persist | Pass — API + review status update |

**Explicit non-goal held:** no cross-run memory / wiki.

## Gate evidence

```
pnpm typecheck  → pass
pnpm lint       → pass
pnpm test       → 15 files, 67 tests pass
pnpm build      → server + console pass
pnpm test:e2e   → 3 tests pass (includes Finding Review navigation)
```

## Notable design choices

- Product / topic / research direction still come from the analysis request (Sales OS → Orchestrator). Amazon KDP remains a capability pack, not a hardcoded default product.
- Fake fixture `analysis.v1.from-evidence` is the default; live DeepSeek is opt-in via config and default model profile.
- Quality failures persist a rejected output artifact for inspection, then fail the run with `MODEL_OUTPUT_INVALID` (findings are not accepted).
- Optional model-assisted quality review (plan item 9) was not implemented; deterministic gates are authoritative for M3.

## Human decisions needed

1. **Accept M3?** Approve this gate before M4 (revision + structured human feedback).
2. **Live DeepSeek smoke?** If desired, set `MAA_DEEPSEEK_ENABLED=true`, provide `DEEPSEEK_API_KEY`, point `MAA_DEFAULT_MODEL_PROFILE` at a DeepSeek profile, and run one capped acceptance analysis. Not required to accept M3.
3. **Optional quality-review model call** — keep deferred to later, or pull into M4?

## Next milestone (M4)

Revision and structured human feedback: reason codes (already partially in FindingReview), revision endpoint, run linkage, supplemental evidence, supersession / diff, learning-event recording without reusable promotion.
