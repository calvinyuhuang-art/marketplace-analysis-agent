-- Migration 0006: Outcome reviews, lesson candidates, Error Book, procedural rules, memory evaluations.

CREATE TABLE outcome_reviews (
  outcome_review_id   TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL,
  run_id              TEXT NOT NULL,
  judgment            TEXT NOT NULL,
  notes               TEXT,
  reviewer_id         TEXT NOT NULL,
  lesson_candidate_id TEXT,
  created_at          TEXT NOT NULL
);

CREATE INDEX ix_outcome_reviews_run ON outcome_reviews (run_id);
CREATE INDEX ix_outcome_reviews_project ON outcome_reviews (project_id);

CREATE TABLE lesson_candidates (
  lesson_candidate_id   TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL,
  learning_event_id     TEXT,
  source_run_id         TEXT,
  source_finding_id     TEXT,
  action_taken          TEXT NOT NULL,
  observed_outcome      TEXT NOT NULL,
  reviewer_judgment     TEXT NOT NULL,
  proposed_root_cause   TEXT NOT NULL,
  corrective_action     TEXT NOT NULL,
  scope_json            TEXT NOT NULL DEFAULT '{}',
  analysis_areas_json   TEXT NOT NULL DEFAULT '[]',
  cause_confidence      REAL NOT NULL DEFAULT 0.5,
  support_count         INTEGER NOT NULL DEFAULT 1,
  status                TEXT NOT NULL DEFAULT 'proposed',
  error_book_entry_id   TEXT,
  procedural_rule_id    TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE INDEX ix_lesson_project ON lesson_candidates (project_id);
CREATE INDEX ix_lesson_status ON lesson_candidates (status);
CREATE INDEX ix_lesson_finding ON lesson_candidates (source_finding_id);

CREATE TABLE error_book_entries (
  error_book_entry_id           TEXT PRIMARY KEY,
  error_class                   TEXT NOT NULL,
  title                         TEXT NOT NULL,
  unsafe_behavior_pattern       TEXT NOT NULL,
  context                       TEXT NOT NULL,
  root_cause                    TEXT NOT NULL,
  correction                    TEXT NOT NULL,
  severity                      TEXT NOT NULL DEFAULT 'medium',
  occurrence_count              INTEGER NOT NULL DEFAULT 1,
  last_occurrence_at            TEXT NOT NULL,
  recurrence_status             TEXT NOT NULL DEFAULT 'first_seen',
  project_id                    TEXT,
  platform                      TEXT,
  marketplace                   TEXT,
  category                      TEXT,
  product_type                  TEXT,
  analysis_areas_json           TEXT NOT NULL DEFAULT '[]',
  affected_capability_versions_json TEXT NOT NULL DEFAULT '[]',
  regression_test_ids_json      TEXT NOT NULL DEFAULT '[]',
  linked_learning_event_ids_json TEXT NOT NULL DEFAULT '[]',
  linked_procedural_rule_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at                    TEXT NOT NULL,
  updated_at                    TEXT NOT NULL
);

CREATE INDEX ix_error_book_class ON error_book_entries (error_class);
CREATE INDEX ix_error_book_project ON error_book_entries (project_id);
CREATE INDEX ix_error_book_recurrence ON error_book_entries (recurrence_status);

CREATE TABLE procedural_rules (
  procedural_rule_id              TEXT PRIMARY KEY,
  version                         INTEGER NOT NULL DEFAULT 1,
  title                           TEXT NOT NULL,
  statement                       TEXT NOT NULL,
  status                          TEXT NOT NULL DEFAULT 'proposed',
  authority                       TEXT NOT NULL DEFAULT 'procedural_proposed',
  analysis_areas_json             TEXT NOT NULL DEFAULT '[]',
  platform                        TEXT,
  marketplace                     TEXT,
  category                        TEXT,
  product_type                    TEXT,
  project_id                      TEXT,
  error_book_entry_id             TEXT,
  lesson_candidate_id             TEXT,
  learning_event_ids_json         TEXT NOT NULL DEFAULT '[]',
  regression_test_ids_json        TEXT NOT NULL DEFAULT '[]',
  require_direct_customer_evidence INTEGER NOT NULL DEFAULT 0,
  approved_by                     TEXT,
  approved_at                     TEXT,
  created_at                      TEXT NOT NULL,
  updated_at                      TEXT NOT NULL
);

CREATE INDEX ix_procedural_status ON procedural_rules (status);
CREATE INDEX ix_procedural_project ON procedural_rules (project_id);
CREATE INDEX ix_procedural_error_book ON procedural_rules (error_book_entry_id);

CREATE TABLE memory_evaluations (
  evaluation_id   TEXT PRIMARY KEY,
  memory_id       TEXT NOT NULL,
  project_id      TEXT NOT NULL,
  run_id          TEXT,
  judgment        TEXT NOT NULL,
  notes           TEXT,
  reviewer_id     TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE INDEX ix_memory_eval_memory ON memory_evaluations (memory_id);
CREATE INDEX ix_memory_eval_project ON memory_evaluations (project_id);
