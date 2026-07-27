# Marketplace Analysis Agent
## Detailed Development Plan and Technical Implementation Blueprint

**Document version:** 1.0  
**Date:** July 25, 2026  
**Status:** Approved planning baseline for staged implementation  
**Primary implementation tool:** Cursor  
**Primary owner:** Product owner / operator  
**Primary consumer:** Sales OS Research Team  
**Source design:** `Marketplace_Analysis_Agent_Initial_Design.md`

---

# 1. Instructions to Cursor

This document is the implementation authority for the first development cycle of the Marketplace Analysis Agent (MAA). Read the entire document before changing code.

Cursor must follow these rules:

1. **Implement one milestone at a time.** Do not build future milestones early unless a small interface or migration placeholder is explicitly required.
2. **Do not convert the product into a free-chat agent.** Every request must map to a predefined operation, capability, input contract, workflow, and output schema.
3. **Do not give the LLM unrestricted agency.** The model cannot browse, call arbitrary URLs, run shell commands, select arbitrary tools, modify source code, or redefine its job.
4. **Keep the service standalone.** Do not couple it directly to the Sales OS or Research Team database.
5. **Use durable execution.** Long-running work continues independently of the browser connection and survives page reloads and process restarts where specified.
6. **Treat evidence as untrusted data.** Evidence text may contain instructions, prompt injection, malformed content, or irrelevant material. It must never override system or capability rules.
7. **Make behavior inspectable.** Persist state transitions, validation results, model calls, memory retrieval, quality decisions, revisions, and artifacts.
8. **Use deterministic checks whenever possible.** Do not rely on the LLM to validate facts that application code can validate.
9. **Do not silently promote memory.** Project state may be saved automatically, but reusable cross-project knowledge requires approval.
10. **Stop after each milestone.** Run all required tests, produce a concise implementation report, identify unresolved issues, and wait for milestone acceptance before proceeding.

A milestone is complete only when its acceptance criteria and quality gates pass.

---

# 2. Product Definition

The Marketplace Analysis Agent is a **standalone, local-first, constrained marketplace intelligence service**. It receives structured marketplace evidence, evaluates whether that evidence is sufficient, performs approved analysis operations, produces traceable findings, learns from reviewed outcomes through governed memory, and returns structured results through an HTTP API.

It is not:

- a general chatbot;
- a free-form research assistant;
- an autonomous browser agent;
- a collector;
- a strategy agent;
- a Sales OS orchestrator;
- a general-purpose tool runner;
- a multi-agent team in V1.

The first capability pack supports:

```text
Platform: Amazon US
Category: Books
Product specialization: Amazon KDP adult coloring books
Initial project: Lofi Rainy Day Coloring Book
```

The design must allow future capability packs without rebuilding the runtime.

---

# 3. Product Goals

## 3.1 Primary goals

The service must:

1. Convert normalized marketplace evidence into decision-ready commercial intelligence.
2. Determine evidence sufficiency before making claims.
3. Separate observed facts, source claims, remembered knowledge, inference, assumptions, contradictions, and unknowns.
4. Produce exact supplemental collection requests when evidence is insufficient.
5. Support revision using new evidence or reviewer feedback.
6. Preserve project state and validated learning across runs.
7. Learn from accepted outcomes, rejected findings, repeated failures, corrections, and successful procedures.
8. Maintain a human-readable marketplace wiki derived from governed memory.
9. Expose a stable API to Sales OS Research Team and other clients.
10. Provide complete logging, provenance, and operator inspection.

## 3.2 Success definition

The agent becomes more valuable across projects **without becoming less trustworthy**.

Improvement must be visible as:

- fewer repeated mistakes;
- better evidence-gap detection;
- more relevant retrieval;
- better calibrated confidence;
- faster revision;
- higher reviewer acceptance;
- reusable knowledge with clear scope and provenance;
- no silent conversion of uncertain conclusions into truth.

---

# 4. Non-Negotiable Boundaries

## 4.1 Allowed operations

V1 supports only these top-level operations:

| Operation | Purpose |
|---|---|
| `full_marketplace_analysis` | Integrated analysis across selected supported areas |
| `focused_analysis_question` | Answer one marketplace question mapped to one or more allowed analysis areas |
| `revise_analysis` | Revise a prior run using structured feedback, changed goal, or new evidence |
| `comparative_analysis` | Compare supported products, evidence packages, competitor sets, or prior/current market states |
| `evaluate_evidence_readiness` | Evaluate coverage without producing the full analysis |
| `propose_memory_update` | Create a governed memory proposal from reviewed outcomes; normally internal, not general user initiated |

## 4.2 Supported analysis areas

The first capability pack may support:

- `market_structure`
- `competitor_set`
- `customer_evidence`
- `pricing`
- `positioning`
- `keywords_categories`
- `format_product_expectations`
- `listing_conversion`
- `risk_ip_policy`
- `opportunity_summary`
- `evidence_sufficiency`

Every focused question must declare at least one supported analysis area. A lightweight intent classifier may assist routing, but deterministic validation must confirm that the requested area is allowed.

## 4.3 Explicitly forbidden behavior

The agent must reject requests to:

- write unrelated marketing content;
- produce social posts, ads, email, or creative assets;
- browse or scrape the web;
- call MCEC directly in V1;
- execute shell commands;
- manipulate files outside approved artifact directories;
- answer general programming or personal questions;
- perform unrestricted calculations unrelated to marketplace analysis;
- make final business strategy decisions;
- write directly into Sales OS databases;
- automatically approve reusable memory;
- change its own capability rules.

Unsupported requests return a stable error contract and do not call the model.

---

# 5. Actors and Interaction Model

## 5.1 Actors

### Client system
Usually the Sales OS Research Orchestrator. It submits evidence, creates analysis requests, polls status, supplies revisions, and retrieves outputs.

### Human research reviewer
Reviews findings, evidence use, quality, contradictions, and revisions. May be the product owner during development.

### Memory governor
Approves, rejects, supersedes, or limits reusable memory and procedural rules. Initially a human operator.

### Marketplace Analysis Agent runtime
Executes only predefined workflows and records all decisions.

## 5.2 Human interaction surface

The standalone service includes an operator console, not an open chat application.

The console provides structured forms and actions:

- select an operation;
- select project and capability;
- select analysis areas;
- provide a focused question within allowed scope;
- attach or reference evidence packages;
- inspect evidence readiness;
- inspect run phases and model calls;
- review findings one at a time;
- accept, reject, or request revision;
- provide structured correction reasons;
- inspect memories used;
- approve or reject reusable memory proposals;
- inspect the Error Book and generated wiki;
- search logs by request, run, execution, project, and correlation ID.

There must be no generic prompt box that allows arbitrary conversation.

## 5.3 Sales OS interaction

Normal production flow:

```text
Sales Brain
  -> delegates research objective
Research Orchestrator
  -> coordinates collection
Collectors such as MCEC
  -> return normalized evidence
Research Orchestrator
  -> registers evidence package with MAA
Marketplace Analysis Agent
  -> readiness, memory recall, analysis, quality review
Research Orchestrator
  -> accept, revise, or collect more evidence
Research Package
  -> Strategy Team handoff
```

The Research Orchestrator is the normal caller. Sales Brain should not manage evidence-level analysis details.

---

# 6. Recommended Technology Stack

Use a stack close to the existing Research Team to reduce cognitive overhead and encourage reuse of proven patterns.

## 6.1 Runtime and language

| Layer | Technology | Decision |
|---|---|---|
| Runtime | Node.js 24 LTS | Production baseline; pin exact patch in `.nvmrc` or equivalent |
| Language | TypeScript, strict mode | No JavaScript source files except configuration where unavoidable |
| Package manager | pnpm 11 workspace | Use `workspace:*` for internal packages |
| Module format | ESM | Use one consistent module system |

## 6.2 Server and contracts

| Layer | Technology | Decision |
|---|---|---|
| HTTP server | Express 5 | Versioned REST API and middleware |
| Validation | Zod 4 | Request, response, persisted payload, model output, config validation |
| API documentation | OpenAPI generated from canonical contracts or maintained alongside Zod | Contracts remain source-controlled and testable |
| IDs | UUIDv7 or ULID | Sortable, unique, safe for distributed clients; choose one and use everywhere |
| Time | ISO 8601 UTC in storage | Convert only at UI boundary |

## 6.3 Persistence and search

