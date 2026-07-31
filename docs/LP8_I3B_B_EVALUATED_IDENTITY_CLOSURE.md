# LP8-I3b-b Evaluated-Event Identity Closure

**Status:** complete  
**Date:** 2026-07-30  
**MAA service:** `0.19.1`  
**Schema:** `0016` (no new migration)  
**Research Team:** not modified  
**LP8-I3c:** not started

---

## Previous mutable behavior

When an evaluated outbox row was captured before a reconciled `workflow_feedback.resolution_submitted` parent existed, capture used a provisional `resolutionId` (`maa-res:…`) and built the idempotency key from that provisional value. On causation release, `releaseWaitingEvaluated` rewrote:

- `resolution_id`
- `idempotency_key`
- `payload_json` / `payload_sha256`
- `correlation_id` (also overwritten from the parent)

**Root cause:** evaluated identity was derived from Learning Plane inbox state when available, otherwise from a placeholder, and release treated parent arrival as permission to mutate child identity.

---

## Final identity invariant

At transactional capture of the canonical effectiveness evaluation and adapter outbox row, the following are **immutable**:

```text
workflowFeedbackId
resolutionId
evaluationId
eventType
sourceRecordType / sourceRecordId / sourceRecordVersion
correlationId
idempotencyKey
payloadSchemaVersion
payload identity fields (payload_json / payload_sha256)
```

The row may start as `waiting_for_causation` with `causationEventId = null`.

Causation release may update **only**:

```text
causationEventId
status: waiting_for_causation → pending
nextAttemptAt / updatedAt
bounded processing diagnostics
```

---

## Canonical resolution identity source

**Source of truth:** canonical MAA operational resolution on the workflow-feedback record once `resolve()` has set `resolutionAction`.

Stable ID (no schema column required):

```text
maa:resolution:<workflowFeedbackId>
```

Helper: `canonicalMaaResolutionId()` in `workflowFeedbackMapping.ts`.

Evaluated capture requires:

- `resolutionAction` present (operational resolve already committed)
- `revisionRunId` present (evaluation identity)

Otherwise capture is skipped with bounded diagnostic `learning_plane.evaluated.capture_gap` — no invented placeholder identity.

---

## Idempotency-key construction

Uses `@learning-plane/contracts` helper:

```text
maa:workflow-feedback:<workflowFeedbackId>:resolution:<resolutionId>:evaluated:<evaluationId>:v1
```

Generated at capture from frozen IDs. Stable across wait, release, retry, and restart. No temporary placeholder keys.

---

## Payload immutability

`WorkflowFeedbackResolutionEvaluatedPayloadV1` is serialized once at capture.

- Envelope `causation_event_id` is the sole nullable causation location
- Payload does not carry causation
- Publish retries use stored payload + stored identities + resolved causation event id
- Payload is never rebuilt from live canonical records during release or publish

---

## Causation-release rules

```text
canonical evaluation committed
→ immutable evaluated outbox captured
→ waiting_for_causation (causationEventId null) OR pending (if matching submitted already reconciled)
→ matching resolution_submitted received
→ verify feedback ID, resolution ID, correlation ID, parent type, direction
→ set causationEventId only; status → pending
→ publish with original idempotency key and payload hash
```

Mismatched parents record `learning_plane.evaluated.causation_mismatch` / `identity_mutation_rejected` and **do not** mutate the waiting row. A later correct parent can still release it.

---

## Migration decision

**No migration `0017`.** Schema `0016` already has nullable `causation_event_id`, immutable identity columns, and uniqueness on idempotency key + source-record tuple. Closure is code-level.

Service patch: **`0.19.1`**. Schema remains **`0016`**. Migration `0016` was not modified.

---

## Diagnostics

Append-only processing events (safe IDs/hashes only):

| Kind | Meaning |
|---|---|
| `learning_plane.evaluated.capture_identity_frozen` | Identities frozen at capture |
| `learning_plane.evaluated.causation_resolved` | Causation filled; status pending |
| `learning_plane.evaluated.causation_mismatch` | Parent failed identity checks |
| `learning_plane.evaluated.causation_already_resolved` | Causation already set |
| `learning_plane.evaluated.identity_mutation_rejected` | Attempted identity rewrite blocked |
| `learning_plane.evaluated.capture_gap` | Missing resolution/evaluation identity |

---

## Test and UAT evidence

| Suite | Result |
|---|---|
| `lp8-i3b-b.evaluated-identity.test.ts` | **5/5** |
| `lp8-i3b.workflowFeedback.adapter.test.ts` | **5/5** |
| `learning-plane.adapter.test.ts` | **6/6** |
| `n3.workflow-feedback.test.ts` | **1/1** |
| Complete MAA `pnpm test` | **42 files / 151 tests passed** (~15.2s) |
| Typecheck + server/console build | pass |
| Isolated live UAT (`lp8I3bLiveUat.ts`) | **passed** (43 steps; frozen identity + wrong-then-correct parent) |
| Backup/restore identity survival | covered in I3b-b unit test + live UAT |
| Research Team read-only MAA/RO-N3 | **6 files / 31 passed** |

Live UAT asserts that after causation release and publication, capture-time `resolutionId`, `idempotencyKey`, `payloadSha256`, and `correlationId` remain identical.

---

## Final LP8-I3b acceptance state

With LP8-I3b-a and LP8-I3b-b closed, **LP8-I3b is accepted** for MAA production adapter identity, immutability, live UAT, and regression.

**LP8-I3c has not started.** Research Team was not modified.
