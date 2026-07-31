-- LP8-I5c: MAA Learning Plane published-knowledge bridge coordination.
-- Additive only. Canonical memory / Error Book / procedural tables remain local truth.
-- Feature flags default OFF in application config.
-- Discovery does not create references. Reference ≠ adoption. Publication never activates rules.

-- ---------------------------------------------------------------------------
-- Source publication proposals (outbox + LP projection)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lp_pk_publication_proposals (
  proposal_row_id TEXT PRIMARY KEY NOT NULL,
  source_memory_id TEXT,
  source_record_id TEXT NOT NULL,
  source_record_version TEXT NOT NULL,
  source_record_sha256 TEXT NOT NULL,
  knowledge_type TEXT NOT NULL
    CHECK (knowledge_type IN (
      'semantic_fact',
      'failure_pattern',
      'operational_warning',
      'procedural_guidance',
      'outcome_insight',
      'example_reference',
      'capability_limitation'
    )),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  requested_scope TEXT NOT NULL,
  authority TEXT NOT NULL,
  confidence REAL NOT NULL,
  payload_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  correlation_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft',
      'pending',
      'submitted',
      'approved',
      'rejected',
      'revision_requested',
      'conflict',
      'failed',
      'cancelled'
    )),
  lp_proposal_id TEXT,
  lp_case_id TEXT,
  lp_published_knowledge_id TEXT,
  lp_publication_package_id TEXT,
  package_sha256 TEXT,
  approved_scope TEXT,
  decision TEXT,
  decision_reason TEXT,
  last_error_code TEXT,
  last_bounded_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  submitted_at TEXT,
  reconciled_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_lp_pk_proposals_status
  ON lp_pk_publication_proposals(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_lp_pk_proposals_source
  ON lp_pk_publication_proposals(source_record_id, source_record_version);
CREATE INDEX IF NOT EXISTS idx_lp_pk_proposals_lp
  ON lp_pk_publication_proposals(lp_proposal_id);

-- ---------------------------------------------------------------------------
-- Discovery query records (not local references)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lp_pk_discovery_queries (
  discovery_query_id TEXT PRIMARY KEY NOT NULL,
  query_json TEXT NOT NULL,
  query_sha256 TEXT NOT NULL,
  lp_discovery_record_id TEXT,
  result_count INTEGER NOT NULL DEFAULT 0,
  result_ids_json TEXT NOT NULL DEFAULT '[]',
  notice TEXT,
  correlation_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lp_pk_discovery_created
  ON lp_pk_discovery_queries(created_at);

-- ---------------------------------------------------------------------------
-- Content-addressed bounded package cache
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lp_pk_package_cache (
  package_sha256 TEXT PRIMARY KEY NOT NULL,
  published_knowledge_id TEXT NOT NULL,
  publication_package_id TEXT NOT NULL,
  publication_version TEXT,
  source_agent_id TEXT NOT NULL,
  knowledge_type TEXT NOT NULL,
  body_json TEXT NOT NULL,
  meta_json TEXT NOT NULL,
  untrusted_content INTEGER NOT NULL DEFAULT 1 CHECK (untrusted_content = 1),
  fetched_at TEXT NOT NULL,
  byte_size INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lp_pk_cache_pub
  ON lp_pk_package_cache(published_knowledge_id);

-- ---------------------------------------------------------------------------
-- MAA-owned local references
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lp_pk_local_references (
  local_reference_id TEXT PRIMARY KEY NOT NULL,
  published_knowledge_id TEXT NOT NULL,
  publication_package_id TEXT,
  publication_version TEXT,
  package_sha256 TEXT NOT NULL,
  source_agent_id TEXT NOT NULL,
  knowledge_type TEXT NOT NULL,
  authority TEXT,
  applicability_json TEXT NOT NULL DEFAULT '[]',
  scope_snapshot TEXT,
  untrusted_content INTEGER NOT NULL DEFAULT 1 CHECK (untrusted_content = 1),
  discovered_at TEXT,
  reference_created_at TEXT NOT NULL,
  reference_origin TEXT NOT NULL DEFAULT 'manual'
    CHECK (reference_origin IN ('manual', 'subscription', 'operator', 'uat')),
  local_review_state TEXT NOT NULL DEFAULT 'pending_local_review'
    CHECK (local_review_state IN (
      'unreviewed',
      'pending_local_review',
      'eligible_for_retrieval',
      'disabled',
      'adopted_as_local_memory'
    )),
  local_retrieval_eligible INTEGER NOT NULL DEFAULT 0 CHECK (local_retrieval_eligible IN (0, 1)),
  lp_eligible INTEGER,
  lp_eligibility_json TEXT,
  lp_freshness_state TEXT,
  local_freshness_state TEXT,
  challenge_state TEXT,
  catalog_state TEXT,
  offline_grace_deadline TEXT,
  last_reconciled_at TEXT,
  last_used_at TEXT,
  use_count INTEGER NOT NULL DEFAULT 0,
  influence_count INTEGER NOT NULL DEFAULT 0,
  title TEXT,
  summary TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (published_knowledge_id, package_sha256)
);

CREATE INDEX IF NOT EXISTS idx_lp_pk_refs_eligible
  ON lp_pk_local_references(local_retrieval_eligible, local_review_state);
CREATE INDEX IF NOT EXISTS idx_lp_pk_refs_pub
  ON lp_pk_local_references(published_knowledge_id);

-- ---------------------------------------------------------------------------
-- Use / influence traces (local canonical; LP receipts are projections)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lp_pk_use_traces (
  use_trace_id TEXT PRIMARY KEY NOT NULL,
  local_reference_id TEXT NOT NULL,
  run_id TEXT,
  published_knowledge_id TEXT NOT NULL,
  package_sha256 TEXT NOT NULL,
  use_category TEXT NOT NULL,
  compatibility_context_hash TEXT,
  retrieval_rank INTEGER,
  offline_or_stale INTEGER NOT NULL DEFAULT 0 CHECK (offline_or_stale IN (0, 1)),
  created_at TEXT NOT NULL,
  receipt_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (receipt_status IN ('pending', 'published', 'failed', 'skipped')),
  FOREIGN KEY (local_reference_id) REFERENCES lp_pk_local_references(local_reference_id)
);

CREATE TABLE IF NOT EXISTS lp_pk_influence_traces (
  influence_trace_id TEXT PRIMARY KEY NOT NULL,
  local_reference_id TEXT NOT NULL,
  run_id TEXT,
  published_knowledge_id TEXT NOT NULL,
  package_sha256 TEXT NOT NULL,
  influence_category TEXT NOT NULL,
  bounded_rationale TEXT,
  local_candidate_or_proposal_ref TEXT,
  created_at TEXT NOT NULL,
  receipt_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (receipt_status IN ('pending', 'published', 'failed', 'skipped')),
  FOREIGN KEY (local_reference_id) REFERENCES lp_pk_local_references(local_reference_id)
);

CREATE INDEX IF NOT EXISTS idx_lp_pk_use_ref ON lp_pk_use_traces(local_reference_id, created_at);
CREATE INDEX IF NOT EXISTS idx_lp_pk_inf_ref ON lp_pk_influence_traces(local_reference_id, created_at);

-- ---------------------------------------------------------------------------
-- Challenges
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lp_pk_challenges (
  challenge_row_id TEXT PRIMARY KEY NOT NULL,
  local_reference_id TEXT,
  published_knowledge_id TEXT NOT NULL,
  challenge_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'submitted', 'open', 'resolved', 'failed', 'conflict')),
  lp_challenge_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reconciled_at TEXT
);

-- ---------------------------------------------------------------------------
-- Bridge outbox
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lp_pk_outbox (
  outbox_id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL
    CHECK (kind IN (
      'publication_proposal',
      'reference_receipt',
      'use_receipt',
      'influence_receipt',
      'challenge'
    )),
  related_id TEXT,
  published_knowledge_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',
      'claimed',
      'retry_scheduled',
      'published',
      'permanent_failure',
      'cancelled'
    )),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT,
  last_error_code TEXT,
  last_bounded_error TEXT,
  learning_plane_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_lp_pk_outbox_status
  ON lp_pk_outbox(status, next_attempt_at);
