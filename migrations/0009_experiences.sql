-- Migration 0009: Agent experiences and evaluations (N1).

CREATE TABLE agent_experiences (
  experience_id            TEXT PRIMARY KEY,
  project_id               TEXT NOT NULL,
  request_id               TEXT NOT NULL,
  run_id                   TEXT NOT NULL UNIQUE,
  attempt                  INTEGER NOT NULL DEFAULT 1,
  correlation_id           TEXT,
  operation                TEXT NOT NULL,
  capability_key           TEXT,
  capability_version       TEXT,
  status                   TEXT NOT NULL,
  evidence_package_ids_json TEXT NOT NULL DEFAULT '[]',
  context_assembly_id      TEXT,
  input_artifact_ids_json  TEXT NOT NULL DEFAULT '[]',
  output_artifact_id       TEXT,
  token_input              INTEGER NOT NULL DEFAULT 0,
  token_output             INTEGER NOT NULL DEFAULT 0,
  cost_usd                 REAL NOT NULL DEFAULT 0,
  summary                  TEXT,
  provenance_incomplete    INTEGER NOT NULL DEFAULT 0,
  started_at               TEXT NOT NULL,
  completed_at             TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL
);

CREATE INDEX ix_experiences_project ON agent_experiences (project_id);
CREATE INDEX ix_experiences_request ON agent_experiences (request_id);
CREATE INDEX ix_experiences_status ON agent_experiences (status);

CREATE TABLE agent_evaluations (
  evaluation_id          TEXT PRIMARY KEY,
  experience_id          TEXT NOT NULL REFERENCES agent_experiences(experience_id),
  evaluator_type         TEXT NOT NULL,
  rubric_version         TEXT NOT NULL,
  decision               TEXT NOT NULL,
  scores_json            TEXT NOT NULL DEFAULT '{}',
  confidence             REAL,
  feedback_artifact_id   TEXT,
  source_system          TEXT NOT NULL,
  source_record_id       TEXT NOT NULL,
  created_at             TEXT NOT NULL,
  UNIQUE (
    experience_id,
    evaluator_type,
    rubric_version,
    source_system,
    source_record_id
  )
);

CREATE INDEX ix_evaluations_experience ON agent_evaluations (experience_id);
CREATE INDEX ix_evaluations_source ON agent_evaluations (source_system, source_record_id);
