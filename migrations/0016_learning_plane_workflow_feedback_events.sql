-- LP8-I3b: production workflow-feedback Learning Plane adapter fields and lifecycles.
-- Additive rebuild of adapter outbox/inbox/ack tables; preserves existing rows where possible.

PRAGMA foreign_keys = OFF;

-- ---------------------------------------------------------------------------
-- Outbox: add waiting_for_causation + source-record identity fields
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lp_adapter_outbox_0016 (
  outbox_id TEXT PRIMARY KEY,
  source_record_type TEXT,
  source_record_id TEXT,
  source_record_version TEXT,
  workflow_feedback_id TEXT,
  resolution_id TEXT,
  evaluation_id TEXT,
  event_type TEXT NOT NULL,
  payload_schema_version TEXT NOT NULL,
  target_agent_id TEXT,
  work_order_id TEXT,
  correlation_id TEXT,
  causation_event_id TEXT,
  source_experience_id TEXT,
  idempotency_key TEXT NOT NULL,
  payload_json TEXT,
  payload_sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'waiting_for_causation',
      'pending',
      'claimed',
      'retry_scheduled',
      'published',
      'permanent_failure',
      'cancelled'
    )),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT,
  learning_plane_event_id TEXT,
  last_error_code TEXT,
  last_bounded_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT
);

INSERT INTO lp_adapter_outbox_0016 (
  outbox_id, event_type, payload_schema_version, target_agent_id, work_order_id,
  correlation_id, causation_event_id, source_experience_id, idempotency_key,
  payload_json, payload_sha256, status, attempt_count, next_attempt_at,
  lease_owner, lease_expires_at, learning_plane_event_id, last_error_code,
  last_bounded_error, created_at, updated_at, published_at
)
SELECT
  outbox_id, event_type, payload_schema_version, target_agent_id, work_order_id,
  correlation_id, causation_event_id, source_experience_id, idempotency_key,
  payload_json_or_artifact_reference, payload_sha256, status, attempt_count,
  next_attempt_at, lease_owner, lease_expires_at, learning_plane_event_id,
  last_error_code, last_bounded_error, created_at, updated_at, published_at
FROM lp_adapter_outbox;

