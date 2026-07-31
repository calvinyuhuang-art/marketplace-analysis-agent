# LP8-I3b — MAA Production Workflow-Feedback Learning Plane Adapter

**Status:** Implementation complete (awaiting human acceptance / live UAT against isolated LP)  
**MAA service:** `0.19.0`  
**MAA schema:** `0016`  
**LP packages:** `@learning-plane/contracts@0.8.0` / `@learning-plane/client@0.8.0`  
**Date:** 2026-07-30  

## Ownership (frozen)

| Owner | Content |
|---|---|
| MAA canonical DB | workflow-feedback, resolutions, revisions, experiences, Error Book, etc. |
| `lp_adapter_*` | publication/receipt/ack/retry/reconciliation state + LP event IDs |
| Learning Plane | cross-agent events, deliveries, acks, correlation/causation, audit |

## Feature flags → capabilities

| Flags | Declared capabilities |
|---|---|
| adapter off | _(none)_ |
| adapter on | `health.report` |
| + publish | `events.publish` |
| + receive | `events.receive`, `events.acknowledge` |

## Event direction

- MAA publishes: `workflow_feedback.created@1.0`, `workflow_feedback.resolution_evaluated@1.0`
- MAA receives: `workflow_feedback.resolution_submitted@1.0` only

## Mapping notes

- Created: MAA `late_evidence_gap` → LP `feedbackCategory=late_evidence_gap`, severity `blocking`, operational ref `/v1/workflow-feedback/:id`
- Evaluated: MAA `ResolutionQuality` `full|partial|ineffective` on the wire (no aliases)
- Correlation: prefer canonical `correlationId`, else `maa:wf:<workflowFeedbackId>`
- Evaluated without reconciled submitted → `waiting_for_causation`; released when submitted reconciles

## Workers

- Outbox: lease → HTTP publish outside TX → published / retry / permanent failure
- Ack: lease → `acknowledgeDelivery` outside TX
- Reconciliation: local-only matching of submitted inbox to canonical resolution; releases waiting evaluated

## Non-goals confirmed

Research Team not modified. No automatic operational resolution from received events. No historical backfill.