| Layer | Technology | Decision |
|---|---|---|
| Database | SQLite 3 | Local-first source of truth |
| Driver | Reuse the proven Research Team SQLite approach; otherwise `better-sqlite3` | Favor predictable transactions and direct SQL |
| Migrations | Numbered SQL migration files with migration table | No auto-generated destructive migration in production |
| Full-text search | SQLite FTS5 | Findings, memory, evidence text, wiki pages, analysis output |
| Artifacts | Local filesystem under controlled root | Store content references, hashes, size, type, and redaction metadata in SQLite |
| Hashing | SHA-256 | Artifacts and append-only audit chain |

Prefer direct SQL and repository classes over a heavy ORM. The goal is transparent storage and precise migration control. A lightweight query helper is acceptable, but no abstraction should hide important SQL or FTS behavior.

## 6.4 Agent and model layer

| Layer | Technology | Decision |
|---|---|---|
| Provider abstraction | Internal TypeScript interface | Model-independent runtime |
| V1 providers | Fake provider and DeepSeek | Fake provider is mandatory before live model calls |
| Later providers | OpenAI and local model | Implement only after provider interface is stable |
| Output mode | Strict structured JSON | Validate against Zod; invalid output triggers repair/retry policy |
| Prompt management | Versioned prompt/capability files | Persist prompt version with each run |
| Model routing | Configurable profiles | Cost, token, timeout, retry, fallback, model, temperature |

Do not adopt LangChain or a graph framework for V1. The runtime stages are explicit enough to implement directly, which improves traceability and debugging.

## 6.5 Console

| Layer | Technology | Decision |
|---|---|---|
| UI | React 19 + TypeScript | Local operator console |
| Build | Vite current stable pinned in lockfile | Fast development and workspace integration |
| Routing | React Router | URL-addressable pages and subviews |
| Data fetching | TanStack Query or a small typed client wrapper | Canonical polling, cache, retry, cancellation |
| Forms | React Hook Form + Zod resolver, or equivalent | Shared validation with server contracts |
| Styling | Existing Research Team conventions or minimal CSS system | Do not introduce a large component framework without need |

Follow the focused-view rule: one page, one active primary view, with drill-ins instead of long stacks.

## 6.6 Testing and quality

| Layer | Technology | Decision |
|---|---|---|
| Unit/service tests | Vitest | Contracts, readiness rules, memory ranking, quality gates |
| API tests | Vitest + Supertest or direct HTTP client | Real server and isolated database |
| Browser/E2E | Playwright Test | Console workflows and durable reload behavior |
| Type checking | `tsc --noEmit` | Strict; zero errors |
| Linting | ESLint | Minimal, enforce useful correctness rules |
| Formatting | Prettier | Deterministic formatting |
| Coverage | Vitest coverage | Focus on critical branches, not vanity percentage |

## 6.7 Logging and observability

Use structured JSON Lines. A library such as Pino is appropriate, but wrap it behind an internal logging package so the domain does not depend directly on the logger implementation.

Minimum endpoints:

- `GET /health`
- `GET /ready`
- `GET /metrics` returning JSON in V1

---

# 7. Repository Structure

Recommended pnpm workspace:

```text
marketplace-analysis-agent/
├── apps/
│   ├── server/
│   │   ├── src/
│   │   │   ├── app.ts
│   │   │   ├── server.ts
│   │   │   ├── config/
│   │   │   ├── middleware/
│   │   │   ├── routes/
│   │   │   ├── workers/
│   │   │   └── composition/
│   │   └── package.json
│   └── console/
│       ├── src/
│       │   ├── app/
│       │   ├── pages/
│       │   ├── features/
│       │   ├── components/
│       │   └── client/
│       └── package.json
├── packages/
│   ├── contracts/
│   ├── database/
│   ├── agent-core/
│   ├── evidence/
│   ├── analysis/
│   ├── quality/
│   ├── memory/
│   ├── wiki/
│   ├── capability-amazon-kdp/
│   ├── model-router/
│   ├── artifacts/
│   ├── logging/
│   ├── audit/
│   ├── client/
│   └── test-support/
├── migrations/
├── data/
│   └── .gitkeep
├── artifacts/
│   └── .gitkeep
├── log/
│   └── .gitkeep
├── prompts/
│   └── amazon-kdp/
├── fixtures/
│   ├── evidence/
│   ├── provider-responses/
│   └── expected-outputs/
├── e2e/
├── scripts/
├── docs/
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
├── .env.example
└── README.md
```

## 7.1 Package responsibilities

### `contracts`
Canonical Zod schemas, enums, API request/response types, persisted JSON payloads, and generated JSON Schema/OpenAPI material.

### `database`
Connection, transactions, migration runner, repositories, FTS synchronization, test database helpers.

### `agent-core`
Run state machine, stage execution, idempotency, execution locks, heartbeat, cancellation, recovery, and orchestration of internal services.

### `evidence`
Evidence package validation, normalization, coverage calculation, provenance validation, snapshots, and evidence reference resolution.

### `analysis`
Analysis request planner, context assembly input, model prompt preparation, output parsing, finding persistence, revision diffing.

### `quality`
Deterministic quality gates, model-assisted review contract, decision-readiness checks, output scoring, warnings.

### `memory`
Memory store, scopes, FTS5 retrieval, ranking, context builder, outcomes, learning events, lesson proposals, Error Book, usage traces.

### `wiki`
Wiki proposal compiler, generated pages, links, versions, linting, and reconciliation against canonical memory.

### `capability-amazon-kdp`
Supported operations, analysis areas, evidence requirements, freshness rules, marketplace vocabulary, prompt templates, quality rubric, memory taxonomy, output extensions.

### `model-router`
Provider interface, fake provider, DeepSeek implementation, profiles, limits, retry/fallback, usage accounting.

### `artifacts`
Safe paths, writes, reads, content hashing, metadata, MIME type, retention hooks.

### `logging`
Structured JSONL logging, context propagation, redaction, file streams.

### `audit`
Append-only audit events and optional SHA-256 hash chain.

### `client`
Typed TypeScript client used by Research Team and console.

---

# 8. Domain Contracts

## 8.1 Core enums

```ts
export const OperationType = z.enum([
  "full_marketplace_analysis",
  "focused_analysis_question",
  "revise_analysis",
  "comparative_analysis",
  "evaluate_evidence_readiness",
  "propose_memory_update"
]);

export const AnalysisArea = z.enum([
  "market_structure",
  "competitor_set",
  "customer_evidence",
  "pricing",
  "positioning",
  "keywords_categories",
  "format_product_expectations",
  "listing_conversion",
  "risk_ip_policy",
  "opportunity_summary",
  "evidence_sufficiency"
]);

export const RunStatus = z.enum([
  "accepted",
  "planning",
  "recalling_memory",
  "evaluating_evidence",
  "awaiting_evidence",
  "analyzing",
  "reviewing_output",
  "proposing_memory",
  "completed",
  "partial",
  "evidence_insufficient",
  "needs_revision",
  "blocked",
  "cancelled",
  "failed"
]);
```

## 8.2 Request contract

```ts
const CreateAnalysisRequestSchema = z.object({
  client: z.string().min(1),
  clientRequestId: z.string().optional(),
  projectId: z.string().min(1),
  externalWorkOrderId: z.string().optional(),
  operation: OperationType,
  capability: z.object({
    platform: z.literal("amazon"),
    marketplace: z.literal("US"),
    category: z.literal("books"),
    productType: z.literal("adult_coloring_book"),
    requestedVersion: z.string().optional()
  }),
  productContext: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    salesGoal: z.string().min(1),
    constraints: z.array(z.string()).default([])
  }),
  requestedAnalysis: z.array(AnalysisArea).min(1),
  question: z.string().optional(),
  evidencePackageIds: z.array(z.string()).min(1),
  modelProfileId: z.string().optional(),
  costCapUsd: z.number().nonnegative().optional(),
  tokenCap: z.number().int().positive().optional(),
  timeoutSeconds: z.number().int().positive().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
}).superRefine((value, ctx) => {
  if (value.operation === "focused_analysis_question" && !value.question) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["question"],
      message: "question is required for focused_analysis_question"
    });
  }
});
```

## 8.3 Finding contract

Every persisted finding must include:

```ts
const FindingSchema = z.object({
  findingId: z.string(),
  statement: z.string().min(1),
  analysisArea: AnalysisArea,
  classification: z.enum([
    "observed_fact",
    "source_reported_claim",
    "validated_memory",
    "inference",
    "assumption",
    "unknown"
  ]),
  scope: ScopeSchema,
  evidenceRefs: z.array(z.string()),
  memoryRefs: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  freshness: z.object({
    status: z.enum(["current", "aging", "stale", "unknown"]),
    evaluatedAt: z.string().datetime(),
    oldestEvidenceAt: z.string().datetime().optional(),
    newestEvidenceAt: z.string().datetime().optional()
  }),
  contradictions: z.array(z.string()),
  downstreamImplications: z.array(z.string()),
  validationStatus: z.enum([
    "unreviewed",
    "system_validated",
    "reviewer_accepted",
    "reviewer_rejected",
    "superseded",
    "contested"
  ])
});
```

