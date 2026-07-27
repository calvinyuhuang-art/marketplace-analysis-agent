-- Migration 0005: Project memory, scopes, links, FTS5, retrieval and context assemblies.

CREATE TABLE memory_items (
  memory_id                     TEXT PRIMARY KEY,
  memory_type                   TEXT NOT NULL,
  authority_status              TEXT NOT NULL,
  title                         TEXT NOT NULL,
  statement                     TEXT NOT NULL,
  summary                       TEXT,
  confidence                    REAL NOT NULL DEFAULT 0.5,
  support_count                 INTEGER NOT NULL DEFAULT 0,
  contradiction_count           INTEGER NOT NULL DEFAULT 0,
  valid_from                    TEXT,
  valid_until                   TEXT,
  last_reaffirmed_at            TEXT,
  created_from_run_id           TEXT,
  created_from_learning_event_id TEXT,
  current_version_id            TEXT,
  payload_json                  TEXT NOT NULL DEFAULT '{}',
  created_at                    TEXT NOT NULL,
  updated_at                    TEXT NOT NULL
);

CREATE INDEX ix_memory_authority ON memory_items (authority_status);
CREATE INDEX ix_memory_type ON memory_items (memory_type);
CREATE INDEX ix_memory_run ON memory_items (created_from_run_id);

CREATE TABLE memory_scopes (
  memory_id TEXT NOT NULL REFERENCES memory_items(memory_id) ON DELETE CASCADE,
  dimension TEXT NOT NULL,
  value     TEXT NOT NULL,
  PRIMARY KEY (memory_id, dimension, value)
);

CREATE INDEX ix_memory_scopes_dim ON memory_scopes (dimension, value);

CREATE TABLE memory_evidence_links (
  memory_id    TEXT NOT NULL REFERENCES memory_items(memory_id) ON DELETE CASCADE,
  target_type  TEXT NOT NULL,
  target_id    TEXT NOT NULL,
  support_type TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (memory_id, target_type, target_id, support_type)
);

CREATE VIRTUAL TABLE memory_fts USING fts5(
  title,
  statement,
  summary,
  content='memory_items',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TABLE memory_versions (
  version_id   TEXT PRIMARY KEY,
  memory_id    TEXT NOT NULL REFERENCES memory_items(memory_id),
  version_no   INTEGER NOT NULL,
  change_reason TEXT,
  before_hash  TEXT,
  after_hash   TEXT NOT NULL,
  actor_type   TEXT NOT NULL,
  actor_id     TEXT NOT NULL,
  artifact_id  TEXT,
  created_at   TEXT NOT NULL
);

CREATE INDEX ix_memory_versions_memory ON memory_versions (memory_id);

CREATE TABLE context_assemblies (
  assembly_id   TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL,
  project_id    TEXT NOT NULL,
  token_budget  INTEGER NOT NULL,
  payload_json  TEXT NOT NULL,
  artifact_id   TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX ix_context_assemblies_run ON context_assemblies (run_id);

CREATE TABLE memory_retrieval_events (
  retrieval_event_id TEXT PRIMARY KEY,
  run_id             TEXT NOT NULL,
  project_id         TEXT NOT NULL,
  query              TEXT NOT NULL,
  filters_json       TEXT NOT NULL DEFAULT '{}',
  candidates_json    TEXT NOT NULL,
  selected_json      TEXT NOT NULL,
  context_assembly_id TEXT,
  created_at         TEXT NOT NULL
);

CREATE INDEX ix_memory_retrieval_run ON memory_retrieval_events (run_id);

CREATE TABLE memory_usage_events (
  usage_event_id TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL,
  memory_id      TEXT NOT NULL,
  usage_kind     TEXT NOT NULL,
  detail_json    TEXT,
  created_at     TEXT NOT NULL
);

CREATE INDEX ix_memory_usage_run ON memory_usage_events (run_id);
CREATE INDEX ix_memory_usage_memory ON memory_usage_events (memory_id);
