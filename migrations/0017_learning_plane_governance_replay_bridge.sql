-- LP8-I4c: MAA Learning Plane governance and replay bridge coordination.
-- Additive only. Canonical typed-procedural / memory tables remain local truth.
-- Feature flags default OFF in application config.

-- ---------------------------------------------------------------------------
-- Shared-governance link for typed procedural versions (Option C)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lp_gov_bridge_links (
  link_id TEXT PRIMARY KEY NOT NULL,
  version_id TEXT NOT NULL UNIQUE,
  rule_id TEXT NOT NULL,
  governance_origin TEXT NOT NULL
    CHECK (governance_origin IN ('legacy_local', 'local_only', 'learning_plane_shared')),
  local_proposal_id TEXT NOT NULL,
  local_proposal_version_id TEXT NOT NULL,
  local_content_hash TEXT NOT NULL,
  lp_proposal_id TEXT,
  lp_case_id TEXT,
  lp_decision_id TEXT,
  lp_decision TEXT,
  decision_payload_sha256 TEXT,
  local_validation_status TEXT
    CHECK (local_validation_status IS NULL OR local_validation_status IN (
      'pending',
      'accepted',
      'rejected',
      'incompatible'
    )),
  local_validation_diagnostic TEXT,
  submission_status TEXT NOT NULL DEFAULT 'not_submitted'
    CHECK (submission_status IN (
      'not_submitted',
      'pending',
      'published',
      'conflict',
      'failed'
    )),
  submission_idempotency_key TEXT NOT NULL UNIQUE,
  submission_payload_sha256 TEXT,
  correlation_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (version_id) REFERENCES procedural_rule_versions(version_id)
);

CREATE INDEX IF NOT EXISTS idx_lp_gov_bridge_links_case
  ON lp_gov_bridge_links(lp_case_id);
CREATE INDEX IF NOT EXISTS idx_lp_gov_bridge_links_status
  ON lp_gov_bridge_links(submission_status, updated_at);

-- ---------------------------------------------------------------------------
-- Receipt / grandfather / replay coordination outbox (bridge-specific)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lp_gov_bridge_outbox (
  outbox_id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL
    CHECK (kind IN (
      'governance_submission',
      'local_validation_receipt',
      'activation_receipt',
      'activation_failure_receipt',
      'rollback_receipt',
      'rollback_failure_receipt',
      'replay_report',
      'legacy_local_reference'
    )),
  link_id TEXT,
  version_id TEXT,
  case_id TEXT,
  decision_id TEXT,
  replay_job_id TEXT,
  local_replay_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
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
  last_error_code TEXT,
  last_bounded_error TEXT,
  learning_plane_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_lp_gov_bridge_outbox_status
  ON lp_gov_bridge_outbox(status, next_attempt_at);

-- ---------------------------------------------------------------------------
-- Decision / replay-job inbox (HMAC deliveries)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lp_gov_bridge_inbox (
  inbox_id TEXT PRIMARY KEY NOT NULL,
  delivery_id TEXT NOT NULL,
  message_type TEXT NOT NULL,
  case_id TEXT,
  decision_id TEXT,
  replay_job_id TEXT,
  version_id TEXT,
  payload_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN (
      'received',
      'validated',
      'acknowledged',
      'conflict',
      'rejected',
      'processed'
    )),
  acknowledgement_id TEXT,
  bounded_diagnostic TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (delivery_id, message_type)
);

CREATE INDEX IF NOT EXISTS idx_lp_gov_bridge_inbox_status
  ON lp_gov_bridge_inbox(status, created_at);

-- ---------------------------------------------------------------------------
-- Local replay execution linked to LP jobs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lp_replay_bridge_runs (
  bridge_run_id TEXT PRIMARY KEY NOT NULL,
  replay_job_id TEXT NOT NULL UNIQUE,
  version_id TEXT NOT NULL,
  link_id TEXT,
  local_replay_artifact_id TEXT,
  manifest_id TEXT,
  manifest_sha256 TEXT,
  report_sha256 TEXT,
  execution_status TEXT NOT NULL DEFAULT 'accepted'
    CHECK (execution_status IN (
      'accepted',
      'running',
      'completed',
      'failed',
      'rejected_stale',
      'rejected_unsupported'
    )),
  verification_result TEXT
    CHECK (verification_result IS NULL OR verification_result IN (
      'eligible',
      'not_eligible',
      'inconclusive'
    )),
  lp_verification_id TEXT,
  bounded_diagnostic TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lp_replay_bridge_runs_version
  ON lp_replay_bridge_runs(version_id, execution_status);

-- ---------------------------------------------------------------------------
-- Grandfathered inventory publication state
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lp_legacy_local_registrations (
  registration_id TEXT PRIMARY KEY NOT NULL,
  local_rule_id TEXT NOT NULL,
  local_rule_version_id TEXT NOT NULL,
  local_lifecycle_status TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  typed_rule_key TEXT,
  activation_timestamp TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  lp_reference_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'published', 'failed', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (local_rule_id, local_rule_version_id)
);
