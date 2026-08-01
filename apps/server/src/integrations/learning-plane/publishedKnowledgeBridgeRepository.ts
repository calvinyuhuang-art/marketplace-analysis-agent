import { createHash, randomBytes } from "node:crypto";
import type { SqliteDatabase } from "@maa/database";

export function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function sha256Json(value: unknown): string {
  return sha256Text(JSON.stringify(value));
}

export function newPkId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

export type PkProposalRow = {
  proposal_row_id: string;
  source_memory_id: string | null;
  source_record_id: string;
  source_record_version: string;
  source_record_sha256: string;
  knowledge_type: string;
  title: string;
  summary: string;
  requested_scope: string;
  authority: string;
  confidence: number;
  payload_json: string;
  payload_sha256: string;
  idempotency_key: string;
  correlation_id: string | null;
  status: string;
  lp_proposal_id: string | null;
  lp_case_id: string | null;
  lp_published_knowledge_id: string | null;
  lp_publication_package_id: string | null;
  package_sha256: string | null;
  approved_scope: string | null;
  decision: string | null;
  decision_reason: string | null;
  last_error_code: string | null;
  last_bounded_error: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  reconciled_at: string | null;
};

export type PkLocalReferenceRow = {
  local_reference_id: string;
  published_knowledge_id: string;
  publication_package_id: string | null;
  publication_version: string | null;
  package_sha256: string;
  source_agent_id: string;
  knowledge_type: string;
  authority: string | null;
  applicability_json: string;
  scope_snapshot: string | null;
  untrusted_content: number;
  discovered_at: string | null;
  reference_created_at: string;
  reference_origin: string;
  local_review_state: string;
  local_retrieval_eligible: number;
  lp_eligible: number | null;
  lp_eligibility_json: string | null;
  lp_freshness_state: string | null;
  local_freshness_state: string | null;
  challenge_state: string | null;
  catalog_state: string | null;
  offline_grace_deadline: string | null;
  last_reconciled_at: string | null;
  last_used_at: string | null;
  use_count: number;
  influence_count: number;
  title: string | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
};

