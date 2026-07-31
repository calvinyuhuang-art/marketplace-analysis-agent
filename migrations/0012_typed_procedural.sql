-- Migration 0012: Typed procedural rule definitions / versions / activations (N4).

CREATE TABLE procedural_rule_definitions (
  rule_id     TEXT PRIMARY KEY,
  rule_type   TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE procedural_rule_versions (
  version_id                  TEXT PRIMARY KEY,
  rule_id                     TEXT NOT NULL,
  version_number              INTEGER NOT NULL,
  params_json                 TEXT NOT NULL,
  policy_hash                 TEXT NOT NULL,
  lifecycle_status            TEXT NOT NULL,
  replay_report_artifact_id   TEXT,
  approved_by                 TEXT,
  approved_at                 TEXT,
  created_by                  TEXT NOT NULL,
  created_at                  TEXT NOT NULL,
  UNIQUE (rule_id, version_number),
  FOREIGN KEY (rule_id) REFERENCES procedural_rule_definitions(rule_id)
);

CREATE INDEX idx_procedural_rule_versions_rule ON procedural_rule_versions(rule_id);

CREATE TABLE procedural_rule_activations (
  activation_id             TEXT PRIMARY KEY,
  version_id                TEXT NOT NULL,
  action                    TEXT NOT NULL,
  actor_id                  TEXT NOT NULL,
  reason                    TEXT,
  replaces_activation_id    TEXT,
  created_at                TEXT NOT NULL,
  FOREIGN KEY (version_id) REFERENCES procedural_rule_versions(version_id)
);

CREATE INDEX idx_procedural_rule_activations_version
  ON procedural_rule_activations(version_id);
CREATE INDEX idx_procedural_rule_activations_created
  ON procedural_rule_activations(created_at);

-- Seed typed definitions + bridge require_direct_customer_evidence v1 (active).
INSERT INTO procedural_rule_definitions (rule_id, rule_type, title, created_at)
VALUES
  (
    'prdef_require_direct_customer_evidence',
    'require_direct_customer_evidence',
    'Require direct customer evidence',
    '2026-07-28T00:00:00.000Z'
  ),
  (
    'prdef_require_format_normalization_for_pricing',
    'require_format_normalization_for_pricing',
    'Require format/binding normalization for pricing',
    '2026-07-28T00:00:00.000Z'
  );

INSERT INTO procedural_rule_versions (
  version_id, rule_id, version_number, params_json, policy_hash,
  lifecycle_status, replay_report_artifact_id, approved_by, approved_at,
  created_by, created_at
) VALUES (
  'prver_rdce_v1',
  'prdef_require_direct_customer_evidence',
  1,
  '{"requireDirectCustomerEvidence":true}',
  '330c26688523c4db160bec96b7c95aa2702ae0af6d0e2ce9825d49773d83ef6d',
  'approved',
  NULL,
  'maa-migration-0012',
  '2026-07-28T00:00:00.000Z',
  'maa-migration-0012',
  '2026-07-28T00:00:00.000Z'
);

INSERT INTO procedural_rule_activations (
  activation_id, version_id, action, actor_id, reason, replaces_activation_id, created_at
) VALUES (
  'pract_rdce_v1_activate',
  'prver_rdce_v1',
  'activate',
  'maa-migration-0012',
  'Bridge legacy requireDirectCustomerEvidence into typed version v1',
  NULL,
  '2026-07-28T00:00:00.000Z'
);
