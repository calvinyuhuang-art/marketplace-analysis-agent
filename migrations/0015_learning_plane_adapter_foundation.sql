-- LP8-I1: Learning Plane adapter foundation (coordination state only).
-- Not experiences, evaluations, memories, Error Book, procedural rules, or workflow truth.

CREATE TABLE IF NOT EXISTS lp_adapter_settings (
  adapter_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  learning_plane_base_url TEXT NOT NULL,
  learning_plane_api_compat TEXT,
  registration_status TEXT NOT NULL DEFAULT 'unregistered'
    CHECK (registration_status IN (
      'unregistered',
      'registered',
      'reconciled',
      'failed',
      'disabled'
    )),
  credential_id TEXT,
  callback_key_id TEXT,
  callback_path TEXT,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  publish_enabled INTEGER NOT NULL DEFAULT 0 CHECK (publish_enabled IN (0, 1)),
  receive_enabled INTEGER NOT NULL DEFAULT 0 CHECK (receive_enabled IN (0, 1)),
  last_registration_check_at TEXT,
  last_health_report_at TEXT,
  last_successful_connection_at TEXT,
  last_error_code TEXT,
  last_bounded_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lp_adapter_outbox (
  outbox_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  payload_schema_version TEXT NOT NULL,
  target_agent_id TEXT,
  work_order_id TEXT,
  correlation_id TEXT,
  causation_event_id TEXT,
  source_experience_id TEXT,
  idempotency_key TEXT NOT NULL,
  payload_json_or_artifact_reference TEXT,
  payload_sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_lp_adapter_outbox_idempotency
  ON lp_adapter_outbox(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_lp_adapter_outbox_status_next
  ON lp_adapter_outbox(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS lp_adapter_inbox (
  inbox_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  source_agent_id TEXT,
  target_agent_id TEXT,
  event_type TEXT NOT NULL,
  payload_schema_version TEXT,
  correlation_id TEXT,
  causation_event_id TEXT,
  payload_sha256 TEXT,
  received_at TEXT NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'received'
    CHECK (processing_status IN (
      'received',
      'processing',
      'processed',
      'failed_retryable',
      'failed_permanent',
      'ignored'
    )),
  processed_at TEXT,
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_lp_adapter_inbox_event
  ON lp_adapter_inbox(event_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lp_adapter_inbox_delivery
  ON lp_adapter_inbox(delivery_id);

CREATE INDEX IF NOT EXISTS idx_lp_adapter_inbox_processing
  ON lp_adapter_inbox(processing_status, received_at);

CREATE TABLE IF NOT EXISTS lp_adapter_acknowledgements (
  acknowledgement_id TEXT PRIMARY KEY,
  inbox_id TEXT,
  event_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  acknowledgement_kind TEXT NOT NULL DEFAULT 'ack'
    CHECK (acknowledgement_kind IN ('ack', 'nack')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',
      'acked',
      'failed_retryable',
      'failed_permanent'
    )),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error_code TEXT,
  last_bounded_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lp_adapter_ack_delivery
  ON lp_adapter_acknowledgements(delivery_id);

CREATE INDEX IF NOT EXISTS idx_lp_adapter_ack_status_next
  ON lp_adapter_acknowledgements(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS lp_adapter_processing_events (
  processing_event_id TEXT PRIMARY KEY,
  event_kind TEXT NOT NULL,
  related_outbox_id TEXT,
  related_inbox_id TEXT,
  related_acknowledgement_id TEXT,
  correlation_id TEXT,
  detail_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lp_adapter_processing_created
  ON lp_adapter_processing_events(created_at);

CREATE INDEX IF NOT EXISTS idx_lp_adapter_processing_kind
  ON lp_adapter_processing_events(event_kind, created_at);
