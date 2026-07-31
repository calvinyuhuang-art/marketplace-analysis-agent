import type { SqliteDatabase } from "./connection";

export interface ProjectRow {
  projectId: string;
  externalProjectId: string | null;
  name: string;
  platform: string;
  marketplace: string;
  category: string;
  productType: string;
  productContextJson: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

function mapProject(r: Record<string, unknown>): ProjectRow {
  return {
    projectId: r.project_id as string,
    externalProjectId: (r.external_project_id as string | null) ?? null,
    name: r.name as string,
    platform: r.platform as string,
    marketplace: r.marketplace as string,
    category: r.category as string,
    productType: r.product_type as string,
    productContextJson: r.product_context_json as string,
    status: r.status as string,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string
  };
}

export class ProjectsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(row: ProjectRow): void {
    this.db
      .prepare(
        `INSERT INTO analysis_projects
          (project_id, external_project_id, name, platform, marketplace, category,
           product_type, product_context_json, status, created_at, updated_at)
         VALUES
          (@projectId, @externalProjectId, @name, @platform, @marketplace, @category,
           @productType, @productContextJson, @status, @createdAt, @updatedAt)`
      )
      .run(row);
  }

  getById(projectId: string): ProjectRow | undefined {
    const r = this.db
      .prepare(`SELECT * FROM analysis_projects WHERE project_id = ?`)
      .get(projectId) as Record<string, unknown> | undefined;
    return r ? mapProject(r) : undefined;
  }

  list(limit = 100): ProjectRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM analysis_projects ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as Record<string, unknown>[];
    return rows.map(mapProject);
  }

  updateProductContext(projectId: string, productContextJson: string, updatedAt: string): void {
    this.db
      .prepare(
        `UPDATE analysis_projects SET product_context_json = ?, updated_at = ? WHERE project_id = ?`
      )
      .run(productContextJson, updatedAt, projectId);
  }
}

export interface AnalysisRequestRow {
  requestId: string;
  projectId: string;
  client: string;
  clientRequestId: string | null;
  externalWorkOrderId: string | null;
  operation: string;
  requestedAnalysisJson: string;
  question: string | null;
  capabilityId: string | null;
  capabilityVersion: string | null;
  modelProfileId: string | null;
  requestPayloadArtifactId: string | null;
  idempotencyKey: string | null;
  requestHash: string | null;
  status: string;
  evidencePlanId: string | null;
  evidencePlanVersion: number | null;
  outcomeId: string | null;
  baselineEvidencePackageIdsJson: string;
  createdAt: string;
  updatedAt: string;
}

function mapRequest(r: Record<string, unknown>): AnalysisRequestRow {
  return {
    requestId: r.request_id as string,
    projectId: r.project_id as string,
    client: r.client as string,
    clientRequestId: (r.client_request_id as string | null) ?? null,
    externalWorkOrderId: (r.external_work_order_id as string | null) ?? null,
    operation: r.operation as string,
    requestedAnalysisJson: r.requested_analysis_json as string,
    question: (r.question as string | null) ?? null,
    capabilityId: (r.capability_id as string | null) ?? null,
    capabilityVersion: (r.capability_version as string | null) ?? null,
    modelProfileId: (r.model_profile_id as string | null) ?? null,
    requestPayloadArtifactId: (r.request_payload_artifact_id as string | null) ?? null,
    idempotencyKey: (r.idempotency_key as string | null) ?? null,
    requestHash: (r.request_hash as string | null) ?? null,
    status: r.status as string,
    evidencePlanId: (r.evidence_plan_id as string | null) ?? null,
    evidencePlanVersion:
      r.evidence_plan_version === null || r.evidence_plan_version === undefined
        ? null
        : (r.evidence_plan_version as number),
    outcomeId: (r.outcome_id as string | null) ?? null,
    baselineEvidencePackageIdsJson: String(
      r.baseline_evidence_package_ids_json ?? "[]"
    ),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string
  };
}

