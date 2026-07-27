import type { SqliteDatabase } from "./connection";

export interface MemoryItemRow {
  memoryId: string;
  memoryType: string;
  authorityStatus: string;
  title: string;
  statement: string;
  summary: string | null;
  confidence: number;
  supportCount: number;
  contradictionCount: number;
  validFrom: string | null;
  validUntil: string | null;
  lastReaffirmedAt: string | null;
  createdFromRunId: string | null;
  createdFromLearningEventId: string | null;
  currentVersionId: string | null;
  payloadJson: string;
  createdAt: string;
  updatedAt: string;
  rowid?: number;
}

function mapMemory(r: Record<string, unknown>): MemoryItemRow {
  return {
    memoryId: r.memory_id as string,
    memoryType: r.memory_type as string,
    authorityStatus: r.authority_status as string,
    title: r.title as string,
    statement: r.statement as string,
    summary: (r.summary as string | null) ?? null,
    confidence: r.confidence as number,
    supportCount: r.support_count as number,
    contradictionCount: r.contradiction_count as number,
    validFrom: (r.valid_from as string | null) ?? null,
    validUntil: (r.valid_until as string | null) ?? null,
    lastReaffirmedAt: (r.last_reaffirmed_at as string | null) ?? null,
    createdFromRunId: (r.created_from_run_id as string | null) ?? null,
    createdFromLearningEventId: (r.created_from_learning_event_id as string | null) ?? null,
    currentVersionId: (r.current_version_id as string | null) ?? null,
    payloadJson: r.payload_json as string,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    rowid: typeof r.rowid === "number" ? r.rowid : undefined
  };
}