Rules:

- `observed_fact` and `source_reported_claim` require evidence references.
- `validated_memory` requires approved memory references and should include supporting evidence references when available.
- `inference` must identify supporting evidence/memory and cannot be represented as fact.
- `assumption` must be listed in the response assumptions collection.
- `unknown` must be listed in unknowns and may generate a collection request.

## 8.4 Collection request contract

```ts
const CollectionRequestSchema = z.object({
  collectionRequestId: z.string(),
  requestType: z.literal("supplemental_collection"),
  status: z.enum(["proposed", "accepted", "in_progress", "fulfilled", "unavailable", "cancelled"]),
  priority: z.enum(["low", "medium", "high", "critical"]),
  platform: z.literal("amazon"),
  marketplace: z.literal("US"),
  targetSet: z.array(z.string()),
  requiredEvidence: z.array(z.string()).min(1),
  reason: z.string().min(1),
  analysisAreasBlocked: z.array(AnalysisArea),
  completionRule: z.object({
    minimumItems: z.number().int().nonnegative().optional(),
    minimumProducts: z.number().int().nonnegative().optional(),
    minimumReviews: z.number().int().nonnegative().optional(),
    requiredFields: z.array(z.string()).default([]),
    maximumAgeDays: z.number().int().positive().optional()
  }),
  suggestedCollectorCapability: z.string().optional()
});
```

The `suggestedCollectorCapability` is descriptive only in V1. The agent does not call the collector.

---

# 9. Persistence Model

Use explicit SQL migrations and foreign keys. Enable WAL mode, foreign keys, and a sensible busy timeout at connection initialization.

## 9.1 Core execution tables

### `analysis_projects`

- `project_id` primary key
- `external_project_id`
- `name`
- `platform`
- `marketplace`
- `category`
- `product_type`
- `product_context_json`
- `status`
- `created_at`
- `updated_at`

### `analysis_requests`

- `request_id` primary key
- `project_id` foreign key
- `client`
- `client_request_id`
- `external_work_order_id`
- `operation`
- `requested_analysis_json`
- `question`
- `capability_id`
- `capability_version`
- `model_profile_id`
- `request_payload_artifact_id`
- `idempotency_key`
- `request_hash`
- `status`
- `created_at`
- `updated_at`

Unique constraint on a scoped idempotency key, for example `(client, idempotency_key)`.

### `analysis_runs`

- `run_id` primary key
- `request_id` foreign key
- `attempt_number`
- `status`
- `current_phase`
- `execution_id`
- `correlation_id`
- `provider`
- `model`
- `prompt_version`
- `capability_version`
- `started_at`
- `heartbeat_at`
- `completed_at`
- `timeout_at`
- `cancel_requested_at`
- `failure_code`
- `failure_message`
- `token_input`
- `token_output`
- `cost_usd`
- `output_artifact_id`
- `quality_score`

### `analysis_attempts`

Use when a single run contains a model retry, repair, or review retry.

- `attempt_id`
- `run_id`
- `attempt_type`
- `attempt_number`
- `status`
- `input_artifact_id`
- `output_artifact_id`
- `validation_errors_json`
- `started_at`
- `completed_at`

### `analysis_findings`

Relational columns for filtering plus canonical JSON payload:

- `finding_id`
- `run_id`
- `analysis_area`
- `classification`
- `statement`
- `confidence`
- `validation_status`
- `scope_key`
- `freshness_status`
- `payload_json`
- `created_at`
- `updated_at`

### `analysis_outputs`

- `output_id`
- `run_id`
- `output_type`
- `schema_version`
- `artifact_id`
- `content_hash`
- `created_at`

### `collection_requests`

Persist the structured contract and lifecycle.

## 9.2 Evidence tables

### `evidence_packages`

- package identity and version;
- project and external work-order reference;
- source client;
- normalized schema version;
- status;
- item counts;
- coverage summary;
- diagnostics;
- package artifact;
- content hash;
- created and observed dates.

### `evidence_items`

Recommended searchable columns:

- `evidence_id`
- `evidence_package_id`
- `source_type`
- `platform`
- `marketplace`
- `category`
- `product_type`
- `subject_id`
- `source_url`
- `observed_at`
- `collector`
- `collector_version`
- `confidence`
- `title`
- `text_content`
- `fields_json`
- `provenance_json`
- `raw_snapshot_artifact_id`
- `content_hash`
- `validation_status`

### `evidence_links`

Many-to-many links between findings, evidence, memory, collection requests, and revisions.

### `evidence_snapshots`

Artifact reference, MIME type, hash, source metadata, redaction status, and access class.

## 9.3 Runtime and audit tables

- `model_calls`
- `tool_calls`
- `run_events`
- `audit_events`
- `execution_locks`
- `idempotency_records`
- `settings_model_profiles`
- `artifacts`

`tool_calls` includes internal predefined function calls even when no external tool is used. This supports full traceability of readiness evaluation, memory retrieval, context assembly, artifact writing, and validators.

---

# 10. Memory and Learning Architecture

Memory must be designed as an active learning subsystem, not a storage folder.

## 10.1 Four-layer architecture

```text
Layer 1: Immutable source and run artifacts
  -> evidence, model inputs/outputs, reviewer feedback
Layer 2: Canonical structured memory in SQLite
  -> scopes, authority, provenance, versions, outcomes
Layer 3: Wiki update proposals
  -> LLM-assisted synthesis linked to canonical memory
Layer 4: Approved/generated wiki views
  -> human-readable current knowledge and open questions
```

SQLite is the source of truth. Wiki text is a governed projection.

## 10.2 Memory categories

### Current project state
Always loaded deterministically for the active project:

- product and goal;
- constraints;
- current evidence packages;
- accepted competitor set;
- active analysis areas;
- unresolved collection requests;
- latest accepted output;
- latest reviewer feedback;
- current project decisions.

### Project history
Prior runs, revisions, accepted/rejected findings, changed assumptions, collection attempts, and reasons for decisions.

### Reusable semantic memory
Approved marketplace or category knowledge such as pricing patterns, customer complaints, format expectations, and platform mechanics.

### Episodic memory
What happened during previous work: successful collection strategies, failure causes, revision paths, and outcome context.

### Procedural memory
Active rules for how the agent should work: sufficiency standards, confidence rules, source requirements, freshness, contradiction handling, and revision behavior.

### Failure and correction memory
The Error Book: known reasoning failures, evidence misuse, scope mistakes, stale memory mistakes, retrieval failures, and validated corrections.

## 10.3 Authority states

```text
raw_record
project_working
reviewed_project
reusable_proposed
reusable_approved
procedural_proposed
procedural_active
rejected
contested
superseded
expired
```

Rules:

- `rejected`, `superseded`, and `expired` items remain stored for audit but cannot be supplied as active knowledge.
- `contested` items may be supplied only with explicit contradiction context.
- narrow-scope approved memory outranks broad-scope memory.
- project-specific accepted facts must not automatically become cross-project facts.

## 10.4 Memory tables

### `memory_items`

- `memory_id`
- `memory_type`
- `authority_status`
- `title`
- `statement`
- `summary`
- `confidence`
- `support_count`
- `contradiction_count`
- `valid_from`
- `valid_until`
- `last_reaffirmed_at`
- `created_from_run_id`
- `created_from_learning_event_id`
- `current_version_id`
- `created_at`
- `updated_at`

### `memory_scopes`

A memory item may have multiple dimensions:

- platform;
- marketplace;
- geography;
- category;
- product type;
- subcategory;
- project;
- product;
- analysis area;
- evidence type;
- capability version;
- time period.

Store scope dimensions relationally rather than as one folder path.

### `memory_evidence_links`

Links memory to evidence and findings with support type:

- `supports`
- `contradicts`
- `supersedes`
- `derived_from`
- `reaffirms`

### `memory_versions`

Immutable version history with change reason, before/after hash, actor, approval, and artifact.

### `memory_proposals`

- proposal type;
- proposed statement;
- scope;
- evidence links;
- confidence;
- reason;
- conflict summary;
- proposed authority;
- status;
- reviewer and decision.

### `memory_retrieval_events`

Record candidates considered, selected, rejected, final rank, reason, query, filters, and context assembly ID.

### `learning_events`

Structured outcome events:

- accepted analysis;
- rejected finding;
- revision required;
- collection request successful/unsuccessful;
- memory helpful/harmful;
- repeated mistake;
- quality gate failure;
- downstream outcome feedback.

