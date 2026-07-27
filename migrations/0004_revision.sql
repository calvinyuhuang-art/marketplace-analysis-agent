-- Migration 0004: Revision linkage, finding supersession, learning events, run reviews.

ALTER TABLE analysis_runs ADD COLUMN prior_run_id TEXT REFERENCES analysis_runs(run_id);
ALTER TABLE analysis_runs ADD COLUMN revision_of_request_id TEXT;
ALTER TABLE analysis_runs ADD COLUMN affected_areas_json TEXT;

CREATE INDEX IF NOT EXISTS ix_runs_prior ON analysis_runs (prior_run_id);

ALTER TABLE analysis_findings ADD COLUMN supersedes_finding_id TEXT;
ALTER TABLE analysis_findings ADD COLUMN superseded_by_finding_id TEXT;

CREATE INDEX IF NOT EXISTS ix_findings_supersedes ON analysis_findings (supersedes_finding_id);

CREATE TABLE learning_events (
  learning_event_id   TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL,
  event_type          TEXT NOT NULL,
  reason_code         TEXT,
  notes               TEXT,
  source_run_id       TEXT,
  source_finding_id   TEXT,
  revision_run_id     TEXT,
  payload_json        TEXT NOT NULL DEFAULT '{}',
  promotion_status    TEXT NOT NULL DEFAULT 'recorded',
  created_at          TEXT NOT NULL
);

CREATE INDEX ix_learning_project ON learning_events (project_id);
CREATE INDEX ix_learning_run ON learning_events (source_run_id);
CREATE INDEX ix_learning_type ON learning_events (event_type);

CREATE TABLE run_reviews (
  review_id     TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES analysis_runs(run_id),
  action        TEXT NOT NULL,
  reason_code   TEXT,
  notes         TEXT,
  reviewer_id   TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE INDEX ix_run_reviews_run ON run_reviews (run_id);

CREATE TABLE revision_diffs (
  diff_id           TEXT PRIMARY KEY,
  prior_run_id      TEXT NOT NULL,
  revision_run_id   TEXT NOT NULL,
  artifact_id       TEXT,
  payload_json      TEXT NOT NULL,
  created_at        TEXT NOT NULL
);

CREATE INDEX ix_revision_diffs_revision ON revision_diffs (revision_run_id);
