import type { SqliteDatabase } from "./connection";

export interface GapFingerprintRow {
  fingerprintId: string;
  fingerprintKey: string;
  fingerprintVersion: string;
  componentsJson: string;
  projectId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  distinctRunCount: number;
  distinctProjectCount: number;
}

export class GapFingerprintsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(row: GapFingerprintRow): void {
    this.db
      .prepare(
        `INSERT INTO gap_fingerprints
          (fingerprint_id, fingerprint_key, fingerprint_version, components_json, project_id,
           first_seen_at, last_seen_at, distinct_run_count, distinct_project_count)
         VALUES
          (@fingerprintId, @fingerprintKey, @fingerprintVersion, @componentsJson, @projectId,
           @firstSeenAt, @lastSeenAt, @distinctRunCount, @distinctProjectCount)`
      )
      .run(row);
  }

  getByKey(fingerprintKey: string): GapFingerprintRow | undefined {
    const row = this.db
      .prepare(`SELECT * FROM gap_fingerprints WHERE fingerprint_key = ?`)
      .get(fingerprintKey) as Record<string, unknown> | undefined;
    return row ? mapFingerprint(row) : undefined;
  }

  getById(fingerprintId: string): GapFingerprintRow | undefined {
    const row = this.db
      .prepare(`SELECT * FROM gap_fingerprints WHERE fingerprint_id = ?`)
      .get(fingerprintId) as Record<string, unknown> | undefined;
    return row ? mapFingerprint(row) : undefined;
  }

  touch(input: {
    fingerprintId: string;
    lastSeenAt: string;
    distinctRunCount: number;
    distinctProjectCount: number;
  }): void {
    this.db
      .prepare(
        `UPDATE gap_fingerprints SET
           last_seen_at = @lastSeenAt,
           distinct_run_count = @distinctRunCount,
           distinct_project_count = @distinctProjectCount
         WHERE fingerprint_id = @fingerprintId`
      )
      .run(input);
  }
}

function mapFingerprint(r: Record<string, unknown>): GapFingerprintRow {
  return {
    fingerprintId: r.fingerprint_id as string,
    fingerprintKey: r.fingerprint_key as string,
    fingerprintVersion: r.fingerprint_version as string,
    componentsJson: r.components_json as string,
    projectId: r.project_id as string,
    firstSeenAt: r.first_seen_at as string,
    lastSeenAt: r.last_seen_at as string,
    distinctRunCount: r.distinct_run_count as number,
    distinctProjectCount: r.distinct_project_count as number
  };
}

export interface WorkflowFeedbackRow {
  workflowFeedbackId: string;
  status: string;
  projectId: string;
  runId: string;
  requestId: string;
  experienceId: string | null;
  externalWorkOrderId: string | null;
  correlationId: string | null;
  sourceAgentId: string;
  discoveringAgentId: string;
  upstreamStepKey: string;
  downstreamStepKey: string;
  feedbackType: string;
  gapFingerprintId: string;
  missingRequirementJson: string;
  originalArtifactIdsJson: string;
  collectionRequestIdsJson: string;
  resolutionAction: string | null;
  supplementalEvidencePackageIdsJson: string;
  revisionRunId: string | null;
  resolutionQuality: string | null;
  resolved: number | null;
  addedDurationMs: number | null;
  addedCostUsd: number | null;
  addedCollectionRounds: number | null;
  candidateLessonStatus: string;
  reportArtifactId: string | null;
  detectedAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export class WorkflowFeedbackRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(row: WorkflowFeedbackRow): boolean {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO workflow_feedback_events
          (workflow_feedback_id, status, project_id, run_id, request_id, experience_id,
           external_work_order_id, correlation_id, source_agent_id, discovering_agent_id,
           upstream_step_key, downstream_step_key, feedback_type, gap_fingerprint_id,
           missing_requirement_json, original_artifact_ids_json, collection_request_ids_json,
           resolution_action, supplemental_evidence_package_ids_json, revision_run_id,
           resolution_quality, resolved, added_duration_ms, added_cost_usd,
           added_collection_rounds, candidate_lesson_status, report_artifact_id,
           detected_at, updated_at, resolved_at)
         VALUES
          (@workflowFeedbackId, @status, @projectId, @runId, @requestId, @experienceId,
           @externalWorkOrderId, @correlationId, @sourceAgentId, @discoveringAgentId,
           @upstreamStepKey, @downstreamStepKey, @feedbackType, @gapFingerprintId,
           @missingRequirementJson, @originalArtifactIdsJson, @collectionRequestIdsJson,
           @resolutionAction, @supplementalEvidencePackageIdsJson, @revisionRunId,
           @resolutionQuality, @resolved, @addedDurationMs, @addedCostUsd,
           @addedCollectionRounds, @candidateLessonStatus, @reportArtifactId,
           @detectedAt, @updatedAt, @resolvedAt)`
      )
      .run(row);
    return result.changes > 0;
  }

  getById(id: string): WorkflowFeedbackRow | undefined {
    const row = this.db
      .prepare(`SELECT * FROM workflow_feedback_events WHERE workflow_feedback_id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapFeedback(row) : undefined;
  }

