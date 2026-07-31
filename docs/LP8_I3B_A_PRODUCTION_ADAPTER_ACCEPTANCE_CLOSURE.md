# LP8-I3b-a Production Adapter Acceptance Closure

**Status:** accepted (superseded for identity details by LP8-I3b-b; live UAT/suite results remain valid)  
**Date:** 2026-07-30  
**Follow-on:** [`LP8_I3B_B_EVALUATED_IDENTITY_CLOSURE.md`](./LP8_I3B_B_EVALUATED_IDENTITY_CLOSURE.md) closed the remaining evaluated-identity mutability gap.

---

## Objective

Prove the real MAA 0.19.0 production Learning Plane adapter against an isolated Learning Plane 0.8.0 runtime, close the unexplained `m9` server-suite exclusion, and finalize LP8-I3b acceptance evidence.

## Proof statement

```text
MAA can publish and receive production workflow-feedback
learning events through Learning Plane while preserving
its operational API, canonical local learning records,
and independence from Learning Plane availability.
```

---

## 1. Isolated live-UAT environment

Script: `apps/server/src/lp8I3bLiveUat.ts`

| Component | Isolation |
|---|---|
| Learning Plane DB / artifacts / logs | Temp directory under OS tmp (`maa-lp8-i3b-a-uat-*`) |
| Learning Plane port | Ephemeral loopback port |
| Operator token | Generated per run (`lp8-i3b-a-uat-<random>`); never logged |
| MAA DB / artifacts / logs / backups | Separate temp subtree |
| MAA secret file | Temp `secrets/lp.json` only |
| MAA / fixture RO ports | Ephemeral loopback ports |
| Fixture `research-orchestrator` | Registered only on the isolated LP DB (no shared registration clash) |
| Cleanup | Bounded Windows `rm` retries; failure diagnostics preserved and redacted |

LP process is spawned via `node` + vendored Learning Plane `tsx` entry (no shared production DB, no shared `.env` database path).

---

## 2. Exact event lifecycle (43 steps)

Live UAT result: **passed**, `stepsCompleted: 43`.

Highlights:

1. Isolated LP 0.8.0 started (`apiCompat=2026.07`).
2. Fixture RO registered with `events.publish|receive|acknowledge`.
3–6. Real MAA 0.19.0 started; bootstrap + reconcile; capabilities `health.report`, `events.publish`, `events.receive`, `events.acknowledge`.
7–10. Late-gap feedback → transactional created outbox → publish `workflow_feedback.created@1.0` → RO receive/ack.
11–17. Stop LP → second feedback retained as durable pending outbox → MAA restart while LP down → outbox survives → LP restart → **exactly one** publish.
18–22. Operational resolve → RO publishes `resolution_submitted@1.0` → MAA verifies signature, durable inbox + ack, LP acknowledgement, reconcile to existing local resolution **without** a second operational resolve command.
23–26. Revision/effectiveness path → transactional evaluated outbox → publish with same correlation, submitted causation, matching WF/resolution IDs, effectiveness `partial` → RO ack.
27. Idempotent republish of all three event types.
28–29. Conflicting submitted → `semantic_conflict`; canonical resolution unchanged.
30–33. Submitted before local resolve → `awaiting_local_reconciliation` → operational resolve → reconcile without adapter-issued second resolve.
34–37. Evaluated before submitted parent → `waiting_for_causation` → parent arrives → pending → publish once.
38–39. Restart with pending work; workers recover; no permanent claimed leases.
40. Adapter diagnostics / lineage inspection (status, outbox, inbox, processing-events) without secrets.
41–42. Backup + isolated restore: migration `0016`, `integrity_check=ok`, `foreign_key_check` empty, canonical + adapter state restored.
43. Secret scan across payloads, logs, status APIs, audit/processing surfaces, backups, diagnostics.

---

## 3. Outage, restart, and worker recovery

| Scenario | Result |
|---|---|
| LP stopped while MAA up | MAA `/health` remains OK; new feedback stays durable pending/retry |
| MAA restarted while LP down | Outbox row survives; not published |
| LP restored | Exactly one created publish for the pending row |
| MAA restarted with pending outbox + pending ack work | Workers drain after LP returns; no stuck permanent claims |

Workers stopped through `learningPlane.stop()` (outbox, ack, reconciliation, heartbeat) before SQLite close. Cleanup failures are explicit; Windows temp deletion uses bounded retries.

---

## 4. Causation and reconciliation

| Path | Result |
|---|---|
| Happy-path submitted after local resolve | `reconciled`; ack → `acknowledged` |
| Semantic conflict | `semantic_conflict`; canonical `resolutionAction` unchanged |
| Submitted before resolve | `awaiting_local_reconciliation` then `reconciled` after API resolve |
| Evaluated before submitted | `waiting_for_causation` then released to `pending` and published once with `causationEventId` = submitted event |

---

## 5. `m9` failure root cause and resolution

### Classification

