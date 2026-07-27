import type { SqliteDatabase } from "./connection";

export interface FindingRow {
  findingId: string;
  runId: string;
  analysisArea: string;
  classification: string;
  statement: string;
  confidence: number;
  validationStatus: string;
  scopeKey: string | null;
  freshnessStatus: string | null;
  payloadJson: string;
  supersedesFindingId: string | null;
  supersededByFindingId: string | null;
  createdAt: string;
  updatedAt: string;
}

export class FindingsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(row: FindingRow): void {
    this.db
      .prepare(
        `INSERT INTO analysis_findings
          (finding_id, run_id, analysis_area, classification, statement, confidence,
           validation_status, scope_key, freshness_status, payload_json,
           supersedes_finding_id, superseded_by_finding_id, created_at, updated_at)
         VALUES
          (@findingId, @runId, @analysisArea, @classification, @statement, @confidence,
           @validationStatus, @scopeKey, @freshnessStatus, @payloadJson,
           @supersedesFindingId, @supersededByFindingId, @createdAt, @updatedAt)`
      )
      .run({
        ...row,
        supersedesFindingId: row.supersedesFindingId ?? null,
        supersededByFindingId: row.supersededByFindingId ?? null
      });
  }

  listByRun(runId: string): FindingRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM analysis_findings WHERE run_id = ? ORDER BY created_at`)
      .all(runId) as Record<string, unknown>[];
    return rows.map(mapFinding);
  }

  getById(findingId: string): FindingRow | undefined {
    const r = this.db
      .prepare(`SELECT * FROM analysis_findings WHERE finding_id = ?`)
      .get(findingId) as Record<string, unknown> | undefined;
    return r ? mapFinding(r) : undefined;
  }

  updateValidation(findingId: string, validationStatus: string, updatedAt: string): void {
    this.db
      .prepare(
        `UPDATE analysis_findings SET validation_status = ?, updated_at = ?,
           payload_json = json_set(payload_json, '$.validationStatus', ?)
         WHERE finding_id = ?`
      )
      .run(validationStatus, updatedAt, validationStatus, findingId);
  }

  markSuperseded(
    priorFindingId: string,
    newFindingId: string,
    updatedAt: string
  ): void {
    this.db
      .prepare(
        `UPDATE analysis_findings SET validation_status = 'superseded',
           superseded_by_finding_id = ?, updated_at = ?,
           payload_json = json_set(payload_json, '$.validationStatus', 'superseded')
         WHERE finding_id = ?`
      )
      .run(newFindingId, updatedAt, priorFindingId);
    this.db
      .prepare(
        `UPDATE analysis_findings SET supersedes_finding_id = ?, updated_at = ?
         WHERE finding_id = ?`
      )
      .run(priorFindingId, updatedAt, newFindingId);
  }
}

function mapFinding(r: Record<string, unknown>): FindingRow {
  return {
    findingId: r.finding_id as string,
    runId: r.run_id as string,
    analysisArea: r.analysis_area as string,
    classification: r.classification as string,
    statement: r.statement as string,
    confidence: r.confidence as number,
    validationStatus: r.validation_status as string,
    scopeKey: (r.scope_key as string | null) ?? null,
    freshnessStatus: (r.freshness_status as string | null) ?? null,
    payloadJson: r.payload_json as string,
    supersedesFindingId: (r.supersedes_finding_id as string | null) ?? null,
    supersededByFindingId: (r.superseded_by_finding_id as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string
  };
}

export interface AnalysisOutputRow {
  outputId: string;
  runId: string;
  outputType: string;
  schemaVersion: string;
  artifactId: string | null;
  contentHash: string;
  qualityScore: number | null;
  qualityPassed: boolean;
  payloadJson: string;
  createdAt: string;
}

export class AnalysisOutputsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(row: AnalysisOutputRow): void {
    this.db
      .prepare(
        `INSERT INTO analysis_outputs
          (output_id, run_id, output_type, schema_version, artifact_id, content_hash,
           quality_score, quality_passed, payload_json, created_at)
         VALUES
          (@outputId, @runId, @outputType, @schemaVersion, @artifactId, @contentHash,
           @qualityScore, @qualityPassed, @payloadJson, @createdAt)`
      )
      .run({ ...row, qualityPassed: row.qualityPassed ? 1 : 0 });
  }

  getLatestByRun(runId: string): AnalysisOutputRow | undefined {
    const r = this.db
      .prepare(
        `SELECT * FROM analysis_outputs WHERE run_id = ? ORDER BY created_at DESC LIMIT 1`
      )
      .get(runId) as Record<string, unknown> | undefined;
    if (!r) return undefined;
    return {
      outputId: r.output_id as string,
      runId: r.run_id as string,
      outputType: r.output_type as string,
      schemaVersion: r.schema_version as string,
      artifactId: (r.artifact_id as string | null) ?? null,
      contentHash: r.content_hash as string,
      qualityScore: (r.quality_score as number | null) ?? null,
      qualityPassed: (r.quality_passed as number) === 1,
      payloadJson: r.payload_json as string,
      createdAt: r.created_at as string
    };
  }
}

export interface ModelCallRow {
  modelCallId: string;
  runId: string | null;
  requestId: string | null;
  correlationId: string | null;
  provider: string;
  model: string;
  purpose: string;
  fixtureKey: string | null;
  promptVersion: string | null;
  schemaVersion: string | null;
  status: string;
  inputArtifactId: string | null;
  outputArtifactId: string | null;
  tokenInput: number;
  tokenOutput: number;
  costUsd: number;
  latencyMs: number;
  validationErrorsJson: string | null;
  repairAttempt: number;
  createdAt: string;
  completedAt: string | null;
}

export class ModelCallsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(row: ModelCallRow): void {
    this.db
      .prepare(
        `INSERT INTO model_calls
          (model_call_id, run_id, request_id, correlation_id, provider, model, purpose,
           fixture_key, prompt_version, schema_version, status, input_artifact_id,
           output_artifact_id, token_input, token_output, cost_usd, latency_ms,
           validation_errors_json, repair_attempt, created_at, completed_at)
         VALUES
          (@modelCallId, @runId, @requestId, @correlationId, @provider, @model, @purpose,
           @fixtureKey, @promptVersion, @schemaVersion, @status, @inputArtifactId,
           @outputArtifactId, @tokenInput, @tokenOutput, @costUsd, @latencyMs,
           @validationErrorsJson, @repairAttempt, @createdAt, @completedAt)`
      )
      .run(row);
  }

  listByRun(runId: string): ModelCallRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM model_calls WHERE run_id = ? ORDER BY created_at`)
      .all(runId) as Record<string, unknown>[];
    return rows.map((r) => ({
      modelCallId: r.model_call_id as string,
      runId: (r.run_id as string | null) ?? null,
      requestId: (r.request_id as string | null) ?? null,
      correlationId: (r.correlation_id as string | null) ?? null,
      provider: r.provider as string,
      model: r.model as string,
      purpose: r.purpose as string,
      fixtureKey: (r.fixture_key as string | null) ?? null,
      promptVersion: (r.prompt_version as string | null) ?? null,
      schemaVersion: (r.schema_version as string | null) ?? null,
      status: r.status as string,
      inputArtifactId: (r.input_artifact_id as string | null) ?? null,
      outputArtifactId: (r.output_artifact_id as string | null) ?? null,
      tokenInput: r.token_input as number,
      tokenOutput: r.token_output as number,
      costUsd: r.cost_usd as number,
      latencyMs: r.latency_ms as number,
      validationErrorsJson: (r.validation_errors_json as string | null) ?? null,
      repairAttempt: r.repair_attempt as number,
      createdAt: r.created_at as string,
      completedAt: (r.completed_at as string | null) ?? null
    }));
  }
}

export interface FindingReviewRow {
  reviewId: string;
  findingId: string;
  runId: string;
  action: string;
  reasonCode: string | null;
  notes: string | null;
  reviewerId: string;
  createdAt: string;
}

export class FindingReviewsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(row: FindingReviewRow): void {
    this.db
      .prepare(
        `INSERT INTO finding_reviews
          (review_id, finding_id, run_id, action, reason_code, notes, reviewer_id, created_at)
         VALUES
          (@reviewId, @findingId, @runId, @action, @reasonCode, @notes, @reviewerId, @createdAt)`
      )
      .run(row);
  }

  listByFinding(findingId: string): FindingReviewRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM finding_reviews WHERE finding_id = ? ORDER BY created_at`)
      .all(findingId) as Record<string, unknown>[];
    return rows.map((r) => ({
      reviewId: r.review_id as string,
      findingId: r.finding_id as string,
      runId: r.run_id as string,
      action: r.action as string,
      reasonCode: (r.reason_code as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      reviewerId: r.reviewer_id as string,
      createdAt: r.created_at as string
    }));
  }
}
