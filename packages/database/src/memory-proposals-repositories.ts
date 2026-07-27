import type { SqliteDatabase } from "./connection";

export interface MemoryProposalRow {
  proposalId: string;
  proposalType: string;
  status: string;
  projectId: string;
  sourceMemoryId: string | null;
  sourceFindingId: string | null;
  title: string;
  statement: string;
  summary: string | null;
  confidence: number;
  reason: string;
  scopesJson: string;
  evidenceIdsJson: string;
  conflictsJson: string;
  proposedAuthority: string;
  validUntil: string | null;
  resultingMemoryId: string | null;
  proposedBy: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapProposal(r: Record<string, unknown>): MemoryProposalRow {
  return {
    proposalId: r.proposal_id as string,
    proposalType: r.proposal_type as string,
    status: r.status as string,
    projectId: r.project_id as string,
    sourceMemoryId: (r.source_memory_id as string | null) ?? null,
    sourceFindingId: (r.source_finding_id as string | null) ?? null,
    title: r.title as string,
    statement: r.statement as string,
    summary: (r.summary as string | null) ?? null,
    confidence: Number(r.confidence ?? 0.5),
    reason: r.reason as string,
    scopesJson: (r.scopes_json as string) ?? "[]",
    evidenceIdsJson: (r.evidence_ids_json as string) ?? "[]",
    conflictsJson: (r.conflicts_json as string) ?? "[]",
    proposedAuthority: (r.proposed_authority as string) ?? "reusable_approved",
    validUntil: (r.valid_until as string | null) ?? null,
    resultingMemoryId: (r.resulting_memory_id as string | null) ?? null,
    proposedBy: r.proposed_by as string,
    reviewedBy: (r.reviewed_by as string | null) ?? null,
    reviewedAt: (r.reviewed_at as string | null) ?? null,
    reviewNotes: (r.review_notes as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string
  };
}

export class MemoryProposalsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(row: MemoryProposalRow): void {
    this.db
      .prepare(
        `INSERT INTO memory_proposals
         (proposal_id, proposal_type, status, project_id, source_memory_id, source_finding_id,
          title, statement, summary, confidence, reason, scopes_json, evidence_ids_json,
          conflicts_json, proposed_authority, valid_until, resulting_memory_id,
          proposed_by, reviewed_by, reviewed_at, review_notes, created_at, updated_at)
         VALUES
         (@proposalId, @proposalType, @status, @projectId, @sourceMemoryId, @sourceFindingId,
          @title, @statement, @summary, @confidence, @reason, @scopesJson, @evidenceIdsJson,
          @conflictsJson, @proposedAuthority, @validUntil, @resultingMemoryId,
          @proposedBy, @reviewedBy, @reviewedAt, @reviewNotes, @createdAt, @updatedAt)`
      )
      .run(row);
  }

  getById(id: string): MemoryProposalRow | undefined {
    const r = this.db.prepare(`SELECT * FROM memory_proposals WHERE proposal_id = ?`).get(id);
    return r ? mapProposal(r as Record<string, unknown>) : undefined;
  }

  list(filter?: { projectId?: string; status?: string }): MemoryProposalRow[] {
    let sql = `SELECT * FROM memory_proposals WHERE 1=1`;
    const params: unknown[] = [];
    if (filter?.projectId) {
      sql += ` AND project_id = ?`;
      params.push(filter.projectId);
    }
    if (filter?.status) {
      sql += ` AND status = ?`;
      params.push(filter.status);
    }
    sql += ` ORDER BY created_at DESC`;
    return this.db
      .prepare(sql)
      .all(...params)
      .map((r) => mapProposal(r as Record<string, unknown>));
  }

  update(row: MemoryProposalRow): void {
    this.db
      .prepare(
        `UPDATE memory_proposals SET
           status = @status,
           conflicts_json = @conflictsJson,
           valid_until = @validUntil,
           resulting_memory_id = @resultingMemoryId,
           reviewed_by = @reviewedBy,
           reviewed_at = @reviewedAt,
           review_notes = @reviewNotes,
           updated_at = @updatedAt
         WHERE proposal_id = @proposalId`
      )
      .run(row);
  }
}
