import type { SqliteDatabase } from "./connection";

export interface WikiPageRow {
  pageId: string;
  slug: string;
  title: string;
  parentPageId: string | null;
  path: string;
  status: string;
  currentVersionId: string | null;
  scopeJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface WikiPageVersionRow {
  versionId: string;
  pageId: string;
  versionNo: number;
  contentMarkdown: string;
  sectionsJson: string;
  sourceMemoryIdsJson: string;
  changeReason: string | null;
  createdBy: string;
  createdAt: string;
}

export interface WikiUpdateProposalRow {
  proposalId: string;
  pageId: string;
  fromVersionId: string | null;
  status: string;
  title: string;
  proposedContentMarkdown: string;
  proposedSectionsJson: string;
  proposedSourceMemoryIdsJson: string;
  changeReason: string;
  lintIssuesJson: string;
  resultingVersionId: string | null;
  createdBy: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WikiLintIssueRow {
  issueId: string;
  code: string;
  severity: string;
  message: string;
  pageId: string | null;
  path: string | null;
  memoryId: string | null;
  runId: string | null;
  createdAt: string;
}

function mapPage(r: Record<string, unknown>): WikiPageRow {
  return {
    pageId: r.page_id as string,
    slug: r.slug as string,
    title: r.title as string,
    parentPageId: (r.parent_page_id as string | null) ?? null,
    path: r.path as string,
    status: r.status as string,
    currentVersionId: (r.current_version_id as string | null) ?? null,
    scopeJson: (r.scope_json as string) ?? "{}",
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string
  };
}

function mapVersion(r: Record<string, unknown>): WikiPageVersionRow {
  return {
    versionId: r.version_id as string,
    pageId: r.page_id as string,
    versionNo: Number(r.version_no),
    contentMarkdown: r.content_markdown as string,
    sectionsJson: (r.sections_json as string) ?? "[]",
    sourceMemoryIdsJson: (r.source_memory_ids_json as string) ?? "[]",
    changeReason: (r.change_reason as string | null) ?? null,
    createdBy: r.created_by as string,
    createdAt: r.created_at as string
  };
}

function mapProposal(r: Record<string, unknown>): WikiUpdateProposalRow {
  return {
    proposalId: r.proposal_id as string,
    pageId: r.page_id as string,
    fromVersionId: (r.from_version_id as string | null) ?? null,
    status: r.status as string,
    title: r.title as string,
    proposedContentMarkdown: r.proposed_content_markdown as string,
    proposedSectionsJson: (r.proposed_sections_json as string) ?? "[]",
    proposedSourceMemoryIdsJson: (r.proposed_source_memory_ids_json as string) ?? "[]",
    changeReason: r.change_reason as string,
    lintIssuesJson: (r.lint_issues_json as string) ?? "[]",
    resultingVersionId: (r.resulting_version_id as string | null) ?? null,
    createdBy: r.created_by as string,
    reviewedBy: (r.reviewed_by as string | null) ?? null,
    reviewedAt: (r.reviewed_at as string | null) ?? null,
    reviewNotes: (r.review_notes as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string
  };
}

export class WikiPagesRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(row: WikiPageRow): void {
    this.db
      .prepare(
        `INSERT INTO wiki_pages
         (page_id, slug, title, parent_page_id, path, status, current_version_id,
          scope_json, created_at, updated_at)
         VALUES (@pageId, @slug, @title, @parentPageId, @path, @status, @currentVersionId,
                 @scopeJson, @createdAt, @updatedAt)`
      )
      .run(row);
  }

  update(row: WikiPageRow): void {
    this.db
      .prepare(
        `UPDATE wiki_pages SET
           title = @title, status = @status, current_version_id = @currentVersionId,
           scope_json = @scopeJson, updated_at = @updatedAt
         WHERE page_id = @pageId`
      )
      .run(row);
  }

  getById(pageId: string): WikiPageRow | undefined {
    const r = this.db.prepare(`SELECT * FROM wiki_pages WHERE page_id = ?`).get(pageId);
    return r ? mapPage(r as Record<string, unknown>) : undefined;
  }

  getBySlug(slug: string): WikiPageRow | undefined {
    const r = this.db.prepare(`SELECT * FROM wiki_pages WHERE slug = ?`).get(slug);
    return r ? mapPage(r as Record<string, unknown>) : undefined;
  }

  list(): WikiPageRow[] {
    return this.db
      .prepare(`SELECT * FROM wiki_pages ORDER BY path`)
      .all()
      .map((r) => mapPage(r as Record<string, unknown>));
  }
}

export class WikiPageVersionsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(row: WikiPageVersionRow): void {
    this.db
      .prepare(
        `INSERT INTO wiki_page_versions
         (version_id, page_id, version_no, content_markdown, sections_json,
          source_memory_ids_json, change_reason, created_by, created_at)
         VALUES (@versionId, @pageId, @versionNo, @contentMarkdown, @sectionsJson,
                 @sourceMemoryIdsJson, @changeReason, @createdBy, @createdAt)`
      )
      .run(row);
  }

  getById(versionId: string): WikiPageVersionRow | undefined {
    const r = this.db
      .prepare(`SELECT * FROM wiki_page_versions WHERE version_id = ?`)
      .get(versionId);
    return r ? mapVersion(r as Record<string, unknown>) : undefined;
  }

