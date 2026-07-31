import type { SqliteDatabase } from "./connection";

export interface AgentExperienceRow {
  experienceId: string;
  projectId: string;
  requestId: string;
  runId: string;
  attempt: number;
  correlationId: string | null;
  operation: string;
  capabilityKey: string | null;
  capabilityVersion: string | null;
  status: string;
  evidencePackageIdsJson: string;
  contextAssemblyId: string | null;
  inputArtifactIdsJson: string;
  outputArtifactId: string | null;
  tokenInput: number;
  tokenOutput: number;
  costUsd: number;
  summary: string | null;
  provenanceIncomplete: number;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export class AgentExperiencesRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(row: AgentExperienceRow): void {
    this.db
      .prepare(
        `INSERT INTO agent_experiences
          (experience_id, project_id, request_id, run_id, attempt, correlation_id,
           operation, capability_key, capability_version, status,
           evidence_package_ids_json, context_assembly_id, input_artifact_ids_json,
           output_artifact_id, token_input, token_output, cost_usd, summary,
           provenance_incomplete, started_at, completed_at, created_at, updated_at)
         VALUES
          (@experienceId, @projectId, @requestId, @runId, @attempt, @correlationId,
           @operation, @capabilityKey, @capabilityVersion, @status,
           @evidencePackageIdsJson, @contextAssemblyId, @inputArtifactIdsJson,
           @outputArtifactId, @tokenInput, @tokenOutput, @costUsd, @summary,
           @provenanceIncomplete, @startedAt, @completedAt, @createdAt, @updatedAt)`
      )
      .run(row);
  }

  getByRunId(runId: string): AgentExperienceRow | undefined {
    const row = this.db
      .prepare(`SELECT * FROM agent_experiences WHERE run_id = ?`)
      .get(runId) as Record<string, unknown> | undefined;
    return row ? mapExperience(row) : undefined;
  }

  getById(experienceId: string): AgentExperienceRow | undefined {
    const row = this.db
      .prepare(`SELECT * FROM agent_experiences WHERE experience_id = ?`)
      .get(experienceId) as Record<string, unknown> | undefined;
    return row ? mapExperience(row) : undefined;
  }

  complete(input: {
    runId: string;
    status: string;
    contextAssemblyId?: string | null;
    outputArtifactId?: string | null;
    tokenInput?: number;
    tokenOutput?: number;
    costUsd?: number;
    summary?: string | null;
    completedAt: string;
    updatedAt: string;
  }): void {
    const existing = this.getByRunId(input.runId);
    if (!existing) return;
    if (
      existing.status === "completed" ||
      existing.status === "failed" ||
      existing.status === "cancelled"
    ) {
      return;
    }
    this.db
      .prepare(
        `UPDATE agent_experiences SET
           status = @status,
           context_assembly_id = COALESCE(@contextAssemblyId, context_assembly_id),
           output_artifact_id = COALESCE(@outputArtifactId, output_artifact_id),
           token_input = COALESCE(@tokenInput, token_input),
           token_output = COALESCE(@tokenOutput, token_output),
           cost_usd = COALESCE(@costUsd, cost_usd),
           summary = COALESCE(@summary, summary),
           completed_at = @completedAt,
           updated_at = @updatedAt
         WHERE run_id = @runId
           AND status = 'started'`
      )
      .run({
        runId: input.runId,
        status: input.status,
        contextAssemblyId: input.contextAssemblyId ?? null,
        outputArtifactId: input.outputArtifactId ?? null,
        tokenInput: input.tokenInput ?? null,
        tokenOutput: input.tokenOutput ?? null,
        costUsd: input.costUsd ?? null,
        summary: input.summary ?? null,
        completedAt: input.completedAt,
        updatedAt: input.updatedAt
      });
  }
}

function mapExperience(r: Record<string, unknown>): AgentExperienceRow {
  return {
    experienceId: r.experience_id as string,
    projectId: r.project_id as string,
    requestId: r.request_id as string,
    runId: r.run_id as string,
    attempt: r.attempt as number,
    correlationId: (r.correlation_id as string | null) ?? null,
    operation: r.operation as string,
    capabilityKey: (r.capability_key as string | null) ?? null,
    capabilityVersion: (r.capability_version as string | null) ?? null,
    status: r.status as string,
    evidencePackageIdsJson: r.evidence_package_ids_json as string,
    contextAssemblyId: (r.context_assembly_id as string | null) ?? null,
    inputArtifactIdsJson: r.input_artifact_ids_json as string,
    outputArtifactId: (r.output_artifact_id as string | null) ?? null,
    tokenInput: r.token_input as number,
    tokenOutput: r.token_output as number,
    costUsd: r.cost_usd as number,
    summary: (r.summary as string | null) ?? null,
    provenanceIncomplete: r.provenance_incomplete as number,
    startedAt: r.started_at as string,
    completedAt: (r.completed_at as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string
  };
}

export interface AgentEvaluationRow {
  evaluationId: string;
  experienceId: string;
  evaluatorType: string;
  rubricVersion: string;
  decision: string;
  scoresJson: string;
  confidence: number | null;
  feedbackArtifactId: string | null;
  sourceSystem: string;
  sourceRecordId: string;
  createdAt: string;
}

export class AgentEvaluationsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insertIgnoreDuplicate(row: AgentEvaluationRow): boolean {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO agent_evaluations
          (evaluation_id, experience_id, evaluator_type, rubric_version, decision,
           scores_json, confidence, feedback_artifact_id, source_system, source_record_id, created_at)
         VALUES
          (@evaluationId, @experienceId, @evaluatorType, @rubricVersion, @decision,
           @scoresJson, @confidence, @feedbackArtifactId, @sourceSystem, @sourceRecordId, @createdAt)`
      )
      .run(row);
    return result.changes > 0;
  }

  listByExperience(experienceId: string): AgentEvaluationRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM agent_evaluations WHERE experience_id = ? ORDER BY created_at`
      )
      .all(experienceId) as Record<string, unknown>[];
    return rows.map(mapEvaluation);
  }
}

function mapEvaluation(r: Record<string, unknown>): AgentEvaluationRow {
  return {
    evaluationId: r.evaluation_id as string,
    experienceId: r.experience_id as string,
    evaluatorType: r.evaluator_type as string,
    rubricVersion: r.rubric_version as string,
    decision: r.decision as string,
    scoresJson: r.scores_json as string,
    confidence: (r.confidence as number | null) ?? null,
    feedbackArtifactId: (r.feedback_artifact_id as string | null) ?? null,
    sourceSystem: r.source_system as string,
    sourceRecordId: r.source_record_id as string,
    createdAt: r.created_at as string
  };
}
