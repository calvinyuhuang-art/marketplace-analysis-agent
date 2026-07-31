# N1 Implementation Plan — Contracts + Experience/Evaluation Capture

**Status:** Accepted and implemented (see `docs/N1_COMPLETION.md`)  
**Depends on:** N0 freeze docs (`COMPATIBILITY_MAP`, `N0_ARCHITECTURE_DECISIONS`, `API_DEPRECATION_MAP`)

---

## 1. Objective

Ship framework-neutral `@maa/agent-memory-contracts` and persist **one experience per run attempt** plus append-only **evaluations**, with **one-directional** legacy → evaluation dual-write. Expand backup manifest metadata and restore checks. Emit API compat + deprecation headers. **No** evidence-plan APIs, workflow-feedback persistence, or typed procedural activation.

---

## 2. Explicit non-goals

- Migration work for plans / feedback / outcomes / procedural registry (N2–N5)
- Changing readiness or analysis semantics
- Bidirectional sync with `learning_events`
- Auto-promotion of reusable memory
- Embedding / fine-tuning
- Hard split of request-status vs run-phase enums

---

## 3. Package: `@maa/agent-memory-contracts`

**Path:** `packages/agent-memory-contracts/`  
**Deps:** `zod` only (no Express, no DB).

| File | Contents |
|---|---|
| `src/authority.ts` | Authority enum aligned with `memory.ts` (+ document `expired`) |
| `src/scope.ts` | Scope dimensions Zod object |
| `src/experience.ts` | Experience statuses, Capture/Complete schemas, ExperienceRef |
| `src/evaluation.ts` | Evaluator types, RecordEvaluation, **`sourceSystem`**, **`sourceRecordId`**, idempotency helper types |
| `src/workflow-feedback.ts` | Full event + lifecycle enums (**contract only**; no DB in N1) |
| `src/outcome.ts` | Outcome + reassessment envelopes (**contract only**) |
| `src/retrieval.ts` | RetrievalRequest, bundle, usage assessment |
| `src/gap-fingerprint.ts` | Component list + `gap_fingerprint_version` |
| `src/procedural.ts` | Stub types for definition/version/activation (**contract only**) |
| `src/collector-snapshot.ts` | Snapshot JSON schema + hash helper interface types |
| `src/index.ts` | Re-exports |

Wire into `pnpm-workspace`, `tsconfig` paths, `vitest.workspace` aliases.  
`@maa/contracts` may re-export HTTP-facing subsets; memory contracts remain source of truth for learning shapes.

**Unit tests:** schema parse/reject; evaluation idempotency key serialization stable.

---

## 4. Migration `0009_experiences.sql`

```text
agent_experiences
  experience_id TEXT PK
  project_id, request_id, run_id UNIQUE
  attempt INTEGER
  correlation_id
  operation, capability_key, capability_version
  status TEXT  -- started|completed|failed|cancelled
  evidence_package_ids_json
  context_assembly_id NULL
  input_artifact_ids_json
  output_artifact_id NULL
  token_input, token_output, cost_usd
  summary TEXT
  provenance_incomplete INTEGER DEFAULT 0
  started_at, completed_at NULL, created_at, updated_at

agent_evaluations
  evaluation_id TEXT PK
  experience_id FK
  evaluator_type TEXT
  rubric_version TEXT
  decision TEXT
  scores_json
  confidence REAL
  feedback_artifact_id NULL
  source_system TEXT NOT NULL
  source_record_id TEXT NOT NULL
  created_at
  UNIQUE(experience_id, evaluator_type, rubric_version, source_system, source_record_id)
```

Indexes: project, run, experience, source `(source_system, source_record_id)`.

---

## 5. Runtime wiring

| Hook | Action |
|---|---|
| Run accepted / execution claimed | `upsert` experience `started` (idempotent on `run_id`) |
| Run terminal | Complete experience with output refs, tokens, cost, status |
| Deterministic quality/readiness gate | Evaluation `evaluator_type=deterministic`, `sourceSystem=maa.deterministic` |
| Finding review / run review / learning_event insert | Dual-write evaluation with `sourceSystem` + `sourceRecordId`; **never** reverse |
| Cancel / fail | Experience terminal status |

**Duplicate prevention:** second complete on same `run_id` is no-op/update-safe without forking rows.

