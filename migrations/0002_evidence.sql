-- Migration 0002: Evidence packages, items, FTS, collection requests, run readiness.

CREATE TABLE evidence_packages (
  package_id              TEXT PRIMARY KEY,
  project_id              TEXT,
  external_work_order_id  TEXT,
  source_client           TEXT NOT NULL,
  schema_version          TEXT NOT NULL,
  platform                TEXT NOT NULL,
  marketplace             TEXT NOT NULL,
  category                TEXT,
  product_type            TEXT,
  status                  TEXT NOT NULL DEFAULT 'active',
  item_count              INTEGER NOT NULL DEFAULT 0,
  coverage_summary_json   TEXT NOT NULL DEFAULT '{}',
  diagnostics_json        TEXT,
  package_artifact_id     TEXT,
  content_hash            TEXT NOT NULL,
  observed_at             TEXT,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
);

CREATE INDEX ix_evidence_packages_project ON evidence_packages (project_id);

CREATE TABLE evidence_items (
  evidence_id              TEXT PRIMARY KEY,
  evidence_package_id      TEXT NOT NULL REFERENCES evidence_packages(package_id),
  source_type              TEXT NOT NULL,
  platform                 TEXT NOT NULL,
  marketplace              TEXT NOT NULL,
  category                 TEXT,
  product_type             TEXT,
  subject_id               TEXT NOT NULL,
  source_url               TEXT,
  observed_at              TEXT NOT NULL,
  collector                TEXT NOT NULL,
  collector_version        TEXT NOT NULL,
  confidence               REAL NOT NULL DEFAULT 1,
  title                    TEXT,
  text_content             TEXT,
  fields_json              TEXT NOT NULL DEFAULT '{}',
  provenance_json          TEXT NOT NULL,
  raw_snapshot_artifact_id TEXT,
  content_hash             TEXT NOT NULL,
  validation_status        TEXT NOT NULL DEFAULT 'valid',
  created_at               TEXT NOT NULL
);

CREATE INDEX ix_evidence_items_package ON evidence_items (evidence_package_id);
CREATE INDEX ix_evidence_items_subject ON evidence_items (subject_id);
CREATE INDEX ix_evidence_items_source_type ON evidence_items (source_type);

CREATE VIRTUAL TABLE evidence_fts USING fts5(
  title,
  text_content,
  subject_id,
  source_type,
  content='evidence_items',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TABLE evidence_package_links (
  request_id TEXT NOT NULL,
  package_id TEXT NOT NULL REFERENCES evidence_packages(package_id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (request_id, package_id)
);

CREATE TABLE collection_requests (
  collection_request_id TEXT PRIMARY KEY,
  run_id                TEXT,
  request_id            TEXT,
  request_type          TEXT NOT NULL DEFAULT 'supplemental_collection',
  status                TEXT NOT NULL DEFAULT 'proposed',
  priority              TEXT NOT NULL DEFAULT 'medium',
  platform              TEXT NOT NULL,
  marketplace           TEXT NOT NULL,
  target_set_json       TEXT NOT NULL DEFAULT '[]',
  required_evidence_json TEXT NOT NULL,
  reason                TEXT NOT NULL,
  analysis_areas_blocked_json TEXT NOT NULL DEFAULT '[]',
  completion_rule_json  TEXT NOT NULL DEFAULT '{}',
  suggested_collector_capability TEXT,
  payload_json          TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE INDEX ix_collection_requests_run ON collection_requests (run_id);

CREATE TABLE run_readiness (
  run_id            TEXT PRIMARY KEY,
  report_json       TEXT NOT NULL,
  overall_status    TEXT NOT NULL,
  artifact_id       TEXT,
  evaluated_at      TEXT NOT NULL
);
