import type { SqliteDatabase } from "./connection";

export interface ArtifactRow {
  artifactId: string;
  relativePath: string;
  contentHash: string;
  mimeType: string;
  sizeBytes: number;
  redactionStatus: string;
  accessClass: string;
  relatedRequestId?: string | null;
  relatedRunId?: string | null;
  relatedModelCallId?: string | null;
  createdAt: string;
}

export class ArtifactsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(row: ArtifactRow): void {
    this.db
      .prepare(
        `INSERT INTO artifacts
          (artifact_id, relative_path, content_hash, mime_type, size_bytes,
           redaction_status, access_class, related_request_id, related_run_id,
           related_model_call_id, created_at)
         VALUES
          (@artifactId, @relativePath, @contentHash, @mimeType, @sizeBytes,
           @redactionStatus, @accessClass, @relatedRequestId, @relatedRunId,
           @relatedModelCallId, @createdAt)`
      )
      .run({
        ...row,
        relatedRequestId: row.relatedRequestId ?? null,
        relatedRunId: row.relatedRunId ?? null,
        relatedModelCallId: row.relatedModelCallId ?? null
      });
  }

  getById(artifactId: string): ArtifactRow | undefined {
    const r = this.db
      .prepare(`SELECT * FROM artifacts WHERE artifact_id = ?`)
      .get(artifactId) as Record<string, unknown> | undefined;
    if (!r) return undefined;
    return {
      artifactId: r.artifact_id as string,
      relativePath: r.relative_path as string,
      contentHash: r.content_hash as string,
      mimeType: r.mime_type as string,
      sizeBytes: r.size_bytes as number,
      redactionStatus: r.redaction_status as string,
      accessClass: r.access_class as string,
      relatedRequestId: (r.related_request_id as string | null) ?? null,
      relatedRunId: (r.related_run_id as string | null) ?? null,
      relatedModelCallId: (r.related_model_call_id as string | null) ?? null,
      createdAt: r.created_at as string
    };
  }
}

export interface AuditEventRow {
  eventId: string;
  previousHash: string | null;
  eventHash: string;
  actorType: string;
  actorId: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  beforeStateJson: string | null;
  afterStateJson: string | null;
  artifactRefsJson: string | null;
  correlationId: string | null;
  requestId: string | null;
  runId: string | null;
  createdAt: string;
}

export class AuditRepository {
  constructor(private readonly db: SqliteDatabase) {}

  latestHash(): string | null {
    const row = this.db
      .prepare(`SELECT event_hash FROM audit_events ORDER BY rowid DESC LIMIT 1`)
      .get() as { event_hash: string } | undefined;
    return row?.event_hash ?? null;
  }

  insert(row: AuditEventRow): void {
    this.db
      .prepare(
        `INSERT INTO audit_events
          (event_id, previous_hash, event_hash, actor_type, actor_id, action,
           target_type, target_id, before_state_json, after_state_json,
           artifact_refs_json, correlation_id, request_id, run_id, created_at)
         VALUES
          (@eventId, @previousHash, @eventHash, @actorType, @actorId, @action,
           @targetType, @targetId, @beforeStateJson, @afterStateJson,
           @artifactRefsJson, @correlationId, @requestId, @runId, @createdAt)`
      )
      .run(row);
  }

  list(limit = 100): AuditEventRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM audit_events ORDER BY rowid DESC LIMIT ?`)
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      eventId: r.event_id as string,
      previousHash: (r.previous_hash as string | null) ?? null,
      eventHash: r.event_hash as string,
      actorType: r.actor_type as string,
      actorId: r.actor_id as string,
      action: r.action as string,
      targetType: (r.target_type as string | null) ?? null,
      targetId: (r.target_id as string | null) ?? null,
      beforeStateJson: (r.before_state_json as string | null) ?? null,
      afterStateJson: (r.after_state_json as string | null) ?? null,
      artifactRefsJson: (r.artifact_refs_json as string | null) ?? null,
      correlationId: (r.correlation_id as string | null) ?? null,
      requestId: (r.request_id as string | null) ?? null,
      runId: (r.run_id as string | null) ?? null,
      createdAt: r.created_at as string
    }));
  }
}

export interface ModelProfileRow {
  profileId: string;
  provider: string;
  model: string;
  enabled: boolean;
  temperature: number;
  tokenCap: number | null;
  costCapUsd: number | null;
  timeoutSeconds: number;
  fallbackProfileId: string | null;
  description: string | null;
}

export class ModelProfilesRepository {
  constructor(private readonly db: SqliteDatabase) {}

  upsert(row: ModelProfileRow): void {
    this.db
      .prepare(
        `INSERT INTO settings_model_profiles
          (profile_id, provider, model, enabled, temperature, token_cap,
           cost_cap_usd, timeout_seconds, fallback_profile_id, description,
           created_at, updated_at)
         VALUES
          (@profileId, @provider, @model, @enabled, @temperature, @tokenCap,
           @costCapUsd, @timeoutSeconds, @fallbackProfileId, @description,
           @now, @now)
         ON CONFLICT(profile_id) DO UPDATE SET
           provider = excluded.provider,
           model = excluded.model,
           enabled = excluded.enabled,
           temperature = excluded.temperature,
           token_cap = excluded.token_cap,
           cost_cap_usd = excluded.cost_cap_usd,
           timeout_seconds = excluded.timeout_seconds,
           fallback_profile_id = excluded.fallback_profile_id,
           description = excluded.description,
           updated_at = excluded.updated_at`
      )
      .run({
        ...row,
        enabled: row.enabled ? 1 : 0,
        now: new Date().toISOString()
      });
  }

  list(): ModelProfileRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM settings_model_profiles ORDER BY profile_id`)
      .all() as Record<string, unknown>[];
    return rows.map((r) => ({
      profileId: r.profile_id as string,
      provider: r.provider as string,
      model: r.model as string,
      enabled: (r.enabled as number) === 1,
      temperature: r.temperature as number,
      tokenCap: (r.token_cap as number | null) ?? null,
      costCapUsd: (r.cost_cap_usd as number | null) ?? null,
      timeoutSeconds: r.timeout_seconds as number,
      fallbackProfileId: (r.fallback_profile_id as string | null) ?? null,
      description: (r.description as string | null) ?? null
    }));
  }

  getById(profileId: string): ModelProfileRow | undefined {
    return this.list().find((p) => p.profileId === profileId);
  }
}