**Experience lifecycle:** as frozen in the approved plan (1:1 run attempt; evaluations append-only).

---

## 6. API / headers

| Change | Detail |
|---|---|
| `GET /v1/analysis-runs/:runId/experience` | 200 experience DTO |
| `GET /v1/experiences/:experienceId/evaluations` | 200 list |
| All `/v1/*` responses | `x-maa-api-compat: 2026.07` |
| `propose_memory_update` | Warn stage: `Deprecation: true` + `Sunset` (see API map) |

Client: `getRunExperience`, `listExperienceEvaluations`; pass through compat header logging.

---

## 7. Ops (mandatory in N1)

Update `@maa/ops` backup manifest (**envelope still `maa-backup.v1`**) to require:

- `serviceVersion`
- `databaseSchemaVersion` (max from `schema_migrations`)
- `artifactManifestVersion` (`maa-artifact-manifest.v1`)
- artifact inventory file when `--artifacts` (path → hash)

Restore:

- Reject unknown/future envelope or DB schema newer than binary
- Verify artifact hashes when present
- Apply migrations as supported
- `integrity_check` must pass

Tests: backup/restore round-trip **with `0009` applied**.

Retention: document that experience rows are DB-retained; linked artifacts follow existing retention days.

Diagnostics: experience fetch by `run_id` / `correlation_id` (via existing run GET + new routes).

---

## 8. Optional backfill CLI

`pnpm maa backfill-experiences [--dry-run]`

- Creates `raw_record` experiences for historical runs missing rows
- Maps legacy reviews → evaluations when experience exists
- Off by default; idempotent via uniques

---

## 9. Console

Run Inspector: “Experience” panel — status, IDs, evaluation list (read-only).

---

## 10. Test plan (N1)

| Case | Evidence |
|---|---|
| One run → one experience | API test |
| Duplicate complete hook → still one row | Unit/API |
| Legacy finding reject → one evaluation; no loop creating extra learning_events from that evaluation | API |
| Idempotent dual-write replay | API |
| Project isolation on experience listing (if list API added; else via run scoping) | API |
| Backup manifest fields present; restore rejects future `databaseSchemaVersion` | Ops unit |
| Integrity after migrate | Ops |
| `propose_memory_update` sets deprecation headers when exercised | API |
| typecheck / full test / build / e2e green | Gates |

---

## 11. Files likely touched

```text
packages/agent-memory-contracts/**          (new)
migrations/0009_experiences.sql             (new)
packages/database/src/*experience*          (new repos)
packages/agent-core/src/fake-workflow.ts    (hooks)
packages/learning/src/service.ts            (dual-write out only)
packages/contracts (re-exports, deprecation helpers)
apps/server/src/routes/*                    (GET + headers middleware)
packages/ops/src/backup.ts                  (manifest + restore rules)
packages/client/src/*                       (GET helpers)
apps/console/src/pages/RunInspector.tsx
docs/SALES_OS_INTEGRATION.md                (N1 note: experiences)
vitest.workspace.ts / tsconfig.json / package.json
```

---

## 12. Acceptance criteria

1. `@maa/agent-memory-contracts` builds and unit-tests pass; workflow-feedback/outcome/procedural/snapshot schemas exist but are unused by DB.
2. New analysis run creates exactly one `agent_experience`.
3. At least one deterministic `agent_evaluation` with `sourceSystem` + `sourceRecordId`.
4. Legacy review dual-write cannot loop.
5. Backup includes `databaseSchemaVersion`, `serviceVersion`, `artifactManifestVersion`; restore path enforces reject/verify/migrate/integrity.
6. Compat + deprecation headers behave as specified.
7. No evidence-plan or feedback tables.

---

## 13. Rollback

Stop dual-write hooks; keep `0009` tables (additive). Clients ignore new GET routes.

---

## 14. Stop / human gate

```text
After implementation PR:
  - N1_COMPLETION.md with test evidence
  - Do not start N2 until N1 accepted
```

**Human decisions still open before coding N1:**

1. Accept this N1 plan as written  
2. Confirm Sunset date for `propose_memory_update` (proposal: 90 days from N1 ship or next minor after N7 schedule)  
3. Confirm backfill CLI ships in N1 vs deferred  
