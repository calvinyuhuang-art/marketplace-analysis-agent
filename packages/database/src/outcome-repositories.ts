import type { SqliteDatabase } from "./connection";

export interface OutcomeEventRow {
  outcomeId: string;
  projectId: string;
  eventType: string;
  measurementWindowJson: string;
  metricsJson: string;
  source: string;
  confidence: number | null;
  linkedArtifactIdsJson: string;
  linkedFindingIdsJson: string;
  linkedExperienceId: string | null;
  linkedRunId: string | null;
  occurredAt: string;
  receivedAt: string;
  createdAt: string;
}

export interface OutcomeReassessmentRow {
  reassessmentId: string;
  outcomeId: string;
  experienceId: string | null;
  runId: string | null;
  judgmentsJson: string;
  reportArtifactId: string;
  lessonCandidateIdsJson: string;
  createdAt: string;
}

function mapOutcome(r: Record<string, unknown>): OutcomeEventRow {
  return {
    outcomeId: String(r.outcome_id),
    projectId: String(r.project_id),
    eventType: String(r.event_type),
    measurementWindowJson: String(r.measurement_window_json ?? "{}"),
    metricsJson: String(r.metrics_json ?? "{}"),
    source: String(r.source),
    confidence: r.confidence == null ? null : Number(r.confidence),
    linkedArtifactIdsJson: String(r.linked_artifact_ids_json ?? "[]"),
    linkedFindingIdsJson: String(r.linked_finding_ids_json ?? "[]"),
    linkedExperienceId:
      r.linked_experience_id == null ? null : String(r.linked_experience_id),
    linkedRunId: r.linked_run_id == null ? null : String(r.linked_run_id),
    occurredAt: String(r.occurred_at),
    receivedAt: String(r.received_at),
    createdAt: String(r.created_at)
  };
}

function mapReassessment(r: Record<string, unknown>): OutcomeReassessmentRow {
  return {
    reassessmentId: String(r.reassessment_id),
    outcomeId: String(r.outcome_id),
    experienceId: r.experience_id == null ? null : String(r.experience_id),
    runId: r.run_id == null ? null : String(r.run_id),
    judgmentsJson: String(r.judgments_json),
    reportArtifactId: String(r.report_artifact_id),
    lessonCandidateIdsJson: String(r.lesson_candidate_ids_json ?? "[]"),
    createdAt: String(r.created_at)
  };
}

export class OutcomeEventsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(row: OutcomeEventRow): void {
    this.db
      .prepare(
        `INSERT INTO outcome_events
          (outcome_id, project_id, event_type, measurement_window_json, metrics_json,
           source, confidence, linked_artifact_ids_json, linked_finding_ids_json,
           linked_experience_id, linked_run_id, occurred_at, received_at, created_at)
         VALUES
          (@outcomeId, @projectId, @eventType, @measurementWindowJson, @metricsJson,
           @source, @confidence, @linkedArtifactIdsJson, @linkedFindingIdsJson,
           @linkedExperienceId, @linkedRunId, @occurredAt, @receivedAt, @createdAt)`
      )
      .run(row);
  }

  getById(outcomeId: string): OutcomeEventRow | undefined {
    const row = this.db
      .prepare(`SELECT * FROM outcome_events WHERE outcome_id = ?`)
      .get(outcomeId) as Record<string, unknown> | undefined;
    return row ? mapOutcome(row) : undefined;
  }

  listByProject(projectId: string): OutcomeEventRow[] {
    return this.db
      .prepare(
        `SELECT * FROM outcome_events WHERE project_id = ? ORDER BY occurred_at DESC`
      )
      .all(projectId)
      .map((r) => mapOutcome(r as Record<string, unknown>));
  }
}

export class OutcomeReassessmentsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(row: OutcomeReassessmentRow): void {
    this.db
      .prepare(
        `INSERT INTO outcome_reassessments
          (reassessment_id, outcome_id, experience_id, run_id, judgments_json,
           report_artifact_id, lesson_candidate_ids_json, created_at)
         VALUES
          (@reassessmentId, @outcomeId, @experienceId, @runId, @judgmentsJson,
           @reportArtifactId, @lessonCandidateIdsJson, @createdAt)`
      )
      .run(row);
  }

  getById(reassessmentId: string): OutcomeReassessmentRow | undefined {
    const row = this.db
      .prepare(`SELECT * FROM outcome_reassessments WHERE reassessment_id = ?`)
      .get(reassessmentId) as Record<string, unknown> | undefined;
    return row ? mapReassessment(row) : undefined;
  }

  getByRunId(runId: string): OutcomeReassessmentRow | undefined {
    const row = this.db
      .prepare(`SELECT * FROM outcome_reassessments WHERE run_id = ?`)
      .get(runId) as Record<string, unknown> | undefined;
    return row ? mapReassessment(row) : undefined;
  }

  listByOutcome(outcomeId: string): OutcomeReassessmentRow[] {
    return this.db
      .prepare(
        `SELECT * FROM outcome_reassessments WHERE outcome_id = ? ORDER BY created_at ASC`
      )
      .all(outcomeId)
      .map((r) => mapReassessment(r as Record<string, unknown>));
  }
}
