# LP8-I4c MAA Governance and Replay Bridge

**Service:** Marketplace Analysis Agent 0.20.0  
**Schema:** 0017  
**Learning Plane packages:** @learning-plane/contracts@0.8.1, @learning-plane/client@0.8.1  
**API compatibility:** 2026.07  

## Option C (preserved)

- Learning Plane owns shared operator decisions and replay verification.
- MAA owns local proposals, rules, replay execution, activation, and rollback.
- **Approval does not activate.**
- **Replay eligibility does not activate.**

## Feature flags (all default OFF)

| Flag | Purpose |
|---|---|
| `MAA_LEARNING_PLANE_GOVERNANCE_BRIDGE_ENABLED` | Master governance bridge |
| `MAA_LEARNING_PLANE_GOVERNANCE_PUBLISH_ENABLED` | Proposal submission outbox |
| `MAA_LEARNING_PLANE_GOVERNANCE_RECEIVE_ENABLED` | Decision callback receive |
| `MAA_LEARNING_PLANE_VALIDATION_RECEIPT_ENABLED` | Local-validation receipts |
| `MAA_LEARNING_PLANE_ACTIVATION_RECEIPT_ENABLED` | Activation/rollback receipts |
| `MAA_LEARNING_PLANE_REPLAY_BRIDGE_ENABLED` | Replay-job receive |
| `MAA_LEARNING_PLANE_REPLAY_EXECUTE_ENABLED` | Local replay execution queue |
| `MAA_LEARNING_PLANE_REPLAY_REPORT_ENABLED` | Replay report outbox |
| `MAA_LEARNING_PLANE_GRANDFATHER_REGISTER_ENABLED` | `legacy_local` registration |

## Operator flows

1. Propose + local replay typed procedural version.
2. `POST /v1/typed-procedural-versions/:id/share-to-learning-plane` when publish flags on.
3. Operator decides in Learning Plane Learning Control (not MAA).
4. MAA receives HMAC decision callback, validates locally, never activates.
5. Operator activates locally via MAA when validation accepted.
6. Receipts publish to Learning Plane for coordination only.

## Competing approval

For `governance_origin=learning_plane_shared`, local `approve` is rejected.
LP decision projection uses `approvedBy=lp-decision:<id>` and is not a second operator approval.

## Grandfathering

`legacy_local` inventory only. No retroactive LP decisions. Material changes require a new governed proposal.