### `lesson_candidates`

Proposed lesson extracted from a learning event, including action, result, root cause, correction, scope, confidence in cause, support count, and review status.

### `procedural_rules`

Versioned active operating rules. Link each rule to learning events and regression tests.

### `error_book_entries`

- error class;
- unsafe behavior pattern;
- context;
- root cause;
- correction;
- occurrence count;
- last occurrence;
- severity;
- affected capability versions;
- regression test IDs;
- recurrence status.

### `context_assemblies`

Persist the exact memory context selected for each model call:

- assembly ID;
- run ID;
- analysis area;
- token budget;
- current state refs;
- procedural refs;
- semantic memory refs;
- failure refs;
- contradiction refs;
- omitted candidates and reasons;
- final artifact.

### `memory_usage_events`

Track whether a memory was:

- considered;
- selected;
- included;
- cited by the model;
- used in a finding;
- accepted by the reviewer;
- later judged irrelevant or harmful.

## 10.5 FTS5 design

Use FTS5 virtual tables for:

- `memory_items` title, statement, summary;
- findings;
- evidence title and text;
- analysis outputs;
- wiki pages.

Example external-content table pattern:

```sql
CREATE VIRTUAL TABLE memory_fts USING fts5(
  title,
  statement,
  summary,
  content='memory_items',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);
```

Use triggers or explicit repository synchronization. Explicit repository synchronization is easier to reason about if all writes go through repositories; triggers are safer against accidental drift. Select one approach and test rebuild/reconciliation.

FTS query construction must escape or quote user-provided terms. Do not pass raw focused-question text directly into `MATCH`.

## 10.6 Retrieval pipeline

Retrieval is deterministic first, textual second:

```text
1. Resolve mandatory current project state
2. Resolve capability and analysis-area procedural rules
3. Filter memory candidates by authority
4. Filter by compatible scope
5. Evaluate freshness
6. Exact metadata and key matches
7. FTS5 query using normalized search terms
8. Rank candidates
9. Detect conflicts and superseded relationships
10. Build token-bounded context
11. Persist retrieval trace and context artifact
```

Initial ranking formula may be deterministic and explainable:

```text
score =
  0.30 * scope_match
+ 0.20 * authority_weight
+ 0.15 * text_relevance
+ 0.10 * freshness
+ 0.10 * confidence
+ 0.05 * support_strength
+ 0.10 * demonstrated_usefulness
- staleness_penalty
- contradiction_penalty
- broad_scope_penalty
```

Store component scores for debugging. Do not hide ranking inside an opaque model call.

## 10.7 Memory context builder

The LLM receives a bounded, typed context—not a dump of the database.

Always include:

- current operation;
- current project state;
- current evidence summary;
- capability rules;
- mandatory procedural rules;
- output contract.

Retrieve as relevant:

- accepted prior project findings;
- reusable approved memory;
- past failure corrections;
- successful procedures;
- contradictions;
- stale-memory warnings;
- open questions.

The context builder must apply per-section token budgets. Example default:

| Context section | Budget share |
|---|---:|
| Current request and project state | 15% |
| Evidence summaries and selected excerpts | 45% |
| Procedural rules | 10% |
| Approved semantic memory | 15% |
| Failure lessons / Error Book | 7% |
| Contradictions / open questions | 5% |
| Output instructions and schema | 3% |

These are starting values, configurable by model profile and analysis area.

## 10.8 Learning loop

```text
Run or finding outcome
  -> structured reviewer evaluation
  -> learning event
  -> root-cause/lesson proposal
  -> deterministic validation
  -> human review when reusable or procedural
  -> approved memory/rule
  -> future retrieval
  -> measure whether it helped
```

Do not infer causal success from acceptance alone. A lesson candidate must separate:

- action taken;
- observed outcome;
- reviewer judgment;
- proposed root cause;
- corrective action;
- scope;
- confidence in the causal explanation.

## 10.9 Turning lessons into stronger safeguards

When a lesson is repeated and stable, prefer converting it into code or a deterministic rule.

Example:

```text
Observed repeated failure:
Price bands mixed paperback and hardcover products.

Weak correction:
Add a prompt reminder.

Strong correction:
Readiness rule requires normalized format before pricing analysis.
Quality gate rejects a price finding that combines incompatible formats without explicit segmentation.
Regression test covers the failure.
```

## 10.10 Memory evaluation

For fixed fixtures, compare runs with and without memory and measure:

- unsupported claim count;
- evidence coverage;
- repeated error count;
- reviewer acceptance;
- confidence calibration;
- completeness;
- token and cost impact;
- irrelevant-memory rate.

Memory is beneficial only when quality improves without unacceptable context cost or contamination.

---

# 11. Wiki Learning System

Implement a Karpathy-style compounding wiki adapted for strict provenance.

## 11.1 Wiki purpose

The wiki is the readable evolving synthesis of approved memory. It should answer:

- What do we currently know?
- What evidence supports it?
- What changed?
- What failed previously?
- What remains uncertain?
- Which conclusions are segment-dependent or contested?
- Where should a researcher drill into raw evidence?

## 11.2 Canonical hierarchy for initial capability

```text
Amazon US
└── Books
    └── Adult Coloring Books
        ├── Market Structure
        ├── Competitor Types
        ├── Customer Expectations
        ├── Recurring Complaints
        ├── Pricing and Format
        ├── Listing Conversion
        ├── Keywords and Categories
        ├── Positioning Patterns
        ├── Risks and IP
        ├── Reusable Procedures
        ├── Error Book Summary
        └── Open Questions
```

Subcategory pages may include Cozy, Lofi, Rainy Day, Animals, and other validated scopes.

## 11.3 Wiki tables

- `wiki_pages`
- `wiki_page_versions`
- `wiki_sections`
- `wiki_links`
- `wiki_source_links`
- `wiki_update_proposals`
- `wiki_lint_issues`

## 11.4 Wiki update process

```text
Approved memory or procedural change
  -> identify affected pages
  -> generate proposed patch
  -> validate referenced memory IDs
  -> lint unsupported claims and broken links
  -> approve automatically only for deterministic rendering changes
  -> require review for substantive synthesis changes in V1
  -> publish new page version
```

The LLM proposes text; application code controls source links, status, versions, and publication.

## 11.5 Wiki lint rules

Flag:

- statements with no approved memory source;
- references to rejected or expired memory as current truth;
- stale pages;
- unresolved contradiction not disclosed;
- broken internal links;
- orphan pages;
- summary inconsistent with canonical memory;
- page scope broader than supporting memory;
- procedural guidance without an active rule.

---

# 12. Evidence Readiness System

The readiness gate runs before analysis.

## 12.1 Capability-defined evidence requirements

The Amazon KDP pack defines requirements per analysis area. Initial examples:

### Market structure

- minimum comparable listing count;
- stable subject IDs;
- titles/subtitles;
- positioning text;
- category or query context;
- collection diagnostics.

### Customer evidence

- direct review text or Q&A;
- source URL/reference;
- rating and review date when available;
- product identity;
- minimum coverage across multiple products;
- language and deduplication status.

### Pricing

- current price;
- format/binding;
- page count;
- currency;
- observed date;
- comparable-product classification.

### Keywords and categories

- title/subtitle phrases;
- category/breadcrumb where available;
- search query context;
- listing metadata;
- no unsupported search-volume estimate.

### Risk/IP

- observable brand or trademark indicators;
- policy references;
- source dates;
- clear distinction between risk signal and legal conclusion.

## 12.2 Readiness result

Each area returns:

```ts
{
  area: AnalysisArea,
  status: "ready" | "partial" | "insufficient" | "blocked",
  score: number,
  required: EvidenceRequirementResult[],
  availableEvidenceRefs: string[],
  gaps: EvidenceGap[],
  warnings: string[],
  allowedOutputLevel: "complete" | "limited" | "none"
}
```

## 12.3 Partial analysis policy

The request may continue when some areas are ready and others are not.

Rules:

- completed areas must be explicitly listed;
- incomplete areas must not contain final claims;
- unknowns and assumptions must be explicit;
- the response status becomes `partial` or `evidence_insufficient`;
- exact collection requests are produced for blocked areas;
- the caller decides whether to continue, collect more evidence, or cancel.

---

# 13. Agent Runtime and Durable Execution

## 13.1 State machine

```text
accepted
  -> planning
  -> recalling_memory
  -> evaluating_evidence
      -> awaiting_evidence
      -> analyzing
  -> reviewing_output
  -> proposing_memory
  -> completed | partial | evidence_insufficient

Any active state may transition to:
  needs_revision | cancelled | failed
```

