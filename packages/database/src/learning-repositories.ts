import type { Database as BetterSqlite } from "better-sqlite3";

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function parseJsonObject(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === "string") out[k] = val;
    }
    return out;
  } catch {
    return {};
  }
}

export interface OutcomeReviewRow {
  outcomeReviewId: string;
  projectId: string;
  runId: string;
  judgment: string;
  notes: string | null;
  reviewerId: string;
  lessonCandidateId: string | null;
  createdAt: string;
}

export interface LessonCandidateRow {
  lessonCandidateId: string;
  projectId: string;
  learningEventId: string | null;
  sourceRunId: string | null;
  sourceFindingId: string | null;
  actionTaken: string;
  observedOutcome: string;
  reviewerJudgment: string;
  proposedRootCause: string;
  correctiveAction: string;
  scopeJson: string;
  analysisAreasJson: string;
  causeConfidence: number;
  supportCount: number;
  status: string;
  errorBookEntryId: string | null;
  proceduralRuleId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ErrorBookEntryRow {
  errorBookEntryId: string;
  errorClass: string;
  title: string;
  unsafeBehaviorPattern: string;
  context: string;
  rootCause: string;
  correction: string;
  severity: string;
  occurrenceCount: number;
  lastOccurrenceAt: string;
  recurrenceStatus: string;
  projectId: string | null;
  platform: string | null;
  marketplace: string | null;
  category: string | null;
  productType: string | null;
  analysisAreasJson: string;
  affectedCapabilityVersionsJson: string;
  regressionTestIdsJson: string;
  linkedLearningEventIdsJson: string;
  linkedProceduralRuleIdsJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProceduralRuleRow {
  proceduralRuleId: string;
  version: number;
  title: string;
  statement: string;
  status: string;
  authority: string;
  analysisAreasJson: string;
  platform: string | null;
  marketplace: string | null;
  category: string | null;
  productType: string | null;
  projectId: string | null;
  errorBookEntryId: string | null;
  lessonCandidateId: string | null;
  learningEventIdsJson: string;
  regressionTestIdsJson: string;
  requireDirectCustomerEvidence: number;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryEvaluationRow {
  evaluationId: string;
  memoryId: string;
  projectId: string;
  runId: string | null;
  judgment: string;
  notes: string | null;
  reviewerId: string;
  createdAt: string;
}

function mapOutcome(r: Record<string, unknown>): OutcomeReviewRow {
  return {
    outcomeReviewId: r.outcome_review_id as string,
    projectId: r.project_id as string,
    runId: r.run_id as string,
    judgment: r.judgment as string,
    notes: (r.notes as string | null) ?? null,
    reviewerId: r.reviewer_id as string,
    lessonCandidateId: (r.lesson_candidate_id as string | null) ?? null,
    createdAt: r.created_at as string
  };
}

function mapLesson(r: Record<string, unknown>): LessonCandidateRow {
  return {
    lessonCandidateId: r.lesson_candidate_id as string,
    projectId: r.project_id as string,
    learningEventId: (r.learning_event_id as string | null) ?? null,
    sourceRunId: (r.source_run_id as string | null) ?? null,
    sourceFindingId: (r.source_finding_id as string | null) ?? null,
    actionTaken: r.action_taken as string,
    observedOutcome: r.observed_outcome as string,
    reviewerJudgment: r.reviewer_judgment as string,
    proposedRootCause: r.proposed_root_cause as string,
    correctiveAction: r.corrective_action as string,
    scopeJson: (r.scope_json as string) ?? "{}",
    analysisAreasJson: (r.analysis_areas_json as string) ?? "[]",
    causeConfidence: Number(r.cause_confidence ?? 0.5),
    supportCount: Number(r.support_count ?? 1),
    status: r.status as string,
    errorBookEntryId: (r.error_book_entry_id as string | null) ?? null,
    proceduralRuleId: (r.procedural_rule_id as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string
  };
}

function mapErrorBook(r: Record<string, unknown>): ErrorBookEntryRow {
  return {
    errorBookEntryId: r.error_book_entry_id as string,
    errorClass: r.error_class as string,
    title: r.title as string,
    unsafeBehaviorPattern: r.unsafe_behavior_pattern as string,
    context: r.context as string,
    rootCause: r.root_cause as string,
    correction: r.correction as string,
    severity: r.severity as string,
    occurrenceCount: Number(r.occurrence_count ?? 1),
    lastOccurrenceAt: r.last_occurrence_at as string,
    recurrenceStatus: r.recurrence_status as string,
    projectId: (r.project_id as string | null) ?? null,
    platform: (r.platform as string | null) ?? null,
    marketplace: (r.marketplace as string | null) ?? null,
    category: (r.category as string | null) ?? null,
    productType: (r.product_type as string | null) ?? null,
    analysisAreasJson: (r.analysis_areas_json as string) ?? "[]",
    affectedCapabilityVersionsJson: (r.affected_capability_versions_json as string) ?? "[]",
    regressionTestIdsJson: (r.regression_test_ids_json as string) ?? "[]",
    linkedLearningEventIdsJson: (r.linked_learning_event_ids_json as string) ?? "[]",
    linkedProceduralRuleIdsJson: (r.linked_procedural_rule_ids_json as string) ?? "[]",
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string
  };
}

function mapRule(r: Record<string, unknown>): ProceduralRuleRow {
  return {
    proceduralRuleId: r.procedural_rule_id as string,
    version: Number(r.version ?? 1),
    title: r.title as string,
    statement: r.statement as string,
    status: r.status as string,
    authority: r.authority as string,
    analysisAreasJson: (r.analysis_areas_json as string) ?? "[]",
    platform: (r.platform as string | null) ?? null,
    marketplace: (r.marketplace as string | null) ?? null,
    category: (r.category as string | null) ?? null,
    productType: (r.product_type as string | null) ?? null,
    projectId: (r.project_id as string | null) ?? null,
    errorBookEntryId: (r.error_book_entry_id as string | null) ?? null,
    lessonCandidateId: (r.lesson_candidate_id as string | null) ?? null,
    learningEventIdsJson: (r.learning_event_ids_json as string) ?? "[]",
    regressionTestIdsJson: (r.regression_test_ids_json as string) ?? "[]",
    requireDirectCustomerEvidence: Number(r.require_direct_customer_evidence ?? 0),
    approvedBy: (r.approved_by as string | null) ?? null,
    approvedAt: (r.approved_at as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string
  };
}

export class OutcomeReviewsRepository {
  constructor(private readonly db: BetterSqlite) {}

  insert(row: OutcomeReviewRow): void {
    this.db
      .prepare(
        `INSERT INTO outcome_reviews
         (outcome_review_id, project_id, run_id, judgment, notes, reviewer_id,
          lesson_candidate_id, created_at)
         VALUES (@outcomeReviewId, @projectId, @runId, @judgment, @notes, @reviewerId,
                 @lessonCandidateId, @createdAt)`
      )
      .run(row);
  }

  listByRun(runId: string): OutcomeReviewRow[] {
    return this.db
      .prepare(`SELECT * FROM outcome_reviews WHERE run_id = ? ORDER BY created_at`)
      .all(runId)
      .map((r) => mapOutcome(r as Record<string, unknown>));
  }
}

export class LessonCandidatesRepository {
  constructor(private readonly db: BetterSqlite) {}

  insert(row: LessonCandidateRow): void {
    this.db
      .prepare(
        `INSERT INTO lesson_candidates
         (lesson_candidate_id, project_id, learning_event_id, source_run_id, source_finding_id,
          action_taken, observed_outcome, reviewer_judgment, proposed_root_cause, corrective_action,
          scope_json, analysis_areas_json, cause_confidence, support_count, status,
          error_book_entry_id, procedural_rule_id, created_at, updated_at)
         VALUES (@lessonCandidateId, @projectId, @learningEventId, @sourceRunId, @sourceFindingId,
                 @actionTaken, @observedOutcome, @reviewerJudgment, @proposedRootCause, @correctiveAction,
                 @scopeJson, @analysisAreasJson, @causeConfidence, @supportCount, @status,
                 @errorBookEntryId, @proceduralRuleId, @createdAt, @updatedAt)`
      )
      .run(row);
  }

  getById(id: string): LessonCandidateRow | undefined {
    const r = this.db.prepare(`SELECT * FROM lesson_candidates WHERE lesson_candidate_id = ?`).get(id);
    return r ? mapLesson(r as Record<string, unknown>) : undefined;
  }

  listByProject(projectId: string): LessonCandidateRow[] {
    return this.db
      .prepare(
        `SELECT * FROM lesson_candidates WHERE project_id = ? ORDER BY created_at DESC`
      )
      .all(projectId)
      .map((r) => mapLesson(r as Record<string, unknown>));
  }

  updateStatus(
    id: string,
    status: string,
    updatedAt: string,
    extras?: Partial<Pick<LessonCandidateRow, "errorBookEntryId" | "proceduralRuleId">>
  ): void {
    const current = this.getById(id);
    if (!current) return;
    this.db
      .prepare(
        `UPDATE lesson_candidates SET status = ?, error_book_entry_id = ?, procedural_rule_id = ?, updated_at = ?
         WHERE lesson_candidate_id = ?`
      )
      .run(
        status,
        extras?.errorBookEntryId ?? current.errorBookEntryId,
        extras?.proceduralRuleId ?? current.proceduralRuleId,
        updatedAt,
        id
      );
  }

  parseAreas(row: LessonCandidateRow): string[] {
    return parseJsonArray(row.analysisAreasJson);
  }

  parseScope(row: LessonCandidateRow): Record<string, string> {
    return parseJsonObject(row.scopeJson);
  }
}

export class ErrorBookRepository {
  constructor(private readonly db: BetterSqlite) {}

  insert(row: ErrorBookEntryRow): void {
    this.db
      .prepare(
        `INSERT INTO error_book_entries
         (error_book_entry_id, error_class, title, unsafe_behavior_pattern, context, root_cause,
          correction, severity, occurrence_count, last_occurrence_at, recurrence_status,
          project_id, platform, marketplace, category, product_type, analysis_areas_json,
          affected_capability_versions_json, regression_test_ids_json,
          linked_learning_event_ids_json, linked_procedural_rule_ids_json, created_at, updated_at)
         VALUES (@errorBookEntryId, @errorClass, @title, @unsafeBehaviorPattern, @context, @rootCause,
                 @correction, @severity, @occurrenceCount, @lastOccurrenceAt, @recurrenceStatus,
                 @projectId, @platform, @marketplace, @category, @productType, @analysisAreasJson,
                 @affectedCapabilityVersionsJson, @regressionTestIdsJson,
                 @linkedLearningEventIdsJson, @linkedProceduralRuleIdsJson, @createdAt, @updatedAt)`
      )
      .run(row);
  }

  getById(id: string): ErrorBookEntryRow | undefined {
    const r = this.db.prepare(`SELECT * FROM error_book_entries WHERE error_book_entry_id = ?`).get(id);
    return r ? mapErrorBook(r as Record<string, unknown>) : undefined;
  }

  findOpenByClassAndScope(input: {
    errorClass: string;
    projectId?: string | null;
    platform?: string | null;
    category?: string | null;
    productType?: string | null;
  }): ErrorBookEntryRow | undefined {
    const rows = this.db
      .prepare(
        `SELECT * FROM error_book_entries
         WHERE error_class = ?
           AND (project_id IS NULL OR project_id = ?)
           AND (platform IS NULL OR ? IS NULL OR platform = ?)
           AND (category IS NULL OR ? IS NULL OR category = ?)
           AND (product_type IS NULL OR ? IS NULL OR product_type = ?)
           AND recurrence_status != 'resolved'
         ORDER BY updated_at DESC
         LIMIT 1`
      )
      .all(
        input.errorClass,
        input.projectId ?? null,
        input.platform ?? null,
        input.platform ?? null,
        input.category ?? null,
        input.category ?? null,
        input.productType ?? null,
        input.productType ?? null
      );
    const r = rows[0];
    return r ? mapErrorBook(r as Record<string, unknown>) : undefined;
  }

  list(filter?: { projectId?: string; errorClass?: string }): ErrorBookEntryRow[] {
    let sql = `SELECT * FROM error_book_entries WHERE 1=1`;
    const params: unknown[] = [];
    if (filter?.projectId) {
      sql += ` AND (project_id = ? OR project_id IS NULL)`;
      params.push(filter.projectId);
    }
    if (filter?.errorClass) {
      sql += ` AND error_class = ?`;
      params.push(filter.errorClass);
    }
    sql += ` ORDER BY last_occurrence_at DESC`;
    return this.db
      .prepare(sql)
      .all(...params)
      .map((r) => mapErrorBook(r as Record<string, unknown>));
  }

  updateOccurrence(
    id: string,
    input: {
      occurrenceCount: number;
      lastOccurrenceAt: string;
      recurrenceStatus: string;
      linkedLearningEventIdsJson: string;
      linkedProceduralRuleIdsJson?: string;
      updatedAt: string;
    }
  ): void {
    this.db
      .prepare(
        `UPDATE error_book_entries
         SET occurrence_count = ?, last_occurrence_at = ?, recurrence_status = ?,
             linked_learning_event_ids_json = ?,
             linked_procedural_rule_ids_json = COALESCE(?, linked_procedural_rule_ids_json),
             updated_at = ?
         WHERE error_book_entry_id = ?`
      )
      .run(
        input.occurrenceCount,
        input.lastOccurrenceAt,
        input.recurrenceStatus,
        input.linkedLearningEventIdsJson,
        input.linkedProceduralRuleIdsJson ?? null,
        input.updatedAt,
        id
      );
  }

  linkProceduralRule(id: string, ruleId: string, updatedAt: string): void {
    const row = this.getById(id);
    if (!row) return;
    const ids = parseJsonArray(row.linkedProceduralRuleIdsJson);
    if (!ids.includes(ruleId)) ids.push(ruleId);
    this.db
      .prepare(
        `UPDATE error_book_entries SET linked_procedural_rule_ids_json = ?, updated_at = ?
         WHERE error_book_entry_id = ?`
      )
      .run(JSON.stringify(ids), updatedAt, id);
  }

  parseAreas(row: ErrorBookEntryRow): string[] {
    return parseJsonArray(row.analysisAreasJson);
  }

  parseRegressionTests(row: ErrorBookEntryRow): string[] {
    return parseJsonArray(row.regressionTestIdsJson);
  }
}

export class ProceduralRulesRepository {
  constructor(private readonly db: BetterSqlite) {}

  insert(row: ProceduralRuleRow): void {
    this.db
      .prepare(
        `INSERT INTO procedural_rules
         (procedural_rule_id, version, title, statement, status, authority, analysis_areas_json,
          platform, marketplace, category, product_type, project_id, error_book_entry_id,
          lesson_candidate_id, learning_event_ids_json, regression_test_ids_json,
          require_direct_customer_evidence, approved_by, approved_at, created_at, updated_at)
         VALUES (@proceduralRuleId, @version, @title, @statement, @status, @authority, @analysisAreasJson,
                 @platform, @marketplace, @category, @productType, @projectId, @errorBookEntryId,
                 @lessonCandidateId, @learningEventIdsJson, @regressionTestIdsJson,
                 @requireDirectCustomerEvidence, @approvedBy, @approvedAt, @createdAt, @updatedAt)`
      )
      .run(row);
  }

  getById(id: string): ProceduralRuleRow | undefined {
    const r = this.db.prepare(`SELECT * FROM procedural_rules WHERE procedural_rule_id = ?`).get(id);
    return r ? mapRule(r as Record<string, unknown>) : undefined;
  }

  list(filter?: { projectId?: string; status?: string }): ProceduralRuleRow[] {
    let sql = `SELECT * FROM procedural_rules WHERE 1=1`;
    const params: unknown[] = [];
    if (filter?.projectId) {
      sql += ` AND (project_id = ? OR project_id IS NULL)`;
      params.push(filter.projectId);
    }
    if (filter?.status) {
      sql += ` AND status = ?`;
      params.push(filter.status);
    }
    sql += ` ORDER BY updated_at DESC`;
    return this.db
      .prepare(sql)
      .all(...params)
      .map((r) => mapRule(r as Record<string, unknown>));
  }

  listActiveForScope(input: {
    projectId?: string;
    platform?: string;
    marketplace?: string;
    category?: string;
    productType?: string;
    analysisAreas?: string[];
  }): ProceduralRuleRow[] {
    const rows = this.list({ status: "active" });
    return rows.filter((r) => {
      if (r.projectId && input.projectId && r.projectId !== input.projectId) return false;
      if (r.platform && input.platform && r.platform !== input.platform) return false;
      if (r.marketplace && input.marketplace && r.marketplace !== input.marketplace) return false;
      if (r.category && input.category && r.category !== input.category) return false;
      if (r.productType && input.productType && r.productType !== input.productType) return false;
      if (input.analysisAreas?.length) {
        const areas = parseJsonArray(r.analysisAreasJson);
        if (areas.length > 0 && !areas.some((a) => input.analysisAreas!.includes(a))) {
          return false;
        }
      }
      return r.authority === "procedural_active";
    });
  }

  updateStatus(
    id: string,
    input: {
      status: string;
      authority: string;
      approvedBy?: string | null;
      approvedAt?: string | null;
      updatedAt: string;
    }
  ): void {
    this.db
      .prepare(
        `UPDATE procedural_rules
         SET status = ?, authority = ?, approved_by = COALESCE(?, approved_by),
             approved_at = COALESCE(?, approved_at), updated_at = ?
         WHERE procedural_rule_id = ?`
      )
      .run(
        input.status,
        input.authority,
        input.approvedBy ?? null,
        input.approvedAt ?? null,
        input.updatedAt,
        id
      );
  }

  setLessonCandidateId(id: string, lessonCandidateId: string, updatedAt: string): void {
    this.db
      .prepare(
        `UPDATE procedural_rules SET lesson_candidate_id = ?, updated_at = ?
         WHERE procedural_rule_id = ?`
      )
      .run(lessonCandidateId, updatedAt, id);
  }

  parseAreas(row: ProceduralRuleRow): string[] {
    return parseJsonArray(row.analysisAreasJson);
  }

  parseRegressionTests(row: ProceduralRuleRow): string[] {
    return parseJsonArray(row.regressionTestIdsJson);
  }
}

export class MemoryEvaluationsRepository {
  constructor(private readonly db: BetterSqlite) {}

  insert(row: MemoryEvaluationRow): void {
    this.db
      .prepare(
        `INSERT INTO memory_evaluations
         (evaluation_id, memory_id, project_id, run_id, judgment, notes, reviewer_id, created_at)
         VALUES (@evaluationId, @memoryId, @projectId, @runId, @judgment, @notes, @reviewerId, @createdAt)`
      )
      .run(row);
  }

  listByMemory(memoryId: string): MemoryEvaluationRow[] {
    return this.db
      .prepare(`SELECT * FROM memory_evaluations WHERE memory_id = ? ORDER BY created_at`)
      .all(memoryId)
      .map((r) => {
        const row = r as Record<string, unknown>;
        return {
          evaluationId: row.evaluation_id as string,
          memoryId: row.memory_id as string,
          projectId: row.project_id as string,
          runId: (row.run_id as string | null) ?? null,
          judgment: row.judgment as string,
          notes: (row.notes as string | null) ?? null,
          reviewerId: row.reviewer_id as string,
          createdAt: row.created_at as string
        };
      });
  }
}
