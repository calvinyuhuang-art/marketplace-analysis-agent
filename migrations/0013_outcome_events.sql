-- Migration 0013: Real-world outcome events and reassessments (N5).

CREATE TABLE outcome_events (
  outcome_id                  TEXT PRIMARY KEY,
  project_id                  TEXT NOT NULL,
  event_type                  TEXT NOT NULL,
  measurement_window_json     TEXT NOT NULL DEFAULT '{}',
  metrics_json                TEXT NOT NULL DEFAULT '{}',
  source                      TEXT NOT NULL,
  confidence                  REAL,
  linked_artifact_ids_json    TEXT NOT NULL DEFAULT '[]',
  linked_finding_ids_json     TEXT NOT NULL DEFAULT '[]',
  linked_experience_id        TEXT,
  linked_run_id               TEXT,
  occurred_at                 TEXT NOT NULL,
  received_at                 TEXT NOT NULL,
  created_at                  TEXT NOT NULL
);

CREATE INDEX idx_outcome_events_project ON outcome_events(project_id);
CREATE INDEX idx_outcome_events_run ON outcome_events(linked_run_id);
CREATE INDEX idx_outcome_events_experience ON outcome_events(linked_experience_id);

CREATE TABLE outcome_reassessments (
  reassessment_id             TEXT PRIMARY KEY,
  outcome_id                  TEXT NOT NULL,
  experience_id               TEXT,
  run_id                      TEXT,
  judgments_json              TEXT NOT NULL,
  report_artifact_id          TEXT NOT NULL,
  lesson_candidate_ids_json   TEXT NOT NULL DEFAULT '[]',
  created_at                  TEXT NOT NULL,
  FOREIGN KEY (outcome_id) REFERENCES outcome_events(outcome_id)
);

CREATE INDEX idx_outcome_reassessments_outcome ON outcome_reassessments(outcome_id);
CREATE INDEX idx_outcome_reassessments_run ON outcome_reassessments(run_id);

ALTER TABLE analysis_requests ADD COLUMN outcome_id TEXT;