Define allowed transitions in code. Reject invalid transitions and log an audit event.

## 13.2 API request behavior

1. Validate headers, size, body, and operation.
2. Resolve or create project.
3. Validate evidence references.
4. Resolve capability version.
5. Apply idempotency.
6. Create request and run in one transaction.
7. Create execution lock.
8. Return `202 Accepted` with request ID, run ID, and status URL.
9. Schedule execution outside the request lifecycle.

## 13.3 Worker model

For local V1, use an in-process durable worker loop backed by SQLite rather than introducing Redis or an external queue.

Recommended pattern:

- requests persist as queued executions;
- worker claims an execution using a transaction and lock lease;
- worker updates heartbeat every configurable interval;
- on restart, recovery scans active executions;
- stale leases are reconciled based on phase and last durable checkpoint;
- stages are idempotent where possible;
- artifacts are written before state advances;
- duplicate workers cannot own the same execution.

This keeps V1 local and inspectable while leaving a future queue adapter boundary.

## 13.4 Execution locks

`execution_locks` fields:

- lock key;
- run ID;
- execution ID;
- owner instance ID;
- acquired at;
- lease expires at;
- heartbeat at;
- released at;
- status.

Use conditional update/insert within an immediate transaction. Test concurrent claims.

## 13.5 Durable checkpoints

Persist after each stage:

- stage input artifact;
- stage output artifact;
- state transition;
- timing and usage;
- validation results;
- next stage.

A recovered run should resume from the last safe completed checkpoint, not rerun the entire request blindly.

---

# 14. Analysis Planning and Execution

## 14.1 Deterministic planner

The plan is derived from operation, requested areas, capability, and readiness rules. The model does not invent arbitrary steps.

Example full-analysis plan:

```text
1. Resolve capability
2. Load current project state
3. Retrieve mandatory procedures and relevant memory
4. Evaluate evidence coverage by requested area
5. Build ready-area analysis plan
6. Generate collection requests for gaps
7. Analyze ready areas
8. Validate structured findings
9. Run deterministic quality gates
10. Run optional model-assisted review
11. Persist output
12. Create learning and memory proposals
```

## 14.2 Model call boundaries

Prefer several focused structured calls over one uncontrolled giant call when it improves validation and retry behavior. Initial approach may use:

1. analysis call for all ready areas when evidence volume fits;
2. optional quality-review call;
3. lesson extraction call only after reviewed outcomes;
4. wiki patch call after approved memory.

Do not split into many calls without evidence that it improves quality or cost.

## 14.3 Prompt layering

Each model call receives immutable instruction layers:

1. service system rules;
2. operation definition;
3. capability-pack rules;
4. procedural memory rules;
5. current project context;
6. selected evidence and memory context;
7. exact output schema.

Evidence is delimited and explicitly labeled untrusted. Evidence instructions are ignored.

## 14.4 Structured output validation

On invalid output:

1. store raw response artifact;
2. record validation errors;
3. if repair is allowed, send a schema-repair request containing errors but not new analysis freedom;
4. maximum configured repair attempts;
5. fail with `MODEL_OUTPUT_INVALID` after limit;
6. never persist partially parsed findings as accepted output.

---

# 15. Quality Gates

## 15.1 Evidence gate

- all evidence references exist;
- referenced items belong to allowed packages;
- provenance required fields exist;
- source dates satisfy capability freshness policy or are warned;
- facts and claims are not supported solely by assumptions;
- customer conclusions use direct customer evidence or are explicitly limited;
- collection diagnostics are considered.

## 15.2 Structural analysis gate

- requested ready sections are present;
- blocked sections are not presented as complete;
- every finding has classification;
- confidence is within range;
- all evidence and memory references resolve;
- assumptions and unknowns are listed;
- contradictions are surfaced;
- output schema and enums are valid.

## 15.3 Reasoning safety gate

Deterministically flag patterns such as:

- customer preference inferred only from rating count;
- causal claim unsupported by evidence type;
- price comparison mixing incompatible formats without segmentation;
- broad category claim based on one product;
- stale memory presented without warning;
- rejected memory cited as active;
- policy risk represented as legal advice;
- search volume estimated without source evidence.

## 15.4 Decision-readiness gate

- result explains what the caller can act on;
- facts and recommendations/implications are separated;
- missing evidence becomes a precise request;
- confidence and limitations are visible;
- output identifies next decision or next collection action.

## 15.5 Memory gate

- project history saved;
- reusable memory only proposed;
- proposal includes scope, provenance, confidence, freshness, and conflicts;
- superseded and contested memories are handled correctly;
- memory usage trace is persisted.

---

# 16. Model Provider Architecture

## 16.1 Interface

```ts
export interface ModelProvider {
  readonly providerId: string;
  healthCheck(): Promise<ProviderHealth>;
  generateStructured<T>(request: StructuredModelRequest<T>): Promise<ModelResult<T>>;
}
```

`StructuredModelRequest` includes:

- model;
- system instructions artifact/reference;
- prompt payload;
- output schema and schema version;
- temperature;
- max output tokens;
- timeout;
- correlation metadata;
- redaction policy.

`ModelResult` includes:

- validated data when successful;
- raw response artifact;
- usage;
- finish reason;
- latency;
- provider request ID;
- validation errors;
- retry metadata.

## 16.2 Fake provider

The fake provider is mandatory and supports:

- deterministic successful response;
- evidence-insufficient result;
- malformed JSON;
- schema-invalid response;
- timeout;
- provider error;
- slow response with heartbeat;
- quality-gate failure;
- revision success;
- memory proposal creation.

Use fixture keys rather than hidden branching on prompt text.

## 16.3 DeepSeek provider

Requirements:

- secrets only from environment/config secret layer;
- timeout and abort signal;
- structured response handling;
- usage/cost calculation from configurable pricing table;
- retry only for approved transient conditions;
- no retry on deterministic validation or authorization error unless repair path applies;
- full request/response stored as controlled artifacts, not normal logs.

## 16.4 Model profiles

Example profiles:

```text
mock-only
budget-deepseek
recommended-deepseek
premium-later
local-later
```

A profile contains provider, model, temperature, token cap, cost cap, timeout, retry, repair attempts, and fallback policy.

---

# 17. API Design

All endpoints live under `/v1` except health/readiness.

## 17.1 Service endpoints

```text
GET /health
GET /ready
GET /metrics
GET /v1/capabilities
GET /v1/model-profiles
```

## 17.2 Project endpoints

```text
POST /v1/projects
GET  /v1/projects/:projectId
GET  /v1/projects/:projectId/state
GET  /v1/projects/:projectId/runs
```

## 17.3 Evidence endpoints

```text
POST /v1/evidence-packages
GET  /v1/evidence-packages/:packageId
GET  /v1/evidence-packages/:packageId/readiness
POST /v1/evidence-packages/:packageId/validate
```

## 17.4 Analysis endpoints

```text
POST /v1/analysis-requests
GET  /v1/analysis-requests/:requestId
GET  /v1/analysis-runs/:runId
POST /v1/analysis-runs/:runId/cancel
POST /v1/analysis-runs/:runId/revise
GET  /v1/analysis-runs/:runId/output
GET  /v1/analysis-runs/:runId/findings
GET  /v1/analysis-runs/:runId/readiness
GET  /v1/analysis-runs/:runId/collection-requests
```

## 17.5 Review endpoints

```text
POST /v1/findings/:findingId/review
POST /v1/analysis-runs/:runId/review
GET  /v1/analysis-runs/:runId/reviews
```

Review request includes structured reason codes and optional notes/evidence.

## 17.6 Memory endpoints

```text
GET  /v1/memory/search
GET  /v1/memory/items/:memoryId
GET  /v1/memory/items/:memoryId/versions
GET  /v1/memory/proposals
POST /v1/memory/proposals/:proposalId/approve
POST /v1/memory/proposals/:proposalId/reject
POST /v1/memory/items/:memoryId/supersede
GET  /v1/memory/error-book
GET  /v1/memory/context-assemblies/:assemblyId
```

## 17.7 Wiki endpoints

```text
GET  /v1/wiki/pages
GET  /v1/wiki/pages/:pageId
GET  /v1/wiki/pages/:pageId/versions
GET  /v1/wiki/proposals
POST /v1/wiki/proposals/:proposalId/approve
POST /v1/wiki/proposals/:proposalId/reject
POST /v1/wiki/lint
```

## 17.8 Diagnostics endpoints

```text
GET /v1/runs/:runId/events
GET /v1/runs/:runId/model-calls
GET /v1/runs/:runId/tool-calls
GET /v1/runs/:runId/audit
GET /v1/runs/:runId/memory-usage
```

