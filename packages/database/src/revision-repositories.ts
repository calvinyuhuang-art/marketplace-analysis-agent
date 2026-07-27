import type { SqliteDatabase } from "./connection";

export interface LearningEventRow {
  learningEventId: string;
  projectId: string;
  eventType: string;
  reasonCode: string | null;
  notes: string | null;
  sourceRunId: string | null;
  sourceFindingId: string | null;
  revisionRunId: string | null;
  payloadJson: string;
  promotionStatus: string;
  createdAt: string;
}

export class LearningEventsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(row: LearningEventRow): void {
    this.db
      .prepare(
        `INSERT INTO learning_events
          (learning_event_id, project_id, event_type, reason_code, notes,
           source_run_id, source_finding_id, revision_run_id, payload_json,
           promotion_status, created_at)
         VALUES
          (@learningEventId, @projectId, @eventType, @reasonCode, @notes,
           @sourceRunId, @sourceFindingId, @revisionRunId, @payloadJson,
           @promotionStatus, @createdAt)`
      )
      .run(row);
  }

  listByProject(projectId: string, limit = 100): LearningEventRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM learning_events WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`
      )
      .all(projectId, limit) as Record<string, unknown>[];
    return rows.map(mapLearning);
  }

  listByRun(runId: string): LearningEventRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM learning_events
         WHERE source_run_id = ? OR revision_run_id = ?
         ORDER BY created_at`
      )
      .all(runId, runId) as Record<string, unknown>[];
    return rows.map(mapLearning);
  }

  updatePromotionStatus(learningEventId: string, promotionStatus: string): void {
    this.db
      .prepare(`UPDATE learning_events SET promotion_status = ? WHERE learning_event_id = ?`)
      .run(promotionStatus, learningEventId);
  }
}

function mapLearning(r: Record<string, unknown>): LearningEventRow {
  return {
    learningEventId: r.learning_event_id as string,
    projectId: r.project_id as string,
    eventType: r.event_type as string,
    reasonCode: (r.reason_code as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    sourceRunId: (r.source_run_id as string | null) ?? null,
    sourceFindingId: (r.source_finding_id as string | null) ?? null,
    revisionRunId: (r.revision_run_id as string | null) ?? null,
    payloadJson: r.payload_json as string,
    promotionStatus: r.promotion_status as string,
    createdAt: r.created_at as string
  };
}

export interface RunReviewRow {
  reviewId: string;
  runId: string;
  action: string;
  reasonCode: string | null;
  notes: string | null;
  reviewerId: string;
  createdAt: string;
}

export class RunReviewsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(row: RunReviewRow): void {
    this.db
      .prepare(
        `INSERT INTO run_reviews
          (review_id, run_id, action, reason_code, notes, reviewer_id, created_at)
         VALUES
          (@reviewId, @runId, @action, @reasonCode, @notes, @reviewerId, @createdAt)`
      )
      .run(row);
  }

  listByRun(runId: string): RunReviewRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM run_reviews WHERE run_id = ? ORDER BY created_at`)
      .all(runId) as Record<string, unknown>[];
    return rows.map((r) => ({
      reviewId: r.review_id as string,
      runId: r.run_id as string,
      action: r.action as string,
      reasonCode: (r.reason_code as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      reviewerId: r.reviewer_id as string,
      createdAt: r.created_at as string
    }));
  }
}

export interface RevisionDiffRow {
  diffId: string;
  priorRunId: string;
  revisionRunId: string;
  artifactId: string | null;
  payloadJson: string;
  createdAt: string;
}

export class RevisionDiffsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(row: RevisionDiffRow): void {
    this.db
      .prepare(
        `INSERT INTO revision_diffs
          (diff_id, prior_run_id, revision_run_id, artifact_id, payload_json, created_at)
         VALUES
          (@diffId, @priorRunId, @revisionRunId, @artifactId, @payloadJson, @createdAt)`
      )
      .run(row);
  }

  getByRevisionRun(revisionRunId: string): RevisionDiffRow | undefined {
    const r = this.db
      .prepare(`SELECT * FROM revision_diffs WHERE revision_run_id = ?`)
      .get(revisionRunId) as Record<string, unknown> | undefined;
    if (!r) return undefined;
    return {
      diffId: r.diff_id as string,
      priorRunId: r.prior_run_id as string,
      revisionRunId: r.revision_run_id as string,
      artifactId: (r.artifact_id as string | null) ?? null,
      payloadJson: r.payload_json as string,
      createdAt: r.created_at as string
    };
  }
}
