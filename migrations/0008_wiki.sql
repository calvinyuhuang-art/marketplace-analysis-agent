-- Migration 0008: Governed wiki pages, versions, proposals, and lint issues.

CREATE TABLE wiki_pages (
  page_id             TEXT PRIMARY KEY,
  slug                TEXT NOT NULL UNIQUE,
  title               TEXT NOT NULL,
  parent_page_id      TEXT REFERENCES wiki_pages(page_id),
  path                TEXT NOT NULL UNIQUE,
  status              TEXT NOT NULL DEFAULT 'draft',
  current_version_id  TEXT,
  scope_json          TEXT NOT NULL DEFAULT '{}',
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX ix_wiki_pages_parent ON wiki_pages (parent_page_id);
CREATE INDEX ix_wiki_pages_status ON wiki_pages (status);

CREATE TABLE wiki_page_versions (
  version_id          TEXT PRIMARY KEY,
  page_id             TEXT NOT NULL REFERENCES wiki_pages(page_id),
  version_no          INTEGER NOT NULL,
  content_markdown    TEXT NOT NULL,
  sections_json       TEXT NOT NULL DEFAULT '[]',
  source_memory_ids_json TEXT NOT NULL DEFAULT '[]',
  change_reason       TEXT,
  created_by          TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  UNIQUE (page_id, version_no)
);

CREATE INDEX ix_wiki_versions_page ON wiki_page_versions (page_id);

CREATE TABLE wiki_source_links (
  page_id     TEXT NOT NULL,
  version_id  TEXT NOT NULL,
  memory_id   TEXT NOT NULL,
  support_type TEXT NOT NULL DEFAULT 'supports',
  created_at  TEXT NOT NULL,
  PRIMARY KEY (version_id, memory_id)
);

CREATE INDEX ix_wiki_source_page ON wiki_source_links (page_id);
CREATE INDEX ix_wiki_source_memory ON wiki_source_links (memory_id);

CREATE TABLE wiki_update_proposals (
  proposal_id                 TEXT PRIMARY KEY,
  page_id                     TEXT NOT NULL REFERENCES wiki_pages(page_id),
  from_version_id             TEXT,
  status                      TEXT NOT NULL DEFAULT 'proposed',
  title                       TEXT NOT NULL,
  proposed_content_markdown   TEXT NOT NULL,
  proposed_sections_json      TEXT NOT NULL DEFAULT '[]',
  proposed_source_memory_ids_json TEXT NOT NULL DEFAULT '[]',
  change_reason               TEXT NOT NULL,
  lint_issues_json            TEXT NOT NULL DEFAULT '[]',
  resulting_version_id        TEXT,
  created_by                  TEXT NOT NULL,
  reviewed_by                 TEXT,
  reviewed_at                 TEXT,
  review_notes                TEXT,
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL
);

CREATE INDEX ix_wiki_proposals_status ON wiki_update_proposals (status);
CREATE INDEX ix_wiki_proposals_page ON wiki_update_proposals (page_id);

CREATE TABLE wiki_lint_issues (
  issue_id    TEXT PRIMARY KEY,
  code        TEXT NOT NULL,
  severity    TEXT NOT NULL,
  message     TEXT NOT NULL,
  page_id     TEXT,
  path        TEXT,
  memory_id   TEXT,
  run_id      TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX ix_wiki_lint_page ON wiki_lint_issues (page_id);
CREATE INDEX ix_wiki_lint_code ON wiki_lint_issues (code);
