-- Migration 0011: Workflow feedback events and gap fingerprints (N3).

CREATE TABLE gap_fingerprints (
  fingerprint_id          TEXT PRIMARY KEY,
  fingerprint_key         TEXT NOT NULL UNIQUE,
  fingerprint_version     TEXT NOT NULL,
  components_json         TEXT NOT NULL,
  project_id              TEXT NOT NULL,
  first_seen_at           TEXT NOT NULL,
  last_seen_at            TEXT NOT NULL,
  distinct_run_count      INTEGER NOT NULL DEFAULT 1,
  distinct_project_count  INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_gap_fingerprints_project ON gap_fingerprints(project_id);

CREATE TABLE workflow_feedback_events (
  workflow_feedback_id                      TEXT PRIMARY KEY,
  status                                    TEXT NOT NULL,
  project_id                                TEXT NOT NULL,
  run_id                                    TEXT NOT NULL,
  request_id                                TEXT NOT NULL,
  experience_id                             TEXT,
  external_work_order_id                    TEXT,
  correlation_id                            TEXT,
  source_agent_id                           TEXT NOT NULL,
  discovering_agent_id                      TEXT NOT NULL,
  upstream_step_key                         TEXT NOT NULL,
  downstream_step_key                       TEXT NOT NULL,
  feedback_type                             TEXT NOT NULL,
  gap_fingerprint_id                        TEXT NOT NULL,
  missing_requirement_json                  TEXT NOT NULL,
  original_artifact_ids_json                TEXT NOT NULL DEFAULT '[]',
  collection_request_ids_json               TEXT NOT NULL DEFAULT '[]',
  resolution_action                         TEXT,
  supplemental_evidence_package_ids_json    TEXT NOT NULL DEFAULT '[]',
  revision_run_id                           TEXT,
  resolution_quality                        TEXT,
  resolved                                  INTEGER,
  added_duration_ms                         INTEGER,
  added_cost_usd                            REAL,
  added_collection_rounds                   INTEGER,
  candidate_lesson_status                   TEXT NOT NULL DEFAULT 'none',
  report_artifact_id                        TEXT,
  detected_at                               TEXT NOT NULL,
  updated_at                                TEXT NOT NULL,
  resolved_at                               TEXT,
  FOREIGN KEY (gap_fingerprint_id) REFERENCES gap_fingerprints(fingerprint_id)
);

CREATE UNIQUE INDEX idx_workflow_feedback_run_detect
  ON workflow_feedback_events(run_id, feedback_type);
CREATE INDEX idx_workflow_feedback_project ON workflow_feedback_events(project_id);
CREATE INDEX idx_workflow_feedback_status ON workflow_feedback_events(status);
CREATE INDEX idx_workflow_feedback_fingerprint ON workflow_feedback_events(gap_fingerprint_id);
