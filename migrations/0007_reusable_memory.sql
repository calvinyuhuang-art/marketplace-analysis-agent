-- Migration 0007: Reusable memory proposals and governance.

CREATE TABLE memory_proposals (
  proposal_id           TEXT PRIMARY KEY,
  proposal_type         TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'proposed',
  project_id            TEXT NOT NULL,
  source_memory_id      TEXT,
  source_finding_id     TEXT,
  title                 TEXT NOT NULL,
  statement             TEXT NOT NULL,
  summary               TEXT,
  confidence            REAL NOT NULL DEFAULT 0.5,
  reason                TEXT NOT NULL,
  scopes_json           TEXT NOT NULL DEFAULT '[]',
  evidence_ids_json     TEXT NOT NULL DEFAULT '[]',
  conflicts_json        TEXT NOT NULL DEFAULT '[]',
  proposed_authority    TEXT NOT NULL DEFAULT 'reusable_approved',
  valid_until           TEXT,
  resulting_memory_id   TEXT,
  proposed_by           TEXT NOT NULL,
  reviewed_by           TEXT,
  reviewed_at           TEXT,
  review_notes          TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE INDEX ix_memory_proposals_status ON memory_proposals (status);
CREATE INDEX ix_memory_proposals_project ON memory_proposals (project_id);
CREATE INDEX ix_memory_proposals_source_memory ON memory_proposals (source_memory_id);
