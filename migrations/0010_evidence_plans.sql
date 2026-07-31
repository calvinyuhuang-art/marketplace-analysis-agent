-- Migration 0010: Evidence plans and plan reviews (N2).

CREATE TABLE evidence_plans (
  plan_id                                        TEXT NOT NULL,
  plan_version                                   INTEGER NOT NULL,
  project_id                                     TEXT NOT NULL,
  client                                         TEXT NOT NULL,
  status                                         TEXT NOT NULL,
  requested_analysis_json                        TEXT NOT NULL,
  required_fields_json                           TEXT NOT NULL,
  budget_json                                    TEXT,
  capability_json                                TEXT NOT NULL,
  collector_capability_snapshot_artifact_id      TEXT NOT NULL,
  collector_capability_snapshot_hash             TEXT NOT NULL,
  notes                                          TEXT,
  created_at                                     TEXT NOT NULL,
  updated_at                                     TEXT NOT NULL,
  PRIMARY KEY (plan_id, plan_version)
);

CREATE INDEX idx_evidence_plans_project ON evidence_plans(project_id);
CREATE INDEX idx_evidence_plans_snapshot
  ON evidence_plans(collector_capability_snapshot_artifact_id);

CREATE TABLE evidence_plan_reviews (
  review_id                                      TEXT PRIMARY KEY,
  plan_id                                        TEXT NOT NULL,
  plan_version                                   INTEGER NOT NULL,
  run_id                                         TEXT,
  decision                                       TEXT NOT NULL,
  collector_capability_snapshot_artifact_id      TEXT NOT NULL,
  collector_capability_snapshot_hash             TEXT NOT NULL,
  report_json                                    TEXT NOT NULL,
  report_artifact_id                             TEXT,
  created_at                                     TEXT NOT NULL,
  FOREIGN KEY (plan_id, plan_version)
    REFERENCES evidence_plans(plan_id, plan_version)
);

CREATE INDEX idx_evidence_plan_reviews_plan
  ON evidence_plan_reviews(plan_id, plan_version);
CREATE INDEX idx_evidence_plan_reviews_run ON evidence_plan_reviews(run_id);

ALTER TABLE analysis_requests ADD COLUMN evidence_plan_id TEXT;
ALTER TABLE analysis_requests ADD COLUMN evidence_plan_version INTEGER;
