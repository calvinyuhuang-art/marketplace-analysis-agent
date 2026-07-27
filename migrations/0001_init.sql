-- Migration 0001: M0 foundation schema.
-- Core execution, artifact, audit, model-profile, locking, and idempotency
-- tables. Later milestones add evidence, findings, memory, and wiki tables.

-- Projects -------------------------------------------------------------------
CREATE TABLE analysis_projects (
  project_id           TEXT PRIMARY KEY,
  external_project_id  TEXT,
  name                 TEXT NOT NULL,
  platform             TEXT NOT NULL,
  marketplace          TEXT NOT NULL,
  category             TEXT NOT NULL,
  product_type         TEXT NOT NULL,
  product_context_json TEXT NOT NULL DEFAULT '{}',
  status               TEXT NOT NULL DEFAULT 'active',
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

-- Requests -------------------------------------------------------------------
CREATE TABLE analysis_requests (
  request_id                  TEXT PRIMARY KEY,
  project_id                  TEXT NOT NULL REFERENCES analysis_projects(project_id),
  client                      TEXT NOT NULL,
  client_request_id           TEXT,
  external_work_order_id      TEXT,
  operation                   TEXT NOT NULL,
  requested_analysis_json     TEXT NOT NULL DEFAULT '[]',
  question                    TEXT,
  capability_id               TEXT,
  capability_version          TEXT,
  model_profile_id            TEXT,
  request_payload_artifact_id TEXT,
  idempotency_key             TEXT,
  request_hash                TEXT,
  status                      TEXT NOT NULL DEFAULT 'accepted',
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL
);

-- Scoped idempotency uniqueness (client + idempotency_key).
CREATE UNIQUE INDEX ux_requests_idempotency
  ON analysis_requests (client, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX ix_requests_project ON analysis_requests (project_id);

-- Runs -----------------------------------------------------------------------
CREATE TABLE analysis_runs (
  run_id             TEXT PRIMARY KEY,
  request_id         TEXT NOT NULL REFERENCES analysis_requests(request_id),
  attempt_number     INTEGER NOT NULL DEFAULT 1,
  status             TEXT NOT NULL DEFAULT 'accepted',
  current_phase      TEXT,
  execution_id       TEXT,
  correlation_id     TEXT,
  provider           TEXT,
  model              TEXT,
  prompt_version     TEXT,
  capability_version TEXT,
  started_at         TEXT,
  heartbeat_at       TEXT,
  completed_at       TEXT,
  timeout_at         TEXT,
  cancel_requested_at TEXT,
  failure_code       TEXT,
  failure_message    TEXT,
  token_input        INTEGER NOT NULL DEFAULT 0,
  token_output       INTEGER NOT NULL DEFAULT 0,
  cost_usd           REAL NOT NULL DEFAULT 0,
  output_artifact_id TEXT,
  quality_score      REAL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE INDEX ix_runs_request ON analysis_runs (request_id);
CREATE INDEX ix_runs_status ON analysis_runs (status);

-- Run events (state transitions, phase changes, notable runtime events) ------
CREATE TABLE run_events (
  event_id       TEXT PRIMARY KEY,
  run_id         TEXT REFERENCES analysis_runs(run_id),
  request_id     TEXT REFERENCES analysis_requests(request_id),
  correlation_id TEXT,
  event_type     TEXT NOT NULL,
  phase          TEXT,
  from_status    TEXT,
  to_status      TEXT,
  detail_json    TEXT,
  created_at     TEXT NOT NULL
);

CREATE INDEX ix_run_events_run ON run_events (run_id);

-- Artifacts ------------------------------------------------------------------
CREATE TABLE artifacts (
  artifact_id           TEXT PRIMARY KEY,
  relative_path         TEXT NOT NULL,
  content_hash          TEXT NOT NULL,
  mime_type             TEXT NOT NULL,
  size_bytes            INTEGER NOT NULL,
  redaction_status      TEXT NOT NULL DEFAULT 'none',
  access_class          TEXT NOT NULL DEFAULT 'internal',
  related_request_id    TEXT,
  related_run_id        TEXT,
  related_model_call_id TEXT,
  created_at            TEXT NOT NULL
);

CREATE INDEX ix_artifacts_run ON artifacts (related_run_id);

-- Audit events (append-only, with optional SHA-256 hash chain) ----------------
CREATE TABLE audit_events (
  event_id          TEXT PRIMARY KEY,
  previous_hash     TEXT,
  event_hash        TEXT NOT NULL,
  actor_type        TEXT NOT NULL,
  actor_id          TEXT NOT NULL,
  action            TEXT NOT NULL,
  target_type       TEXT,
  target_id         TEXT,
  before_state_json TEXT,
  after_state_json  TEXT,
  artifact_refs_json TEXT,
  correlation_id    TEXT,
  request_id        TEXT,
  run_id            TEXT,
  created_at        TEXT NOT NULL
);

CREATE INDEX ix_audit_run ON audit_events (run_id);
CREATE INDEX ix_audit_correlation ON audit_events (correlation_id);

-- Model profiles -------------------------------------------------------------
CREATE TABLE settings_model_profiles (
  profile_id          TEXT PRIMARY KEY,
  provider            TEXT NOT NULL,
  model               TEXT NOT NULL,
  enabled             INTEGER NOT NULL DEFAULT 0,
  temperature         REAL NOT NULL DEFAULT 0,
  token_cap           INTEGER,
  cost_cap_usd        REAL,
  timeout_seconds     INTEGER NOT NULL DEFAULT 300,
  fallback_profile_id TEXT,
  description         TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

-- Execution locks (single-owner durable execution) ---------------------------
CREATE TABLE execution_locks (
  lock_key        TEXT PRIMARY KEY,
  run_id          TEXT,
  execution_id    TEXT,
  owner_instance  TEXT,
  acquired_at     TEXT,
  lease_expires_at TEXT,
  heartbeat_at    TEXT,
  released_at     TEXT,
  status          TEXT NOT NULL DEFAULT 'free'
);

-- Idempotency records --------------------------------------------------------
CREATE TABLE idempotency_records (
  idempotency_key TEXT NOT NULL,
  client          TEXT NOT NULL,
  request_id      TEXT,
  run_id          TEXT,
  request_hash    TEXT,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (client, idempotency_key)
);