export class AnalysisRequestsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(row: AnalysisRequestRow): void {
    this.db
      .prepare(
        `INSERT INTO analysis_requests
          (request_id, project_id, client, client_request_id, external_work_order_id,
           operation, requested_analysis_json, question, capability_id, capability_version,
           model_profile_id, request_payload_artifact_id, idempotency_key, request_hash,
           status, evidence_plan_id, evidence_plan_version, outcome_id,
           baseline_evidence_package_ids_json, created_at, updated_at)
         VALUES
          (@requestId, @projectId, @client, @clientRequestId, @externalWorkOrderId,
           @operation, @requestedAnalysisJson, @question, @capabilityId, @capabilityVersion,
           @modelProfileId, @requestPayloadArtifactId, @idempotencyKey, @requestHash,
           @status, @evidencePlanId, @evidencePlanVersion, @outcomeId,
           @baselineEvidencePackageIdsJson, @createdAt, @updatedAt)`
      )
      .run(row);
  }

  getById(requestId: string): AnalysisRequestRow | undefined {
    const r = this.db
      .prepare(`SELECT * FROM analysis_requests WHERE request_id = ?`)
      .get(requestId) as Record<string, unknown> | undefined;
    return r ? mapRequest(r) : undefined;
  }

  findByIdempotency(client: string, idempotencyKey: string): AnalysisRequestRow | undefined {
    const r = this.db
      .prepare(
        `SELECT * FROM analysis_requests WHERE client = ? AND idempotency_key = ?`
      )
      .get(client, idempotencyKey) as Record<string, unknown> | undefined;
    return r ? mapRequest(r) : undefined;
  }

  updateStatus(requestId: string, status: string, updatedAt: string): void {
    this.db
      .prepare(`UPDATE analysis_requests SET status = ?, updated_at = ? WHERE request_id = ?`)
      .run(status, updatedAt, requestId);
  }
}