  getByRunId(runId: string): WorkflowFeedbackRow | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM workflow_feedback_events WHERE run_id = ? AND feedback_type = 'late_evidence_gap'`
      )
      .get(runId) as Record<string, unknown> | undefined;
    return row ? mapFeedback(row) : undefined;
  }

  listByRun(runId: string): WorkflowFeedbackRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM workflow_feedback_events WHERE run_id = ? ORDER BY detected_at`
      )
      .all(runId) as Record<string, unknown>[];
    return rows.map(mapFeedback);
  }

  getByRevisionRunId(revisionRunId: string): WorkflowFeedbackRow | undefined {
    const row = this.db
      .prepare(`SELECT * FROM workflow_feedback_events WHERE revision_run_id = ?`)
      .get(revisionRunId) as Record<string, unknown> | undefined;
    return row ? mapFeedback(row) : undefined;
  }

  countDistinctRunsForFingerprint(fingerprintId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(DISTINCT run_id) AS c FROM workflow_feedback_events WHERE gap_fingerprint_id = ?`
      )
      .get(fingerprintId) as { c: number };
    return row?.c ?? 0;
  }

  countDistinctProjectsForFingerprint(fingerprintId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(DISTINCT project_id) AS c FROM workflow_feedback_events WHERE gap_fingerprint_id = ?`
      )
      .get(fingerprintId) as { c: number };
    return row?.c ?? 0;
  }

  projectSeenForFingerprint(fingerprintId: string, projectId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS ok FROM workflow_feedback_events
         WHERE gap_fingerprint_id = ? AND project_id = ? LIMIT 1`
      )
      .get(fingerprintId, projectId) as { ok: number } | undefined;
    return Boolean(row);
  }

  update(input: Partial<WorkflowFeedbackRow> & { workflowFeedbackId: string; updatedAt: string }): void {
    const existing = this.getById(input.workflowFeedbackId);
    if (!existing) return;
    const merged: WorkflowFeedbackRow = { ...existing, ...input };
    this.db
      .prepare(
        `UPDATE workflow_feedback_events SET
           status = @status,
           resolution_action = @resolutionAction,
           supplemental_evidence_package_ids_json = @supplementalEvidencePackageIdsJson,
           revision_run_id = @revisionRunId,
           resolution_quality = @resolutionQuality,
           resolved = @resolved,
           added_duration_ms = @addedDurationMs,
           added_cost_usd = @addedCostUsd,
           added_collection_rounds = @addedCollectionRounds,
           candidate_lesson_status = @candidateLessonStatus,
           collection_request_ids_json = @collectionRequestIdsJson,
           report_artifact_id = @reportArtifactId,
           updated_at = @updatedAt,
           resolved_at = @resolvedAt
         WHERE workflow_feedback_id = @workflowFeedbackId`
      )
      .run(merged);
  }
}

function mapFeedback(r: Record<string, unknown>): WorkflowFeedbackRow {
  return {
    workflowFeedbackId: r.workflow_feedback_id as string,
    status: r.status as string,
    projectId: r.project_id as string,
    runId: r.run_id as string,
    requestId: r.request_id as string,
    experienceId: (r.experience_id as string | null) ?? null,
    externalWorkOrderId: (r.external_work_order_id as string | null) ?? null,
    correlationId: (r.correlation_id as string | null) ?? null,
    sourceAgentId: r.source_agent_id as string,
    discoveringAgentId: r.discovering_agent_id as string,
    upstreamStepKey: r.upstream_step_key as string,
    downstreamStepKey: r.downstream_step_key as string,
    feedbackType: r.feedback_type as string,
    gapFingerprintId: r.gap_fingerprint_id as string,
    missingRequirementJson: r.missing_requirement_json as string,
    originalArtifactIdsJson: r.original_artifact_ids_json as string,
    collectionRequestIdsJson: r.collection_request_ids_json as string,
    resolutionAction: (r.resolution_action as string | null) ?? null,
    supplementalEvidencePackageIdsJson: r.supplemental_evidence_package_ids_json as string,
    revisionRunId: (r.revision_run_id as string | null) ?? null,
    resolutionQuality: (r.resolution_quality as string | null) ?? null,
    resolved: (r.resolved as number | null) ?? null,
    addedDurationMs: (r.added_duration_ms as number | null) ?? null,
    addedCostUsd: (r.added_cost_usd as number | null) ?? null,
    addedCollectionRounds: (r.added_collection_rounds as number | null) ?? null,
    candidateLessonStatus: r.candidate_lesson_status as string,
    reportArtifactId: (r.report_artifact_id as string | null) ?? null,
    detectedAt: r.detected_at as string,
    updatedAt: r.updated_at as string,
    resolvedAt: (r.resolved_at as string | null) ?? null
  };
}
