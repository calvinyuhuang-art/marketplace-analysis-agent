-- Migration 0003: Findings, analysis outputs, model calls, finding reviews.

CREATE TABLE analysis_findings (
  finding_id         TEXT PRIMARY KEY,
  run_id             TEXT NOT NULL REFERENCES analysis_runs(run_id),
  analysis_area      TEXT NOT NULL,
  classification     TEXT NOT NULL,
  statement          TEXT NOT NULL,
  confidence         REAL NOT NULL,
  validation_status  TEXT NOT NULL DEFAULT 'unreviewed',
  scope_key          TEXT,
  freshness_status   TEXT,
  payload_json       TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE INDEX ix_findings_run ON analysis_findings (run_id);
CREATE INDEX ix_findings_area ON analysis_findings (analysis_area);
CREATE INDEX ix_findings_validation ON analysis_findings (validation_status);

CREATE TABLE analysis_outputs (
  output_id      TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL REFERENCES analysis_runs(run_id),
  output_type    TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  artifact_id    TEXT,
  content_hash   TEXT NOT NULL,
  quality_score  REAL,
  quality_passed INTEGER NOT NULL DEFAULT 0,
  payload_json   TEXT NOT NULL,
  created_at     TEXT NOT NULL
);

CREATE INDEX ix_outputs_run ON analysis_outputs (run_id);

CREATE TABLE model_calls (
  model_call_id       TEXT PRIMARY KEY,
  run_id              TEXT REFERENCES analysis_runs(run_id),
  request_id          TEXT,
  correlation_id      TEXT,
  provider            TEXT NOT NULL,
  model               TEXT NOT NULL,
  purpose             TEXT NOT NULL,
  fixture_key         TEXT,
  prompt_version      TEXT,
  schema_version      TEXT,
  status              TEXT NOT NULL,
  input_artifact_id   TEXT,
  output_artifact_id  TEXT,
  token_input         INTEGER NOT NULL DEFAULT 0,
  token_output        INTEGER NOT NULL DEFAULT 0,
  cost_usd            REAL NOT NULL DEFAULT 0,
  latency_ms          INTEGER NOT NULL DEFAULT 0,
  validation_errors_json TEXT,
  repair_attempt      INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  completed_at        TEXT
);

CREATE INDEX ix_model_calls_run ON model_calls (run_id);

CREATE TABLE finding_reviews (
  review_id    TEXT PRIMARY KEY,
  finding_id   TEXT NOT NULL REFERENCES analysis_findings(finding_id),
  run_id       TEXT NOT NULL,
  action       TEXT NOT NULL,
  reason_code  TEXT,
  notes        TEXT,
  reviewer_id  TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE INDEX ix_finding_reviews_finding ON finding_reviews (finding_id);