export class MemoryItemsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(row: MemoryItemRow): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO memory_items
            (memory_id, memory_type, authority_status, title, statement, summary,
             confidence, support_count, contradiction_count, valid_from, valid_until,
             last_reaffirmed_at, created_from_run_id, created_from_learning_event_id,
             current_version_id, payload_json, created_at, updated_at)
           VALUES
            (@memoryId, @memoryType, @authorityStatus, @title, @statement, @summary,
             @confidence, @supportCount, @contradictionCount, @validFrom, @validUntil,
             @lastReaffirmedAt, @createdFromRunId, @createdFromLearningEventId,
             @currentVersionId, @payloadJson, @createdAt, @updatedAt)`
        )
        .run(row);
      const rowid = (
        this.db.prepare(`SELECT rowid FROM memory_items WHERE memory_id = ?`).get(row.memoryId) as {
          rowid: number;
        }
      ).rowid;
      this.db
        .prepare(
          `INSERT INTO memory_fts(rowid, title, statement, summary) VALUES (?, ?, ?, ?)`
        )
        .run(rowid, row.title, row.statement, row.summary ?? "");
    });
    tx();
  }

  update(row: MemoryItemRow): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE memory_items SET
             memory_type = @memoryType,
             authority_status = @authorityStatus,
             title = @title,
             statement = @statement,
             summary = @summary,
             confidence = @confidence,
             support_count = @supportCount,
             contradiction_count = @contradictionCount,
             valid_from = @validFrom,
             valid_until = @validUntil,
             last_reaffirmed_at = @lastReaffirmedAt,
             current_version_id = @currentVersionId,
             payload_json = @payloadJson,
             updated_at = @updatedAt
           WHERE memory_id = @memoryId`
        )
        .run(row);
      const rowid = (
        this.db.prepare(`SELECT rowid FROM memory_items WHERE memory_id = ?`).get(row.memoryId) as {
          rowid: number;
        }
      ).rowid;
      this.db.prepare(`DELETE FROM memory_fts WHERE rowid = ?`).run(rowid);
      this.db
        .prepare(
          `INSERT INTO memory_fts(rowid, title, statement, summary) VALUES (?, ?, ?, ?)`
        )
        .run(rowid, row.title, row.statement, row.summary ?? "");
    });
    tx();
  }

  getById(memoryId: string): MemoryItemRow | undefined {
    const r = this.db
      .prepare(`SELECT rowid, * FROM memory_items WHERE memory_id = ?`)
      .get(memoryId) as Record<string, unknown> | undefined;
    return r ? mapMemory(r) : undefined;
  }

  listByProject(projectId: string): MemoryItemRow[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT m.rowid, m.* FROM memory_items m
         INNER JOIN memory_scopes s ON s.memory_id = m.memory_id
         WHERE s.dimension = 'project' AND s.value = ?
         ORDER BY m.updated_at DESC`
      )
      .all(projectId) as Record<string, unknown>[];
    return rows.map(mapMemory);
  }

  listActiveByProject(projectId: string): MemoryItemRow[] {
    const inactive = new Set(["rejected", "superseded", "expired"]);
    return this.listByProject(projectId).filter((m) => !inactive.has(m.authorityStatus));
  }

  listFailureCorrections(projectId: string): MemoryItemRow[] {
    return this.listByProject(projectId).filter(
      (m) => m.memoryType === "failure_correction"
    );
  }

  findByFindingId(findingId: string): MemoryItemRow | undefined {
    const r = this.db
      .prepare(
        `SELECT m.rowid, m.* FROM memory_items m
         INNER JOIN memory_evidence_links l
           ON l.memory_id = m.memory_id AND l.target_type = 'finding' AND l.target_id = ?
         LIMIT 1`
      )
      .get(findingId) as Record<string, unknown> | undefined;
    return r ? mapMemory(r) : undefined;
  }

  /**
   * FTS5 search. Terms are escaped/quoted; do not pass raw user text unchecked.
   */
  searchFts(matchQuery: string, limit = 50): MemoryItemRow[] {
    const rows = this.db
      .prepare(
        `SELECT m.rowid, m.*, bm25(memory_fts) AS rank
         FROM memory_fts
         INNER JOIN memory_items m ON m.rowid = memory_fts.rowid
         WHERE memory_fts MATCH ?
         ORDER BY rank
         LIMIT ?`
      )
      .all(matchQuery, limit) as Record<string, unknown>[];
    return rows.map(mapMemory);
  }

  /**
   * Cross-project reusable knowledge: reusable_approved items matching category
   * (and optional platform / product_type). Intentionally excludes project-scoped-only items.
   */
  listReusableApprovedForScope(input: {
    platform?: string;
    marketplace?: string;
    category?: string;
    productType?: string;
  }): MemoryItemRow[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT m.rowid, m.* FROM memory_items m
         WHERE m.authority_status = 'reusable_approved'
           AND m.memory_type = 'reusable_semantic'
         ORDER BY m.updated_at DESC`
      )
      .all() as Record<string, unknown>[];
    const mapped = rows.map(mapMemory);
    if (!input.platform && !input.category && !input.productType && !input.marketplace) {
      return mapped;
    }
    return mapped.filter((m) => {
      const scopes = this.db
        .prepare(`SELECT dimension, value FROM memory_scopes WHERE memory_id = ?`)
        .all(m.memoryId) as Array<{ dimension: string; value: string }>;
      const byDim = new Map(scopes.map((s) => [s.dimension, s.value]));
      // Must not be project-only leakage: reusable items should carry category or platform.
      if (!byDim.has("category") && !byDim.has("platform") && !byDim.has("product_type")) {
        return false;
      }
      if (input.platform && byDim.has("platform") && byDim.get("platform") !== input.platform) {
        return false;
      }
      if (
        input.marketplace &&
        byDim.has("marketplace") &&
        byDim.get("marketplace") !== input.marketplace
      ) {
        return false;
      }
      if (input.category && byDim.has("category") && byDim.get("category") !== input.category) {
        return false;
      }
      if (
        input.productType &&
        byDim.has("product_type") &&
        byDim.get("product_type") !== input.productType
      ) {
        return false;
      }
      return true;
    });
  }
}

export class MemoryScopesRepository {
  constructor(private readonly db: SqliteDatabase) {}

  replaceScopes(
    memoryId: string,
    scopes: Array<{ dimension: string; value: string }>
  ): void {
    const tx = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM memory_scopes WHERE memory_id = ?`).run(memoryId);
      const insert = this.db.prepare(
        `INSERT INTO memory_scopes (memory_id, dimension, value) VALUES (?, ?, ?)`
      );
      for (const s of scopes) {
        insert.run(memoryId, s.dimension, s.value);
      }
    });
    tx();
  }

  listForMemory(memoryId: string): Array<{ dimension: string; value: string }> {
    return this.db
      .prepare(`SELECT dimension, value FROM memory_scopes WHERE memory_id = ?`)
      .all(memoryId) as Array<{ dimension: string; value: string }>;
  }

  listMemoryIdsForScope(dimension: string, value: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT memory_id FROM memory_scopes WHERE dimension = ? AND value = ?`
      )
      .all(dimension, value) as Array<{ memory_id: string }>;
    return rows.map((r) => r.memory_id);
  }
}