  listByPage(pageId: string): WikiPageVersionRow[] {
    return this.db
      .prepare(
        `SELECT * FROM wiki_page_versions WHERE page_id = ? ORDER BY version_no DESC`
      )
      .all(pageId)
      .map((r) => mapVersion(r as Record<string, unknown>));
  }

  nextVersionNo(pageId: string): number {
    const r = this.db
      .prepare(
        `SELECT COALESCE(MAX(version_no), 0) AS n FROM wiki_page_versions WHERE page_id = ?`
      )
      .get(pageId) as { n: number };
    return Number(r.n) + 1;
  }
}

export class WikiSourceLinksRepository {
  constructor(private readonly db: SqliteDatabase) {}

  replaceForVersion(
    pageId: string,
    versionId: string,
    memoryIds: string[],
    createdAt: string
  ): void {
    const tx = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM wiki_source_links WHERE version_id = ?`).run(versionId);
      const insert = this.db.prepare(
        `INSERT INTO wiki_source_links (page_id, version_id, memory_id, support_type, created_at)
         VALUES (?, ?, ?, 'supports', ?)`
      );
      for (const memoryId of memoryIds) {
        insert.run(pageId, versionId, memoryId, createdAt);
      }
    });
    tx();
  }

  listForVersion(versionId: string): Array<{ memoryId: string; supportType: string }> {
    return this.db
      .prepare(
        `SELECT memory_id AS memoryId, support_type AS supportType
         FROM wiki_source_links WHERE version_id = ?`
      )
      .all(versionId) as Array<{ memoryId: string; supportType: string }>;
  }
}

export class WikiUpdateProposalsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(row: WikiUpdateProposalRow): void {
    this.db
      .prepare(
        `INSERT INTO wiki_update_proposals
         (proposal_id, page_id, from_version_id, status, title, proposed_content_markdown,
          proposed_sections_json, proposed_source_memory_ids_json, change_reason,
          lint_issues_json, resulting_version_id, created_by, reviewed_by, reviewed_at,
          review_notes, created_at, updated_at)
         VALUES
         (@proposalId, @pageId, @fromVersionId, @status, @title, @proposedContentMarkdown,
          @proposedSectionsJson, @proposedSourceMemoryIdsJson, @changeReason,
          @lintIssuesJson, @resultingVersionId, @createdBy, @reviewedBy, @reviewedAt,
          @reviewNotes, @createdAt, @updatedAt)`
      )
      .run(row);
  }

  getById(id: string): WikiUpdateProposalRow | undefined {
    const r = this.db
      .prepare(`SELECT * FROM wiki_update_proposals WHERE proposal_id = ?`)
      .get(id);
    return r ? mapProposal(r as Record<string, unknown>) : undefined;
  }

  list(filter?: { status?: string; pageId?: string }): WikiUpdateProposalRow[] {
    let sql = `SELECT * FROM wiki_update_proposals WHERE 1=1`;
    const params: unknown[] = [];
    if (filter?.status) {
      sql += ` AND status = ?`;
      params.push(filter.status);
    }
    if (filter?.pageId) {
      sql += ` AND page_id = ?`;
      params.push(filter.pageId);
    }
    sql += ` ORDER BY created_at DESC`;
    return this.db
      .prepare(sql)
      .all(...params)
      .map((r) => mapProposal(r as Record<string, unknown>));
  }

  update(row: WikiUpdateProposalRow): void {
    this.db
      .prepare(
        `UPDATE wiki_update_proposals SET
           status = @status,
           lint_issues_json = @lintIssuesJson,
           resulting_version_id = @resultingVersionId,
           reviewed_by = @reviewedBy,
           reviewed_at = @reviewedAt,
           review_notes = @reviewNotes,
           updated_at = @updatedAt
         WHERE proposal_id = @proposalId`
      )
      .run(row);
  }
}

export class WikiLintIssuesRepository {
  constructor(private readonly db: SqliteDatabase) {}

  clear(pageId?: string): void {
    if (pageId) {
      this.db.prepare(`DELETE FROM wiki_lint_issues WHERE page_id = ?`).run(pageId);
    } else {
      this.db.prepare(`DELETE FROM wiki_lint_issues`).run();
    }
  }

  insert(row: WikiLintIssueRow): void {
    this.db
      .prepare(
        `INSERT INTO wiki_lint_issues
         (issue_id, code, severity, message, page_id, path, memory_id, run_id, created_at)
         VALUES (@issueId, @code, @severity, @message, @pageId, @path, @memoryId, @runId, @createdAt)`
      )
      .run(row);
  }

  list(pageId?: string): WikiLintIssueRow[] {
    const rows = pageId
      ? this.db
          .prepare(`SELECT * FROM wiki_lint_issues WHERE page_id = ? ORDER BY created_at`)
          .all(pageId)
      : this.db.prepare(`SELECT * FROM wiki_lint_issues ORDER BY created_at`).all();
    return (rows as Record<string, unknown>[]).map((r) => ({
      issueId: r.issue_id as string,
      code: r.code as string,
      severity: r.severity as string,
      message: r.message as string,
      pageId: (r.page_id as string | null) ?? null,
      path: (r.path as string | null) ?? null,
      memoryId: (r.memory_id as string | null) ?? null,
      runId: (r.run_id as string | null) ?? null,
      createdAt: r.created_at as string
    }));
  }
}