## 17.9 Error contract

```json
{
  "error": {
    "code": "UNSUPPORTED_CAPABILITY",
    "message": "The requested operation is outside the supported marketplace-analysis capabilities.",
    "requestId": "req_...",
    "correlationId": "corr_...",
    "details": [],
    "retryable": false
  }
}
```

Use stable machine-readable codes.

---

# 18. Typed Client for Sales OS

Create `@maa/client` as a generated or hand-maintained typed wrapper over canonical contracts.

Example:

```ts
const client = new MarketplaceAnalysisClient({
  baseUrl: "http://127.0.0.1:4320",
  timeoutMs: 15_000
});

const created = await client.createAnalysis({
  client: "research-team",
  projectId,
  externalWorkOrderId: workOrderId,
  operation: "full_marketplace_analysis",
  capability: {
    platform: "amazon",
    marketplace: "US",
    category: "books",
    productType: "adult_coloring_book"
  },
  productContext,
  requestedAnalysis: [
    "market_structure",
    "competitor_set",
    "customer_evidence",
    "pricing",
    "positioning",
    "keywords_categories",
    "risk_ip_policy"
  ],
  evidencePackageIds: [evidencePackageId],
  idempotencyKey: `${workOrderId}:marketplace-analysis:v1`
});
```

Client requirements:

- validate outbound requests and inbound responses;
- expose polling helper with abort signal;
- handle `202`, partial, evidence insufficient, and revision states;
- propagate correlation ID;
- never read or write the MAA database;
- support mock server in Research Team integration tests.

---

# 19. Operator Console

## 19.1 Pages

### Dashboard

- service health and readiness;
- active, awaiting evidence, failed, and completed runs;
- recent requests;
- stale executions;
- token and cost totals;
- memory proposals;
- wiki lint issues.

### Projects

- project list and state;
- current goal and constraints;
- current evidence and accepted analysis;
- unresolved questions.

### New Analysis

A structured form only. Operation selection changes available fields. Unsupported analysis areas do not appear.

### Run Inspector

Primary state and next action first. Drill-ins:

- request and plan;
- evidence readiness;
- recalled memory;
- context assembly;
- model calls;
- findings;
- quality review;
- collection requests;
- revisions;
- audit timeline;
- errors.

### Finding Review

One finding at a time with evidence and memory references. Actions:

- accept;
- reject;
- request revision;
- mark contested;
- provide correction reason;
- open source artifact.

### Memory Inspector

- search and filters;
- memory status and authority;
- provenance and scope;
- versions;
- contradictions;
- usage history;
- approve/reject proposals.

### Error Book

- error classes;
- occurrences;
- corrections;
- linked procedural rules;
- linked regression tests;
- recurrence status.

### Wiki

- browse pages;
- view source links;
- compare versions;
- review update proposals;
- see stale/contradictory warnings.

### Logs

- structured filters;
- request/run correlation;
- export;
- no secrets or uncontrolled payloads.

### Test Console

- select predefined fixtures;
- run fake-provider scenarios;
- display request and validated response;
- no arbitrary prompt execution.

## 19.2 UI state rules

- URLs identify the active page and drill-in.
- Reload reconnects to the same run.
- Poll canonical server state; do not infer completion from client timers.
- Long-running notices are informational.
- Destructive or governance actions require confirmation.
- Analysis acceptance and reusable-memory approval are separate actions.

---

# 20. Logging, Audit, and Artifact Security

## 20.1 Log files

```text
/log/access.log
/log/application.log
/log/agent.log
/log/model.log
/log/tool.log
/log/memory.log
/log/audit.log
/log/error.log
```

JSONL fields:

- timestamp;
- severity;
- service version;
- environment;
- instance ID;
- request ID;
- run ID;
- execution ID;
- correlation ID;
- project ID;
- client;
- event type;
- phase;
- duration;
- success;
- error code;
- artifact references.

## 20.2 Payload policy

Normal logs must not contain uncontrolled complete prompts, evidence packages, or model responses.

Store full payloads as artifacts with:

- artifact ID;
- relative safe path;
- content hash;
- MIME type;
- size;
- created date;
- redaction status;
- access classification;
- related request/run/model call.

## 20.3 Redaction

Never log:

- API keys;
- authorization headers;
- credentials;
- passwords;
- raw secret configuration.

Provide configurable redaction for email, phone, address, and user-designated sensitive fields.

## 20.4 Safe artifact paths

- single configured artifact root;
- generated filenames only;
- reject `..`, absolute paths, drive prefixes, or symlink escape;
- atomic write to temporary file then rename;
- hash after write;
- never execute artifact contents.

## 20.5 Audit stream

Append-only audit fields:

- event ID;
- previous hash;
- event hash;
- actor type and ID;
- action;
- target;
- before/after state;
- artifact refs;
- timestamp.

Implement the hash chain when it can reuse the proven Research Team pattern without slowing core milestone delivery. Plain append-only events are mandatory from M0.

---

# 21. Guardrails and Security

V1 guardrails:

- Zod validation at every boundary;
- strict operation allowlist;
- capability allowlist;
- analysis-area allowlist;
- request body and evidence count limits;
- text length limits;
- provider timeout;
- token and cost caps;
- idempotency;
- execution lock;
- prompt-injection delimiters and instructions;
- evidence treated as data;
- structured output validation;
- no arbitrary URL fetch;
- no shell access;
- no dynamic code execution;
- safe artifact paths;
- secret redaction;
- no automatic reusable-memory promotion;
- freshness policy;
- stale-run recovery;
- cancellation;
- rate limiting appropriate for local API;
- CORS limited to configured console/client origins;
- optional local API token later, not required for first isolated local milestone.

---

# 22. Testing Strategy

## 22.1 Test pyramid

### Unit tests

- contracts and refinements;
- operation rejection;
- capability resolution;
- readiness rules;
- scope compatibility;
- FTS query escaping;
- ranking component scores;
- freshness;
- context token budgeting;
- quality gates;
- state transitions;
- error codes;
- safe paths;
- redaction;
- audit hashing.

### Repository/database tests

Use isolated temporary databases and real migrations:

- migration up from empty;
- constraints and foreign keys;
- idempotency uniqueness;
- concurrent execution lock claims;
- FTS synchronization and rebuild;
- memory versioning;
- proposal approval transaction;
- wiki version creation;
- restart persistence.

### API tests

- valid `202` request;
- unsupported operation rejected before provider call;
- malformed evidence rejected;
- duplicate idempotency returns canonical request/run;
- polling state;
- cancellation;
- revision;
- evidence-insufficient result;
- partial result;
- diagnostics authorization boundary when added;
- error contract consistency.

### Provider tests

- fake deterministic responses;
- timeout;
- abort;
- malformed JSON;
- invalid schema;
- repair success/failure;
- usage recording;
- transient retry;
- cost cap.

### E2E tests

- create request in console;
- observe phase transitions;
- reload and reconnect;
- inspect readiness;
- provide supplemental evidence;
- complete analysis;
- review a finding;
- request revision;
- approve/reject memory proposal;
- browse wiki and source links;
- stale-run recovery UI;
- no duplicate execution after double click.

## 22.2 Golden fixtures

Create representative evidence fixtures:

1. complete KDP evidence;
2. listings without reviews;
3. mixed paperback/hardcover prices;
4. sponsored and organic competitors;
5. stale evidence;
6. contradictory reviews;
7. prompt injection inside review text;
8. duplicate evidence items;
9. malformed provenance;
10. second coloring-book project for memory reuse.

## 22.3 Memory regression tests

Required scenarios:

- rejected memory is not active;
- narrower scope outranks broad scope;
- stale memory produces warning or exclusion;
- contested memory is disclosed;
- prior error lesson prevents repeated unsupported customer inference;
- irrelevant memory is not selected;
- memory usage trace identifies every included item;
- project memory survives restart;
- cross-project promotion requires approval;
- wiki cannot publish unsupported statements.

## 22.4 Quality commands