export interface AnalysisRunRow {
  runId: string;
  requestId: string;
  attemptNumber: number;
  status: string;
  currentPhase: string | null;
  executionId: string | null;
  correlationId: string | null;
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
  capabilityVersion: string | null;
  startedAt: string | null;
  heartbeatAt: string | null;
  completedAt: string | null;
  timeoutAt: string | null;
  cancelRequestedAt: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  tokenInput: number;
  tokenOutput: number;
  costUsd: number;
  outputArtifactId: string | null;
  qualityScore: number | null;
  priorRunId: string | null;
  revisionOfRequestId: string | null;
  affectedAreasJson: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapRun(r: Record<string, unknown>): AnalysisRunRow {
  return {
    runId: r.run_id as string,
    requestId: r.request_id as string,
    attemptNumber: r.attempt_number as number,
    status: r.status as string,
    currentPhase: (r.current_phase as string | null) ?? null,
    executionId: (r.execution_id as string | null) ?? null,
    correlationId: (r.correlation_id as string | null) ?? null,
    provider: (r.provider as string | null) ?? null,
    model: (r.model as string | null) ?? null,
    promptVersion: (r.prompt_version as string | null) ?? null,
    capabilityVersion: (r.capability_version as string | null) ?? null,
    startedAt: (r.started_at as string | null) ?? null,
    heartbeatAt: (r.heartbeat_at as string | null) ?? null,
    completedAt: (r.completed_at as string | null) ?? null,
    timeoutAt: (r.timeout_at as string | null) ?? null,
    cancelRequestedAt: (r.cancel_requested_at as string | null) ?? null,
    failureCode: (r.failure_code as string | null) ?? null,
    failureMessage: (r.failure_message as string | null) ?? null,
    tokenInput: r.token_input as number,
    tokenOutput: r.token_output as number,
    costUsd: r.cost_usd as number,
    outputArtifactId: (r.output_artifact_id as string | null) ?? null,
    qualityScore: (r.quality_score as number | null) ?? null,
    priorRunId: (r.prior_run_id as string | null) ?? null,
    revisionOfRequestId: (r.revision_of_request_id as string | null) ?? null,
    affectedAreasJson: (r.affected_areas_json as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string
  };
}

export class AnalysisRunsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(row: AnalysisRunRow): void {
    this.db
      .prepare(
        `INSERT INTO analysis_runs
          (run_id, request_id, attempt_number, status, current_phase, execution_id,
           correlation_id, provider, model, prompt_version, capability_version,
           started_at, heartbeat_at, completed_at, timeout_at, cancel_requested_at,
           failure_code, failure_message, token_input, token_output, cost_usd,
           output_artifact_id, quality_score, prior_run_id, revision_of_request_id,
           affected_areas_json, created_at, updated_at)
         VALUES
          (@runId, @requestId, @attemptNumber, @status, @currentPhase, @executionId,
           @correlationId, @provider, @model, @promptVersion, @capabilityVersion,
           @startedAt, @heartbeatAt, @completedAt, @timeoutAt, @cancelRequestedAt,
           @failureCode, @failureMessage, @tokenInput, @tokenOutput, @costUsd,
           @outputArtifactId, @qualityScore, @priorRunId, @revisionOfRequestId,
           @affectedAreasJson, @createdAt, @updatedAt)`
      )
      .run({
        ...row,
        priorRunId: row.priorRunId ?? null,
        revisionOfRequestId: row.revisionOfRequestId ?? null,
        affectedAreasJson: row.affectedAreasJson ?? null
      });
  }

  getById(runId: string): AnalysisRunRow | undefined {
    const r = this.db
      .prepare(`SELECT * FROM analysis_runs WHERE run_id = ?`)
      .get(runId) as Record<string, unknown> | undefined;
    return r ? mapRun(r) : undefined;
  }

  getLatestByRequestId(requestId: string): AnalysisRunRow | undefined {
    const r = this.db
      .prepare(
        `SELECT * FROM analysis_runs WHERE request_id = ? ORDER BY attempt_number DESC LIMIT 1`
      )
      .get(requestId) as Record<string, unknown> | undefined;
    return r ? mapRun(r) : undefined;
  }

  listByProject(projectId: string, limit = 50): AnalysisRunRow[] {
    const rows = this.db
      .prepare(
        `SELECT r.* FROM analysis_runs r
         INNER JOIN analysis_requests q ON q.request_id = r.request_id
         WHERE q.project_id = ?
         ORDER BY r.created_at DESC LIMIT ?`
      )
      .all(projectId, limit) as Record<string, unknown>[];
    return rows.map(mapRun);
  }

  listActive(limit = 100): AnalysisRunRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM analysis_runs
         WHERE status NOT IN ('completed','partial','evidence_insufficient','cancelled','failed')
         ORDER BY created_at ASC LIMIT ?`
      )
      .all(limit) as Record<string, unknown>[];
    return rows.map(mapRun);
  }

  listRecent(limit = 50): AnalysisRunRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM analysis_runs ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as Record<string, unknown>[];
    return rows.map(mapRun);
  }

  update(row: Partial<AnalysisRunRow> & { runId: string; updatedAt: string }): void {
    const current = this.getById(row.runId);
    if (!current) return;
    const next: AnalysisRunRow = { ...current, ...row };
    this.db
      .prepare(
        `UPDATE analysis_runs SET
           status = @status,
           current_phase = @currentPhase,
           execution_id = @executionId,
           started_at = @startedAt,
           heartbeat_at = @heartbeatAt,
           completed_at = @completedAt,
           timeout_at = @timeoutAt,
           cancel_requested_at = @cancelRequestedAt,
           failure_code = @failureCode,
           failure_message = @failureMessage,
           provider = @provider,
           model = @model,
           token_input = @tokenInput,
           token_output = @tokenOutput,
           cost_usd = @costUsd,
           output_artifact_id = @outputArtifactId,
           quality_score = @qualityScore,
           updated_at = @updatedAt
         WHERE run_id = @runId`
      )
      .run(next);
  }
}

export interface RunEventRow {
  eventId: string;
  runId: string | null;
  requestId: string | null;
  correlationId: string | null;
  eventType: string;
  phase: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  detailJson: string | null;
  createdAt: string;
}

function mapEvent(r: Record<string, unknown>): RunEventRow {
  return {
    eventId: r.event_id as string,
    runId: (r.run_id as string | null) ?? null,
    requestId: (r.request_id as string | null) ?? null,
    correlationId: (r.correlation_id as string | null) ?? null,
    eventType: r.event_type as string,
    phase: (r.phase as string | null) ?? null,
    fromStatus: (r.from_status as string | null) ?? null,
    toStatus: (r.to_status as string | null) ?? null,
    detailJson: (r.detail_json as string | null) ?? null,
    createdAt: r.created_at as string
  };
}

export class RunEventsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(row: RunEventRow): void {
    this.db
      .prepare(
        `INSERT INTO run_events
          (event_id, run_id, request_id, correlation_id, event_type, phase,
           from_status, to_status, detail_json, created_at)
         VALUES
          (@eventId, @runId, @requestId, @correlationId, @eventType, @phase,
           @fromStatus, @toStatus, @detailJson, @createdAt)`
      )
      .run(row);
  }

  listByRun(runId: string): RunEventRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM run_events WHERE run_id = ? ORDER BY created_at ASC, rowid ASC`)
      .all(runId) as Record<string, unknown>[];
    return rows.map(mapEvent);
  }
}

export interface ExecutionLockRow {
  lockKey: string;
  runId: string | null;
  executionId: string | null;
  ownerInstance: string | null;
  acquiredAt: string | null;
  leaseExpiresAt: string | null;
  heartbeatAt: string | null;
  releasedAt: string | null;
  status: string;
}