export class MemoryLinksRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(row: {
    memoryId: string;
    targetType: string;
    targetId: string;
    supportType: string;
    createdAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO memory_evidence_links
          (memory_id, target_type, target_id, support_type, created_at)
         VALUES (@memoryId, @targetType, @targetId, @supportType, @createdAt)`
      )
      .run(row);
  }

  listForMemory(memoryId: string): Array<{
    targetType: string;
    targetId: string;
    supportType: string;
  }> {
    return this.db
      .prepare(
        `SELECT target_type AS targetType, target_id AS targetId, support_type AS supportType
         FROM memory_evidence_links WHERE memory_id = ?`
      )
      .all(memoryId) as Array<{
      targetType: string;
      targetId: string;
      supportType: string;
    }>;
  }
}

export interface ContextAssemblyRow {
  assemblyId: string;
  runId: string;
  projectId: string;
  tokenBudget: number;
  payloadJson: string;
  artifactId: string | null;
  createdAt: string;
}

export class ContextAssembliesRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(row: ContextAssemblyRow): void {
    this.db
      .prepare(
        `INSERT INTO context_assemblies
          (assembly_id, run_id, project_id, token_budget, payload_json, artifact_id, created_at)
         VALUES
          (@assemblyId, @runId, @projectId, @tokenBudget, @payloadJson, @artifactId, @createdAt)`
      )
      .run(row);
  }

  getByRun(runId: string): ContextAssemblyRow | undefined {
    const r = this.db
      .prepare(
        `SELECT * FROM context_assemblies WHERE run_id = ? ORDER BY created_at DESC LIMIT 1`
      )
      .get(runId) as Record<string, unknown> | undefined;
    if (!r) return undefined;
    return {
      assemblyId: r.assembly_id as string,
      runId: r.run_id as string,
      projectId: r.project_id as string,
      tokenBudget: r.token_budget as number,
      payloadJson: r.payload_json as string,
      artifactId: (r.artifact_id as string | null) ?? null,
      createdAt: r.created_at as string
    };
  }
}

export interface MemoryRetrievalEventRow {
  retrievalEventId: string;
  runId: string;
  projectId: string;
  query: string;
  filtersJson: string;
  candidatesJson: string;
  selectedJson: string;
  contextAssemblyId: string | null;
  createdAt: string;
}

export class MemoryRetrievalEventsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(row: MemoryRetrievalEventRow): void {
    this.db
      .prepare(
        `INSERT INTO memory_retrieval_events
          (retrieval_event_id, run_id, project_id, query, filters_json,
           candidates_json, selected_json, context_assembly_id, created_at)
         VALUES
          (@retrievalEventId, @runId, @projectId, @query, @filtersJson,
           @candidatesJson, @selectedJson, @contextAssemblyId, @createdAt)`
      )
      .run(row);
  }

  listByRun(runId: string): MemoryRetrievalEventRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM memory_retrieval_events WHERE run_id = ? ORDER BY created_at`
      )
      .all(runId) as Record<string, unknown>[];
    return rows.map((r) => ({
      retrievalEventId: r.retrieval_event_id as string,
      runId: r.run_id as string,
      projectId: r.project_id as string,
      query: r.query as string,
      filtersJson: r.filters_json as string,
      candidatesJson: r.candidates_json as string,
      selectedJson: r.selected_json as string,
      contextAssemblyId: (r.context_assembly_id as string | null) ?? null,
      createdAt: r.created_at as string
    }));
  }
}

export class MemoryUsageEventsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(row: {
    usageEventId: string;
    runId: string;
    memoryId: string;
    usageKind: string;
    detailJson: string | null;
    createdAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO memory_usage_events
          (usage_event_id, run_id, memory_id, usage_kind, detail_json, created_at)
         VALUES
          (@usageEventId, @runId, @memoryId, @usageKind, @detailJson, @createdAt)`
      )
      .run(row);
  }

  listByRun(runId: string): Array<{
    usageEventId: string;
    memoryId: string;
    usageKind: string;
    createdAt: string;
  }> {
    return this.db
      .prepare(
        `SELECT usage_event_id AS usageEventId, memory_id AS memoryId,
                usage_kind AS usageKind, created_at AS createdAt
         FROM memory_usage_events WHERE run_id = ? ORDER BY created_at`
      )
      .all(runId) as Array<{
      usageEventId: string;
      memoryId: string;
      usageKind: string;
      createdAt: string;
    }>;
  }
}