DROP TABLE lp_adapter_outbox;
ALTER TABLE lp_adapter_outbox_0016 RENAME TO lp_adapter_outbox;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lp_adapter_outbox_idempotency
  ON lp_adapter_outbox(idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lp_adapter_outbox_source_record
  ON lp_adapter_outbox(event_type, source_record_type, source_record_id, source_record_version)
  WHERE source_record_type IS NOT NULL AND source_record_id IS NOT NULL AND source_record_version IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lp_adapter_outbox_status_next
  ON lp_adapter_outbox(status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_lp_adapter_outbox_wf
  ON lp_adapter_outbox(workflow_feedback_id, event_type);

CREATE INDEX IF NOT EXISTS idx_lp_adapter_outbox_waiting
  ON lp_adapter_outbox(status, workflow_feedback_id, resolution_id)
  WHERE status = 'waiting_for_causation';

-- ---------------------------------------------------------------------------
-- Inbox: production reconciliation statuses + bounded payload retention
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lp_adapter_inbox_0016 (
  inbox_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  source_agent_id TEXT,
  target_agent_id TEXT,
  event_type TEXT NOT NULL,
  payload_schema_version TEXT,
  correlation_id TEXT,
  causation_event_id TEXT,
  workflow_feedback_id TEXT,
  resolution_id TEXT,
  resolution_type TEXT,
  producer_contract_name TEXT,
  producer_contract_version TEXT,
  operational_resolution_ref_json TEXT,
  payload_json TEXT,
  payload_sha256 TEXT,
  received_at TEXT NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'received'
    CHECK (processing_status IN (
      'received',
      'awaiting_local_reconciliation',
      'reconciled',
      'semantic_conflict',
      'permanent_failure'
    )),
  processed_at TEXT,
  local_resolution_ref TEXT,
  acknowledgement_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (acknowledgement_status IN (
      'pending',
      'acked',
      'nacked',
      'skipped'
    )),
  acknowledged_at TEXT,
  last_error_code TEXT,
  last_bounded_error TEXT
);

INSERT INTO lp_adapter_inbox_0016 (
  inbox_id, event_id, delivery_id, source_agent_id, target_agent_id, event_type,
  payload_schema_version, correlation_id, causation_event_id, payload_sha256,
  received_at, processing_status, processed_at, acknowledgement_status,
  acknowledged_at, last_error_code, last_bounded_error
)
SELECT
  inbox_id, event_id, delivery_id, source_agent_id, target_agent_id, event_type,
  payload_schema_version, correlation_id, causation_event_id, payload_sha256,
  received_at,
  CASE processing_status
    WHEN 'processed' THEN 'reconciled'
    WHEN 'failed_permanent' THEN 'permanent_failure'
    WHEN 'failed_retryable' THEN 'awaiting_local_reconciliation'
    WHEN 'processing' THEN 'awaiting_local_reconciliation'
    WHEN 'ignored' THEN 'permanent_failure'
    ELSE 'received'
  END,
  processed_at, acknowledgement_status, acknowledged_at, last_error_code, last_bounded_error
FROM lp_adapter_inbox;

DROP TABLE lp_adapter_inbox;
ALTER TABLE lp_adapter_inbox_0016 RENAME TO lp_adapter_inbox;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lp_adapter_inbox_event
  ON lp_adapter_inbox(event_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lp_adapter_inbox_delivery
  ON lp_adapter_inbox(delivery_id);

CREATE INDEX IF NOT EXISTS idx_lp_adapter_inbox_processing
  ON lp_adapter_inbox(processing_status, received_at);

CREATE INDEX IF NOT EXISTS idx_lp_adapter_inbox_wf
  ON lp_adapter_inbox(workflow_feedback_id, resolution_id);

-- ---------------------------------------------------------------------------
-- Acknowledgements: claimed / retry_scheduled / acknowledged lifecycle
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lp_adapter_acknowledgements_0016 (
  acknowledgement_id TEXT PRIMARY KEY,
  inbox_id TEXT,
  event_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  acknowledgement_kind TEXT NOT NULL DEFAULT 'ack'
    CHECK (acknowledgement_kind IN ('ack', 'nack')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',
      'claimed',
      'retry_scheduled',
      'acknowledged',
      'permanent_failure'
    )),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT,
  last_error_code TEXT,
  last_bounded_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

INSERT INTO lp_adapter_acknowledgements_0016 (
  acknowledgement_id, inbox_id, event_id, delivery_id, acknowledgement_kind,
  status, attempt_count, next_attempt_at, last_error_code, last_bounded_error,
  created_at, updated_at, completed_at
)
SELECT
  acknowledgement_id, inbox_id, event_id, delivery_id, acknowledgement_kind,
  CASE status
    WHEN 'acked' THEN 'acknowledged'
    WHEN 'failed_retryable' THEN 'retry_scheduled'
    WHEN 'failed_permanent' THEN 'permanent_failure'
    ELSE 'pending'
  END,
  attempt_count, next_attempt_at, last_error_code, last_bounded_error,
  created_at, updated_at, completed_at
FROM lp_adapter_acknowledgements;

DROP TABLE lp_adapter_acknowledgements;
ALTER TABLE lp_adapter_acknowledgements_0016 RENAME TO lp_adapter_acknowledgements;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lp_adapter_ack_delivery
  ON lp_adapter_acknowledgements(delivery_id);

CREATE INDEX IF NOT EXISTS idx_lp_adapter_ack_status_next
  ON lp_adapter_acknowledgements(status, next_attempt_at);

PRAGMA foreign_keys = ON;