**package-resolution defect introduced by incomplete workspace wiring** (surfaced as a **test-harness/environment defect** when running `pnpm --filter @maa/server exec vitest`).

### Evidence

| Invocation | Before fix | After fix |
|---|---|---|
| Root `pnpm exec vitest run --project api .../m9...` (workspace aliases) | 5/5 passed | 5/5 passed |
| `pnpm --filter @maa/server exec vitest run src/m9...` | **Failed to load `@maa/client`** | **5/5 passed** |

Root cause: `@maa/client` exists at `packages/client` and is aliased in `vitest.workspace.ts`, but was **not** declared as a dependency of `@maa/server`. Filter-scoped vitest therefore could not resolve the package. Prior LP8-I3b reporting excluded this as “pre-existing” without fixing package wiring.

### Resolution

Added `"@maa/client": "workspace:*"` to `apps/server` `devDependencies` and installed. No skip, no weakened assertions, no broad mock.

Complete server suite (root `pnpm test`): **41 files / 146 tests passed**, including `m9.research-integration.test.ts` (5/5). **No unexplained exclusions.**

---

## 6. Complete test totals

### MAA

| Check | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm build` (server + console) | pass |
| `pnpm test` (complete vitest workspace) | **41 files, 146 tests, 0 failed, 0 skipped** (~20.3s) |
| Console unit tests | none present under `apps/console` |
| Ops backup/restore (`packages/ops`) | included in suite (5 tests) |
| N1 / N3 / M10 / memory / governance / LP adapter / LP8-I3b adapter | included and green |
| LP8-I3b-a live UAT | **passed (43/43)** |

### Research Team (read-only; no code changes)

| Suite | Result |
|---|---|
| `maaCompatibility.test.ts` | pass |
| `maaIntegration.api.test.ts` | pass |
| `maaStagedWorkflow.api.test.ts` | pass |
| `workflowFeedback.api.test.ts` (RO-N3) | pass |
| `workflowFeedback.contract.test.ts` | pass |
| `workflowFeedback.safety.test.ts` | pass |
| **Totals** | **6 files, 31 tests passed** (~39.5s) |

---

## 7. Package version and checksum verification

| Artifact | Expected SHA-256 | Observed |
|---|---|---|
| `learning-plane-contracts-0.8.0.tgz` | `51e00046e8fd715f93997108863f0813c8bdc2ac5c8a2cd27d80009da3d62e86` | match |
| `learning-plane-client-0.8.0.tgz` | `2fb12a37621d5b361ea32634b972e9a978d06675d9a309dbd0ec38a05f560a49` | match |

Confirmed:

- lockfile resolves only 0.8.0 Learning Plane packages
- no active 0.7.1 package
- no Learning Plane server implementation vendored (client + contracts artifacts + compatibility manifest only)
- `COMPATIBILITY_MANIFEST.json` matches
- adapter status exposes package identity safely (versions/checksums; no secrets)
- no consumer-specific contract workaround remains

---

## 8. Backup, restore, integrity

After real adapter events:

- migration ledger includes `0016`
- `PRAGMA integrity_check = ok`
- `PRAGMA foreign_key_check` = no violations
- canonical `workflow_feedback_events`, resolutions/evaluations, outbox/inbox/ack, correlation/causation, waiting/semantic-conflict, processing history restored
- secret file and Learning Plane credentials excluded from backup bundle
- restored DB is offline data only; does not auto-connect to shared/normal Learning Plane without explicit config

---

## 9. Security / secret scan

Absent from event payloads, logs, status APIs, processing inspection, audit actions, backups, and preserved failure diagnostics:

- operator token
- agent API keys (`lpak_…`)
- callback verification secrets

UAT redacts diagnostics on failure and preserves them only when cleanup must keep evidence.

---

## 10. Final LP8-I3b acceptance state

**LP8-I3b is accepted** (implementation + LP8-I3b-a closure + LP8-I3b-b identity closure).

Provisional exclusions from the prior I3b report are closed:

- live multi-process UAT executed against isolated LP
- `m9` included and green in the complete server suite
- evaluated outbox identity no longer mutates on causation release (see I3b-b)

---

## 11. Exact LP8-I3c boundary (not started)

**LP8-I3c — Research Team production workflow-feedback adapter + full round-trip UAT**

In scope only after explicit human approval:

- Research Team production receive/ack of `workflow_feedback.created` / `resolution_evaluated`
- Research Team production publish of `workflow_feedback.resolution_submitted` using MAA frozen `maa:resolution:<workflowFeedbackId>`
- RT outbox/inbox workers
- Full MAA ↔ RT ↔ LP round-trip UAT

Out of scope still:

- governance / replay / knowledge bridges
- historical backfill
- Orchestrator Core / Research Core / Strategy Team integration

**Explicit confirmation: LP8-I3c has not started. Research Team was not modified.**

---

## 12. Human action required

1. Accept LP8-I3b-a and LP8-I3b-b closures.
2. Explicitly authorize LP8-I3c before any Research Team changes.