Every milestone completion report includes output for:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm test:api
pnpm test:e2e
pnpm build
```

Commands may be scoped during early milestones, but the root commands must work by the integration milestone.

---

# 23. Development Milestones

The milestones below are designed as controlled vertical slices. Cursor must not implement them all in one pass.

## M0 - Repository, Contracts, Database, and Observability Foundation

### Objective

Create a runnable, testable standalone workspace with no live LLM analysis yet.

### Build

1. pnpm workspace and package boundaries.
2. Node/TypeScript strict configuration.
3. Express server composition.
4. Environment configuration validated by Zod.
5. SQLite connection and migration runner.
6. Initial tables:
   - projects;
   - requests;
   - runs;
   - run events;
   - artifacts;
   - audit events;
   - model profiles;
   - execution locks;
   - idempotency records.
7. Structured logging package and `/log` files.
8. Correlation-ID middleware.
9. Artifact service with safe paths and SHA-256.
10. Health, readiness, capabilities, metrics endpoints.
11. Canonical error contract.
12. Basic React/Vite console with Dashboard and Test Console shell.
13. Fake provider interface and health result, but no analysis workflow.

### Acceptance

- server starts from root command;
- database initializes from empty directory;
- migrations are repeatable;
- health/readiness report database and artifact readiness;
- incoming request receives correlation ID;
- access and application logs are JSONL;
- secrets are redacted;
- artifact path traversal tests pass;
- console displays service health;
- typecheck, unit, API smoke, build, and one Playwright smoke test pass.

### Explicit non-goals

No evidence model, analysis, memory retrieval, live provider, or Sales OS integration.

---

## M1 - Durable Request Runtime and Operation Guardrails

### Objective

Accept constrained requests, return `202`, execute durable fake workflows, and reconnect after reload.

### Build

1. Operation and analysis-area contracts.
2. Project creation/resolution.
3. Analysis request API.
4. Idempotency handling.
5. Run state machine and validated transitions.
6. In-process durable worker.
7. Execution lock and heartbeat.
8. Cancellation.
9. stale execution recovery.
10. fake workflow phase simulation.
11. run/events/diagnostics endpoints.
12. Run Inspector showing canonical phase and timeline.
13. unsupported capability rejection before provider invocation.

### Acceptance

- valid request returns `202` and durable IDs;
- invalid/free-chat request returns `UNSUPPORTED_CAPABILITY` with zero model calls;
- double submit returns same canonical run;
- reload reconnects to the run;
- worker continues after HTTP request returns;
- restart reconciles an active fake run;
- duplicate worker claim is prevented;
- cancellation is durable;
- phase transitions are audited;
- timeout and recovery tests pass.

### Explicit non-goals

No real evidence analysis or long-term memory.

---

## M2 - Evidence Packages and Readiness Gate

### Objective

Accept normalized evidence and deterministically decide which requested analysis areas are ready.

### Build

1. Evidence package/item schemas.
2. Evidence artifact import/reference.
3. provenance and hash validation.
4. evidence database tables and FTS index.
5. Amazon KDP capability pack v1 skeleton.
6. required evidence rules by analysis area.
7. readiness matrix and scoring.
8. collection request generation.
9. evidence package inspector.
10. readiness drill-in within Run Inspector.

### Acceptance

- complete fixture produces expected ready areas;
- missing reviews blocks customer evidence;
- mixed formats warn or block unsegmented pricing;
- stale evidence produces configured status;
- malformed provenance is rejected;
- prompt injection in evidence remains inert data;
- structured collection request contains exact missing fields and completion rule;
- ready sections may proceed while blocked sections remain incomplete;
- readiness decisions are logged and audited.

### Explicit non-goals

No live LLM analysis; fake provider may return canned analysis after readiness.

---

## M3 - Stateless Amazon KDP Analysis and Quality Gates

### Objective

Produce the first useful integrated analysis from a complete evidence package using a fake provider, then DeepSeek behind a feature flag.

### Build

1. Deterministic analysis planner.
2. prompt/version management.
3. model context using current request and evidence only.
4. fake provider structured analysis fixtures.
5. DeepSeek provider and model profiles.
6. structured finding/output schemas.
7. invalid-output repair policy.
8. deterministic evidence, structural, reasoning, and decision-readiness gates.
9. optional model-assisted quality review.
10. output and finding persistence.
11. Finding Review UI.
12. token, latency, and cost recording.

### Acceptance

- complete evidence produces integrated structured output;
- every fact has resolvable evidence references;
- unsupported customer claim fixture fails quality gate;
- incompatible-format price conclusion fails or is segmented;
- invalid provider output is repaired or fails safely;
- live provider can be disabled completely;
- a capped live acceptance run succeeds within configured budget;
- full prompt/input/output are artifacts, not normal logs;
- finding review actions persist.

### Explicit non-goals

No cross-run memory retrieval or wiki.

---

## M4 - Revision and Structured Human Feedback

### Objective

Allow the Research Orchestrator or operator to correct the agent without restarting the project.

### Build

1. run-level and finding-level review contracts.
2. reason codes:
   - unsupported conclusion;
   - incorrect evidence interpretation;
   - missing analysis;
   - wrong scope;
   - stale memory/evidence;
   - contradiction ignored;
   - confidence miscalibrated;
   - other.
3. revision endpoint and new run/attempt linkage.
4. supplemental evidence attachment.
5. revision context builder.
6. finding supersession and diff.
7. reviewer timeline in console.
8. learning-event recording, without reusable promotion yet.

### Acceptance

- revision references the prior run and findings;
- prior output remains immutable;
- supplemental evidence can satisfy prior gap;
- only affected areas may be rerun when safe;
- rejected findings are preserved and marked;
- revision produces clear before/after trace;
- feedback becomes a structured learning event.

---

## M5 - Project Memory, FTS5 Retrieval, and Context Assembly

### Objective

Give the agent project continuity and inspectable retrieval.

### Build

1. memory tables, scopes, versions, evidence links.
2. project working memory auto-save.
3. accepted/rejected project findings.
4. FTS5 memory index.
5. deterministic scope resolver.
6. ranking with component scores.
7. context assemblies and artifacts.
8. memory retrieval/usage events.
9. project memory inspector.
10. model context includes approved project memory and failure corrections.

### Acceptance

- project memory survives restart;
- second run retrieves accepted project findings;
- rejected findings are not active knowledge;
- retrieval trace explains selection and omission;
- exact and phrase FTS search works;
- narrow scope outranks broad scope;
- token budget is enforced;
- output cites memory IDs used;
- irrelevant fixture memory is excluded.

---

## M6 - Learning from Outcomes and Error Book

### Objective

Convert reviewed success and failure into governed lessons that change future behavior.

### Build

1. outcome review model.
2. learning events.
3. lesson candidate extraction.
4. human review of causal explanation.
5. Error Book.
6. procedural-rule proposal and approval.
7. linkage from rule to failure, evidence, capability version, and regression test.
8. recurrence tracking.
9. memory helpful/harmful evaluation.
10. controlled inclusion of active procedural rules in context.

### Acceptance

- rejected unsupported customer finding creates an Error Book entry;
- approved procedural rule is retrieved on a future run;
- future run returns a collection request rather than repeating the mistake;
- rule authority and scope are enforced;
- one accepted run does not automatically become causal truth;
- recurrence status is visible;
- regression test linked to the correction passes.

---

## M7 - Reusable Category Memory and Governance

### Objective

Allow validated knowledge to compound across projects under approval.

### Build

1. reusable memory proposals.
2. approval/rejection/supersession workflows.
3. freshness and expiration.
4. contradiction detection.
5. cross-project retrieval.
6. support and contradiction counts.
7. memory governor UI.
8. second coloring-book project fixture/UAT.

### Acceptance

- project memory cannot leak across projects unless approved reusable;
- proposal shows evidence, scope, confidence, and conflicts;
- approval creates versioned active memory;
- rejection remains auditable;
- stale reusable knowledge is warned or excluded;
- conflicting knowledge is surfaced, not overwritten;
- second project retrieves only compatible approved knowledge;
- analysis acceptance does not approve memory.

---

## M8 - Governed Wiki Compiler and Linter

### Objective

Create a human-readable, evolving marketplace knowledge base backed by canonical memory.

### Build

1. wiki page/version/link tables.
2. initial Amazon KDP hierarchy.
3. source-linked generated pages.
4. wiki update proposals.
5. patch review and publication.
6. contradiction and open-question sections.
7. Error Book summary pages.
8. lint engine.
9. wiki browser and version comparison.

### Acceptance

- every substantive wiki statement links to approved memory;
- rejected/expired memory cannot publish as current truth;
- new approved memory generates a reviewable patch;
- previous page version remains accessible;
- lint detects missing provenance, stale pages, broken links, and undisclosed contradiction;
- wiki is rebuildable from canonical memory.

---

## M9 - Research Team Integration

### Objective

Use MAA as a clean external tool from Sales OS Research Team.

### Build

1. `@maa/client` package.
2. evidence artifact exchange contract.
3. Research Team MAA adapter behind feature flag.
4. idempotent create/poll/revise workflow.
5. mapping of MAA state into Research Team task state.
6. display of readiness, collection requests, findings, and review actions.
7. mocked integration tests.
8. capped live UAT with Lofi Rainy Day project.
9. no database coupling.

### Acceptance

- Research Team submits an evidence package and receives `202`;
- reload reconnects to same external run;
- evidence gap routes to Research Orchestrator decision;
- MAA does not call MCEC directly;
- accepted analysis becomes a Research Team artifact;
- revisions and supplemental evidence work;
- correlation IDs trace across services;
- integration uses API/client only;
- failure in MAA does not corrupt Research Team state.

---

## M10 - Hardening and Publishability Preparation

### Objective

Prepare for broader use without prematurely building cloud multi-tenancy.

### Build candidates

- local API authentication;
- packaging and release process;
- configuration profiles;
- backup/export/import;
- artifact retention;
- database integrity check;
- metrics expansion;
- performance profiling;
- threat review;
- API compatibility tests;
- documentation and examples.

External authentication, cloud deployment, and multi-tenancy require a separate approved design.

---

# 24. Milestone Completion Report Template

Cursor should return this after every milestone:

```text
Milestone:
Status: complete / partial / blocked