export type PkOutboxRow = {
  outbox_id: string;
  kind: string;
  related_id: string | null;
  published_knowledge_id: string | null;
  idempotency_key: string;
  payload_json: string;
  payload_sha256: string;
  status: string;
  attempt_count: number;
  next_attempt_at: string | null;
  last_error_code: string | null;
  last_bounded_error: string | null;
  learning_plane_ref: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

export class PublishedKnowledgeBridgeRepository {
  constructor(private readonly db: SqliteDatabase) {}

  tablesPresent(): boolean {
    try {
      this.db.prepare(`SELECT 1 FROM lp_pk_publication_proposals LIMIT 1`).get();
      return true;
    } catch {
      return false;
    }
  }

  insertProposal(row: Omit<PkProposalRow, never>): void {
    this.db
      .prepare(
        `INSERT INTO lp_pk_publication_proposals (
          proposal_row_id, source_memory_id, source_record_id, source_record_version,
          source_record_sha256, knowledge_type, title, summary, requested_scope, authority,
          confidence, payload_json, payload_sha256, idempotency_key, correlation_id, status,
          lp_proposal_id, lp_case_id, lp_published_knowledge_id, lp_publication_package_id,
          package_sha256, approved_scope, decision, decision_reason, last_error_code,
          last_bounded_error, created_at, updated_at, submitted_at, reconciled_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.proposal_row_id,
        row.source_memory_id,
        row.source_record_id,
        row.source_record_version,
        row.source_record_sha256,
        row.knowledge_type,
        row.title,
        row.summary,
        row.requested_scope,
        row.authority,
        row.confidence,
        row.payload_json,
        row.payload_sha256,
        row.idempotency_key,
        row.correlation_id,
        row.status,
        row.lp_proposal_id,
        row.lp_case_id,
        row.lp_published_knowledge_id,
        row.lp_publication_package_id,
        row.package_sha256,
        row.approved_scope,
        row.decision,
        row.decision_reason,
        row.last_error_code,
        row.last_bounded_error,
        row.created_at,
        row.updated_at,
        row.submitted_at,
        row.reconciled_at
      );
  }

  getProposalByIdempotency(key: string): PkProposalRow | undefined {
    return this.db
      .prepare(`SELECT * FROM lp_pk_publication_proposals WHERE idempotency_key = ?`)
      .get(key) as PkProposalRow | undefined;
  }

  getProposal(id: string): PkProposalRow | undefined {
    return this.db
      .prepare(`SELECT * FROM lp_pk_publication_proposals WHERE proposal_row_id = ?`)
      .get(id) as PkProposalRow | undefined;
  }

  listProposals(limit = 100): PkProposalRow[] {
    return this.db
      .prepare(
        `SELECT * FROM lp_pk_publication_proposals ORDER BY created_at DESC LIMIT ?`
      )
      .all(limit) as PkProposalRow[];
  }

  updateProposal(id: string, patch: Partial<PkProposalRow>): void {
    const existing = this.getProposal(id);
    if (!existing) return;
    const next = { ...existing, ...patch, updated_at: new Date().toISOString() };
    this.db
      .prepare(
        `UPDATE lp_pk_publication_proposals SET
          status = ?, lp_proposal_id = ?, lp_case_id = ?, lp_published_knowledge_id = ?,
          lp_publication_package_id = ?, package_sha256 = ?, approved_scope = ?, decision = ?,
          decision_reason = ?, last_error_code = ?, last_bounded_error = ?, updated_at = ?,
          submitted_at = ?, reconciled_at = ?
         WHERE proposal_row_id = ?`
      )
      .run(
        next.status,
        next.lp_proposal_id,
        next.lp_case_id,
        next.lp_published_knowledge_id,
        next.lp_publication_package_id,
        next.package_sha256,
        next.approved_scope,
        next.decision,
        next.decision_reason,
        next.last_error_code,
        next.last_bounded_error,
        next.updated_at,
        next.submitted_at,
        next.reconciled_at,
        id
      );
  }

  insertDiscovery(input: {
    discovery_query_id: string;
    query_json: string;
    query_sha256: string;
    lp_discovery_record_id: string | null;
    result_count: number;
    result_ids_json: string;
    notice: string | null;
    correlation_id: string | null;
    created_at: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO lp_pk_discovery_queries (
          discovery_query_id, query_json, query_sha256, lp_discovery_record_id,
          result_count, result_ids_json, notice, correlation_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.discovery_query_id,
        input.query_json,
        input.query_sha256,
        input.lp_discovery_record_id,
        input.result_count,
        input.result_ids_json,
        input.notice,
        input.correlation_id,
        input.created_at
      );
  }

  upsertPackageCache(input: {
    package_sha256: string;
    published_knowledge_id: string;
    publication_package_id: string;
    publication_version: string | null;
    source_agent_id: string;
    knowledge_type: string;
    body_json: string;
    meta_json: string;
    fetched_at: string;
    byte_size: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO lp_pk_package_cache (
          package_sha256, published_knowledge_id, publication_package_id, publication_version,
          source_agent_id, knowledge_type, body_json, meta_json, untrusted_content, fetched_at, byte_size
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(package_sha256) DO UPDATE SET fetched_at = excluded.fetched_at`
      )
      .run(
        input.package_sha256,
        input.published_knowledge_id,
        input.publication_package_id,
        input.publication_version,
        input.source_agent_id,
        input.knowledge_type,
        input.body_json,
        input.meta_json,
        input.fetched_at,
        input.byte_size
      );
  }

  getPackageCache(sha: string) {
    return this.db
      .prepare(`SELECT * FROM lp_pk_package_cache WHERE package_sha256 = ?`)
      .get(sha) as Record<string, unknown> | undefined;
  }

  insertLocalReference(row: PkLocalReferenceRow): void {
    this.db
      .prepare(
        `INSERT INTO lp_pk_local_references (
          local_reference_id, published_knowledge_id, publication_package_id, publication_version,
          package_sha256, source_agent_id, knowledge_type, authority, applicability_json,
          scope_snapshot, untrusted_content, discovered_at, reference_created_at, reference_origin,
          local_review_state, local_retrieval_eligible, lp_eligible, lp_eligibility_json,
          lp_freshness_state, local_freshness_state, challenge_state, catalog_state,
          offline_grace_deadline, last_reconciled_at, last_used_at, use_count, influence_count,
          title, summary, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.local_reference_id,
        row.published_knowledge_id,
        row.publication_package_id,
        row.publication_version,
        row.package_sha256,
        row.source_agent_id,
        row.knowledge_type,
        row.authority,
        row.applicability_json,
        row.scope_snapshot,
        row.discovered_at,
        row.reference_created_at,
        row.reference_origin,
        row.local_review_state,
        row.local_retrieval_eligible,
        row.lp_eligible,
        row.lp_eligibility_json,
        row.lp_freshness_state,
        row.local_freshness_state,
        row.challenge_state,
        row.catalog_state,
        row.offline_grace_deadline,
        row.last_reconciled_at,
        row.last_used_at,
        row.use_count,
        row.influence_count,
        row.title,
        row.summary,
        row.created_at,
        row.updated_at
      );
  }

  getLocalReference(id: string): PkLocalReferenceRow | undefined {
    return this.db
      .prepare(`SELECT * FROM lp_pk_local_references WHERE local_reference_id = ?`)
      .get(id) as PkLocalReferenceRow | undefined;
  }

  getLocalReferenceByPublication(
    publishedKnowledgeId: string,
    packageSha256: string
  ): PkLocalReferenceRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM lp_pk_local_references
         WHERE published_knowledge_id = ? AND package_sha256 = ?`
      )
      .get(publishedKnowledgeId, packageSha256) as PkLocalReferenceRow | undefined;
  }

  listLocalReferences(limit = 100): PkLocalReferenceRow[] {
    return this.db
      .prepare(`SELECT * FROM lp_pk_local_references ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as PkLocalReferenceRow[];
  }

  listEligibleReferences(limit = 10): PkLocalReferenceRow[] {
    return this.db
      .prepare(
        `SELECT * FROM lp_pk_local_references
         WHERE local_retrieval_eligible = 1 AND local_review_state = 'eligible_for_retrieval'
         ORDER BY updated_at DESC LIMIT ?`
      )
      .all(limit) as PkLocalReferenceRow[];
  }

  updateLocalReference(id: string, patch: Partial<PkLocalReferenceRow>): void {
    const existing = this.getLocalReference(id);
    if (!existing) return;
    const next = { ...existing, ...patch, updated_at: new Date().toISOString() };
    this.db
      .prepare(
        `UPDATE lp_pk_local_references SET
          local_review_state = ?, local_retrieval_eligible = ?, lp_eligible = ?,
          lp_eligibility_json = ?, lp_freshness_state = ?, local_freshness_state = ?,
          challenge_state = ?, catalog_state = ?, offline_grace_deadline = ?,
          last_reconciled_at = ?, last_used_at = ?, use_count = ?, influence_count = ?,
          updated_at = ?
         WHERE local_reference_id = ?`
      )
      .run(
        next.local_review_state,
        next.local_retrieval_eligible,
        next.lp_eligible,
        next.lp_eligibility_json,
        next.lp_freshness_state,
        next.local_freshness_state,
        next.challenge_state,
        next.catalog_state,
        next.offline_grace_deadline,
        next.last_reconciled_at,
        next.last_used_at,
        next.use_count,
        next.influence_count,
        next.updated_at,
        id
      );
  }

  insertUseTrace(input: {
    use_trace_id: string;
    local_reference_id: string;
    run_id: string | null;
    published_knowledge_id: string;
    package_sha256: string;
    use_category: string;
    compatibility_context_hash: string | null;
    retrieval_rank: number | null;
    offline_or_stale: number;
    created_at: string;
    receipt_status: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO lp_pk_use_traces (
          use_trace_id, local_reference_id, run_id, published_knowledge_id, package_sha256,
          use_category, compatibility_context_hash, retrieval_rank, offline_or_stale,
          created_at, receipt_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.use_trace_id,
        input.local_reference_id,
        input.run_id,
        input.published_knowledge_id,
        input.package_sha256,
        input.use_category,
        input.compatibility_context_hash,
        input.retrieval_rank,
        input.offline_or_stale,
        input.created_at,
        input.receipt_status
      );
  }

  insertInfluenceTrace(input: {
    influence_trace_id: string;
    local_reference_id: string;
    run_id: string | null;
    published_knowledge_id: string;
    package_sha256: string;
    influence_category: string;
    bounded_rationale: string | null;
    local_candidate_or_proposal_ref: string | null;
    created_at: string;
    receipt_status: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO lp_pk_influence_traces (
          influence_trace_id, local_reference_id, run_id, published_knowledge_id, package_sha256,
          influence_category, bounded_rationale, local_candidate_or_proposal_ref,
          created_at, receipt_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.influence_trace_id,
        input.local_reference_id,
        input.run_id,
        input.published_knowledge_id,
        input.package_sha256,
        input.influence_category,
        input.bounded_rationale,
        input.local_candidate_or_proposal_ref,
        input.created_at,
        input.receipt_status
      );
  }

  insertChallenge(input: {
    challenge_row_id: string;
    local_reference_id: string | null;
    published_knowledge_id: string;
    challenge_type: string;
    reason: string;
    evidence_json: string;
    idempotency_key: string;
    status: string;
    lp_challenge_id: string | null;
    created_at: string;
    updated_at: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO lp_pk_challenges (
          challenge_row_id, local_reference_id, published_knowledge_id, challenge_type,
          reason, evidence_json, idempotency_key, status, lp_challenge_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.challenge_row_id,
        input.local_reference_id,
        input.published_knowledge_id,
        input.challenge_type,
        input.reason,
        input.evidence_json,
        input.idempotency_key,
        input.status,
        input.lp_challenge_id,
        input.created_at,
        input.updated_at
      );
  }

  getChallengeByIdempotency(key: string) {
    return this.db
      .prepare(`SELECT * FROM lp_pk_challenges WHERE idempotency_key = ?`)
      .get(key) as Record<string, unknown> | undefined;
  }

  enqueueOutbox(input: {
    outbox_id: string;
    kind: string;
    related_id: string | null;
    published_knowledge_id: string | null;
    idempotency_key: string;
    payload_json: string;
    payload_sha256: string;
    created_at: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO lp_pk_outbox (
          outbox_id, kind, related_id, published_knowledge_id, idempotency_key,
          payload_json, payload_sha256, status, attempt_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`
      )
      .run(
        input.outbox_id,
        input.kind,
        input.related_id,
        input.published_knowledge_id,
        input.idempotency_key,
        input.payload_json,
        input.payload_sha256,
        input.created_at,
        input.created_at
      );
  }

  claimOutbox(limit = 10): PkOutboxRow[] {
    const now = new Date().toISOString();
    const rows = this.db
      .prepare(
        `SELECT * FROM lp_pk_outbox
         WHERE status IN ('pending', 'retry_scheduled')
           AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
         ORDER BY created_at ASC LIMIT ?`
      )
      .all(now, limit) as PkOutboxRow[];
    for (const row of rows) {
      this.db
        .prepare(
          `UPDATE lp_pk_outbox SET status = 'claimed', attempt_count = attempt_count + 1,
           updated_at = ? WHERE outbox_id = ?`
        )
        .run(now, row.outbox_id);
    }
    return rows;
  }

  markOutboxPublished(outboxId: string, learningPlaneRef: string | null): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE lp_pk_outbox SET status = 'published', learning_plane_ref = ?,
         published_at = ?, updated_at = ? WHERE outbox_id = ?`
      )
      .run(learningPlaneRef, now, now, outboxId);
  }

  markOutboxRetry(outboxId: string, code: string, message: string, delayMs: number): void {
    const now = new Date();
    const next = new Date(now.getTime() + delayMs).toISOString();
    this.db
      .prepare(
        `UPDATE lp_pk_outbox SET status = 'retry_scheduled', next_attempt_at = ?,
         last_error_code = ?, last_bounded_error = ?, updated_at = ? WHERE outbox_id = ?`
      )
      .run(next, code, message.slice(0, 500), now.toISOString(), outboxId);
  }

  markOutboxFailed(outboxId: string, code: string, message: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE lp_pk_outbox SET status = 'permanent_failure', last_error_code = ?,
         last_bounded_error = ?, updated_at = ? WHERE outbox_id = ?`
      )
      .run(code, message.slice(0, 500), now, outboxId);
  }

  isLocalReferenceTombstoned(ref: PkLocalReferenceRow): boolean {
    return ref.local_retrieval_eligible === 0 && ref.local_review_state === "disabled";
  }

  tombstoneLocalReference(id: string): void {
    this.updateLocalReference(id, {
      local_retrieval_eligible: 0,
      local_review_state: "disabled",
      offline_grace_deadline: null,
      local_freshness_state: "stale"
    });
  }

  countLocalReferences(): number {
    return (
      (this.db.prepare(`SELECT COUNT(*) AS c FROM lp_pk_local_references`).get() as
        | { c: number }
        | undefined)?.c ?? 0
    );
  }

  countTombstonedReferences(): number {
    return (
      (this.db
        .prepare(
          `SELECT COUNT(*) AS c FROM lp_pk_local_references
           WHERE local_retrieval_eligible = 0 AND local_review_state = 'disabled'`
        )
        .get() as { c: number } | undefined)?.c ?? 0
    );
  }

  counts(): Record<string, number> {
    const one = (sql: string) =>
      (this.db.prepare(sql).get() as { c: number } | undefined)?.c ?? 0;
    return {
      proposals: one(`SELECT COUNT(*) AS c FROM lp_pk_publication_proposals`),
      discoveryQueries: one(`SELECT COUNT(*) AS c FROM lp_pk_discovery_queries`),
      localReferences: one(`SELECT COUNT(*) AS c FROM lp_pk_local_references`),
      eligibleReferences: one(
        `SELECT COUNT(*) AS c FROM lp_pk_local_references WHERE local_retrieval_eligible = 1`
      ),
      tombstonedReferences: this.countTombstonedReferences(),
      useTraces: one(`SELECT COUNT(*) AS c FROM lp_pk_use_traces`),
      influenceTraces: one(`SELECT COUNT(*) AS c FROM lp_pk_influence_traces`),
      pendingOutbox: one(
        `SELECT COUNT(*) AS c FROM lp_pk_outbox WHERE status IN ('pending','retry_scheduled','claimed')`
      )
    };
  }
}