function mapLock(r: Record<string, unknown>): ExecutionLockRow {
  return {
    lockKey: r.lock_key as string,
    runId: (r.run_id as string | null) ?? null,
    executionId: (r.execution_id as string | null) ?? null,
    ownerInstance: (r.owner_instance as string | null) ?? null,
    acquiredAt: (r.acquired_at as string | null) ?? null,
    leaseExpiresAt: (r.lease_expires_at as string | null) ?? null,
    heartbeatAt: (r.heartbeat_at as string | null) ?? null,
    releasedAt: (r.released_at as string | null) ?? null,
    status: r.status as string
  };
}

export class ExecutionLocksRepository {
  constructor(private readonly db: SqliteDatabase) {}

  get(lockKey: string): ExecutionLockRow | undefined {
    const r = this.db
      .prepare(`SELECT * FROM execution_locks WHERE lock_key = ?`)
      .get(lockKey) as Record<string, unknown> | undefined;
    return r ? mapLock(r) : undefined;
  }

  /**
   * Conditionally claim a lock. Succeeds when the lock is free, missing, or the
   * existing lease has expired. Uses an immediate transaction so concurrent
   * claimants cannot both win.
   */
  tryClaim(input: {
    lockKey: string;
    runId: string;
    executionId: string;
    ownerInstance: string;
    leaseMs: number;
  }): boolean {
    const now = new Date();
    const nowIso = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + input.leaseMs).toISOString();

    const claim = this.db.transaction(() => {
      const existing = this.get(input.lockKey);
      if (
        existing &&
        existing.status === "held" &&
        existing.leaseExpiresAt &&
        existing.leaseExpiresAt > nowIso
      ) {
        return false;
      }

      this.db
        .prepare(
          `INSERT INTO execution_locks
             (lock_key, run_id, execution_id, owner_instance, acquired_at,
              lease_expires_at, heartbeat_at, released_at, status)
           VALUES
             (@lockKey, @runId, @executionId, @ownerInstance, @acquiredAt,
              @leaseExpiresAt, @heartbeatAt, NULL, 'held')
           ON CONFLICT(lock_key) DO UPDATE SET
             run_id = excluded.run_id,
             execution_id = excluded.execution_id,
             owner_instance = excluded.owner_instance,
             acquired_at = excluded.acquired_at,
             lease_expires_at = excluded.lease_expires_at,
             heartbeat_at = excluded.heartbeat_at,
             released_at = NULL,
             status = 'held'`
        )
        .run({
          lockKey: input.lockKey,
          runId: input.runId,
          executionId: input.executionId,
          ownerInstance: input.ownerInstance,
          acquiredAt: nowIso,
          leaseExpiresAt,
          heartbeatAt: nowIso
        });
      return true;
    });

    return claim();
  }

  heartbeat(lockKey: string, ownerInstance: string, leaseMs: number): boolean {
    const now = new Date();
    const nowIso = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
    const result = this.db
      .prepare(
        `UPDATE execution_locks
         SET heartbeat_at = ?, lease_expires_at = ?
         WHERE lock_key = ? AND owner_instance = ? AND status = 'held'`
      )
      .run(nowIso, leaseExpiresAt, lockKey, ownerInstance);
    return result.changes > 0;
  }

  release(lockKey: string, ownerInstance: string): void {
    const nowIso = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE execution_locks
         SET status = 'free', released_at = ?, owner_instance = NULL, execution_id = NULL
         WHERE lock_key = ? AND owner_instance = ?`
      )
      .run(nowIso, lockKey, ownerInstance);
  }
}

export interface IdempotencyRecordRow {
  idempotencyKey: string;
  client: string;
  requestId: string | null;
  runId: string | null;
  requestHash: string | null;
  createdAt: string;
}

export class IdempotencyRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(row: IdempotencyRecordRow): void {
    this.db
      .prepare(
        `INSERT INTO idempotency_records
          (idempotency_key, client, request_id, run_id, request_hash, created_at)
         VALUES
          (@idempotencyKey, @client, @requestId, @runId, @requestHash, @createdAt)`
      )
      .run(row);
  }

  get(client: string, idempotencyKey: string): IdempotencyRecordRow | undefined {
    const r = this.db
      .prepare(
        `SELECT * FROM idempotency_records WHERE client = ? AND idempotency_key = ?`
      )
      .get(client, idempotencyKey) as Record<string, unknown> | undefined;
    if (!r) return undefined;
    return {
      idempotencyKey: r.idempotency_key as string,
      client: r.client as string,
      requestId: (r.request_id as string | null) ?? null,
      runId: (r.run_id as string | null) ?? null,
      requestHash: (r.request_hash as string | null) ?? null,
      createdAt: r.created_at as string
    };
  }
}