Implemented:
- ...

Important design decisions:
- ...

Files and migrations added:
- ...

API changes:
- ...

Tests executed:
- command and result

Manual UAT performed:
- ...

Acceptance criteria:
- pass/fail for each item

Known issues:
- ...

Deferred by design:
- ...

Human action required:
- ...

Recommended next step:
- ...
```

Do not claim completion without test evidence.

---

# 25. Initial Configuration

Suggested `.env.example` keys:

```text
NODE_ENV=development
MAA_HOST=127.0.0.1
MAA_PORT=4320
MAA_DATABASE_PATH=./data/maa.sqlite
MAA_ARTIFACT_ROOT=./artifacts
MAA_LOG_ROOT=./log
MAA_LOG_LEVEL=info
MAA_WORKER_POLL_MS=1000
MAA_HEARTBEAT_MS=5000
MAA_STALE_EXECUTION_MS=300000
MAA_DEFAULT_TIMEOUT_SECONDS=300
MAA_MAX_REQUEST_BYTES=5242880
MAA_MAX_EVIDENCE_ITEMS=5000
MAA_DEFAULT_MODEL_PROFILE=mock-only
MAA_DEEPSEEK_ENABLED=false
DEEPSEEK_API_KEY=
MAA_CONSOLE_ORIGIN=http://127.0.0.1:5173
```

All configuration is validated at startup. Invalid required configuration fails fast with a clear error and redacted logs.

---

# 26. Initial Capability-Pack Files

Recommended structure:

```text
packages/capability-amazon-kdp/
├── src/
│   ├── capability.ts
│   ├── operations.ts
│   ├── analysis-areas.ts
│   ├── evidence-requirements.ts
│   ├── freshness.ts
│   ├── readiness.ts
│   ├── quality-rules.ts
│   ├── memory-taxonomy.ts
│   ├── wiki-map.ts
│   └── output-extension.ts
└── prompts/
    ├── full-analysis.v1.md
    ├── focused-question.v1.md
    ├── revision.v1.md
    ├── quality-review.v1.md
    ├── lesson-extraction.v1.md
    └── wiki-update.v1.md
```

The capability manifest exposes:

- ID and version;
- supported operations;
- supported analysis areas;
- accepted evidence schema versions;
- readiness evaluator;
- freshness rules;
- quality rules;
- prompt versions;
- memory scope taxonomy;
- wiki mapping.

Capability versions used by a run are immutable for that run.

---

# 27. Example End-to-End Scenario

## 27.1 Request

Research Team registers a package containing competitor listings, price, page count, format, and ratings, but no review text.

## 27.2 Readiness

```text
market_structure: ready
competitor_set: ready
pricing: ready
positioning: ready
customer_evidence: insufficient
keywords_categories: partial
risk_ip_policy: partial
```

## 27.3 Agent behavior

- analyzes ready areas;
- does not invent customer preferences;
- returns `partial`;
- produces a review collection request;
- cites all findings;
- records current project state;
- makes no reusable memory proposal from unsupported customer data.

## 27.4 Supplemental evidence

Research Team supplies direct reviews from three products.

The revision:

- reevaluates customer readiness;
- analyzes repeated praise and complaints;
- preserves the original partial run;
- links new findings to new evidence;
- creates lesson and memory proposals only after review.

## 27.5 Failure learning

If an unsupported preference claim was rejected:

- store the rejected finding;
- create learning event;
- propose correction: direct buyer language required;
- approve procedural rule;
- add Error Book entry;
- link regression test;
- retrieve rule in future customer-analysis runs.

## 27.6 Wiki learning

After multiple approved projects support marker bleed-through as a recurring complaint:

- propose category memory with limited scope;
- human approves;
- wiki patch updates `Adult Coloring Books / Recurring Complaints`;
- page shows current evidence, counterevidence, freshness, and related format practices.

---

# 28. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Memory accumulation lowers quality | Authority states, scope, freshness, usage traces, regression tests |
| LLM rewrites wiki inaccurately | Canonical SQLite memory, source validation, patch review, lint |
| Agent becomes free chat | Operation/area allowlists and pre-model rejection |
| Duplicate long-running work | Idempotency and execution locks |
| Browser disconnect loses run | Durable SQLite worker and polling |
| Evidence prompt injection | Treat evidence as delimited untrusted data; no tool freedom |
| Too much context | Token budgets, deterministic retrieval, ranking trace |
| Incorrect causal learning | Separate outcome from proposed root cause; human approval |
| Stale market knowledge | Freshness rules, expiration, reaffirmation |
| Hidden database coupling | Typed HTTP client and artifact references only |
| Cost growth | Profiles, token/cost caps, fake tests, capped live UAT |
| Overengineering | Milestone gates and explicit non-goals |

---

# 29. V1 Definition of Done

The first production-useful local version is complete when:

1. It accepts only predefined marketplace-analysis operations.
2. Research Team can register Amazon KDP evidence through the API.
3. Analysis request returns `202` with durable IDs.
4. The run survives reload and supported restart recovery.
5. Evidence readiness is evaluated before analysis.
6. Missing customer evidence creates a structured collection request.
7. Complete evidence produces integrated, validated analysis.
8. Every finding carries provenance, classification, confidence, and freshness.
9. Unsupported claims fail quality gates.
10. Human review and revision are durable and traceable.
11. Project memory survives restart.
12. FTS5 retrieval is inspectable and token bounded.
13. Rejected findings and mistakes are preserved in the learning system.
14. An approved error correction changes future behavior and has a regression test.
15. Cross-project memory requires approval.
16. The wiki is source-linked and rebuildable from canonical memory.
17. Every API, model, internal function, memory, artifact, and execution event is logged or audited appropriately.
18. Sales OS Research Team integrates through the typed client with no database coupling.
19. Fake-provider unit, API, browser, timeout, recovery, revision, memory, and wiki tests pass.
20. A capped live Lofi Rainy Day analysis completes successfully.

---

# 30. Deliberate V1 Non-Goals

Do not build in the initial version:

- autonomous browsing;
- direct collector control;
- multi-agent analysis team;
- unrestricted chat;
- vector database;
- automatic memory promotion;
- model fine-tuning;
- cloud deployment;
- multi-tenancy;
- enterprise authentication;
- arbitrary plugin/tool execution;
- forecasting without evidence;
- final strategy generation;
- direct Sales OS database access.

Optional embeddings may be evaluated only after FTS5 retrieval has measurable limitations with real memory volume and paraphrase diversity.

---

# 31. Final Architecture Principle

```text
The database remembers what happened.
The learning system determines what it may mean.
The memory governor determines what becomes reusable.
The wiki maintains the evolving synthesis.
The context builder decides what the LLM needs now.
The quality gates prevent unsupported output.
The Research Orchestrator decides what the business workflow does next.
```

The LLM is a replaceable reasoning component inside a controlled, inspectable system. The durable intelligence belongs to the contracts, evidence model, governed memory, learning loop, capability rules, quality gates, and audit trail.

---

# 32. Technical Reference Baseline

The following official documentation informed the stack baseline as of July 25, 2026:

- Node.js release policy and LTS table: https://nodejs.org/en/about/previous-releases
- Express 5 API: https://expressjs.com/en/5x/api/
- pnpm workspaces: https://pnpm.io/workspaces
- Vite guide: https://vite.dev/guide/
- Vitest guide: https://vitest.dev/guide/
- Playwright installation and requirements: https://playwright.dev/docs/intro
- SQLite FTS5: https://sqlite.org/fts5.html
- Zod 4: https://zod.dev/

Pin exact dependency versions in the lockfile when M0 begins, and record upgrades through reviewed changes rather than floating production installs.
