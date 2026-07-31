# LP8-I3b Completion Report

**Status:** accepted (I3b implementation + I3b-a live UAT closure + I3b-b evaluated identity closure)  
**Date:** 2026-07-30  

- I3b-a: [`LP8_I3B_A_PRODUCTION_ADAPTER_ACCEPTANCE_CLOSURE.md`](./LP8_I3B_A_PRODUCTION_ADAPTER_ACCEPTANCE_CLOSURE.md)  
- I3b-b: [`LP8_I3B_B_EVALUATED_IDENTITY_CLOSURE.md`](./LP8_I3B_B_EVALUATED_IDENTITY_CLOSURE.md)

---

## 1. LP8-I3b status

**Accepted.** MAA production adapter, isolated live UAT, and evaluated-event identity immutability are complete.

| Item | Value |
|---|---|
| Service | `0.19.1` |
| Schema | `0016` |
| LP packages | `@learning-plane/contracts@0.8.0`, `@learning-plane/client@0.8.0` |

**LP8-I3c has not started.** Research Team was not modified.

## 2. Exact files (I3b-b deltas)

- `apps/server/src/integrations/learning-plane/workflowFeedbackCapture.ts`
- `apps/server/src/integrations/learning-plane/workflowFeedbackMapping.ts` (`canonicalMaaResolutionId`)
- `apps/server/src/integrations/learning-plane/adapterRepository.ts` (causation-only release)
- `apps/server/src/integrations/learning-plane/reconciliationWorker.ts`
- `apps/server/src/integrations/learning-plane/outboxWorker.ts`
- `apps/server/src/composition/container.ts` (`0.19.1`)
- `apps/server/src/lp8I3bLiveUat.ts` (frozen-identity assertions)
- `apps/server/src/lp8-i3b-b.evaluated-identity.test.ts`
- related version pins / adapter tests
- docs listed above

## 3–10. Identity closure summary

See I3b-b doc. Prior mutable rewrite of `resolutionId` / `idempotencyKey` / payload on causation release is removed. Canonical resolution ID is `maa:resolution:<workflowFeedbackId>`. No migration `0017`.

## 11–15. Regression

| Suite | Result |
|---|---|
| Focused I3b-b + adapter + N3 + LP adapter | green |
| Complete MAA vitest | **42 / 151 passed** |
| Live UAT | **passed** |
| Backup/restore identity | green |
| RT read-only compatibility / staged / RO-N3 | **31 passed** |

## 16. Security

Secrets remain excluded from payloads, logs, status, backups, and diagnostics. New diagnostics use IDs/hashes only.

## 17. Known issues

None blocking LP8-I3b acceptance. Console still has no dedicated unit-test files.

## 18. Human action

1. Accept LP8-I3b-b.
2. Explicitly approve before any Research Team changes for **LP8-I3c**.

## 19. Exact LP8-I3c boundary

Research Team production receive/ack of created + evaluated; production publish of `resolution_submitted` using MAA’s frozen `maa:resolution:<workflowFeedbackId>`; RT outbox/inbox workers; full MAA ↔ RT ↔ LP round-trip UAT.

## 20. Explicit confirmation

**LP8-I3c has not started.**
