import type { SqliteDatabase } from "./connection";

export interface ProceduralRuleDefinitionRow {
  ruleId: string;
  ruleType: string;
  title: string;
  createdAt: string;
}

export interface ProceduralRuleVersionRow {
  versionId: string;
  ruleId: string;
  versionNumber: number;
  paramsJson: string;
  policyHash: string;
  lifecycleStatus: string;
  replayReportArtifactId: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface ProceduralRuleActivationRow {
  activationId: string;
  versionId: string;
  action: string;
  actorId: string;
  reason: string | null;
  replacesActivationId: string | null;
  createdAt: string;
}

function mapDefinition(r: Record<string, unknown>): ProceduralRuleDefinitionRow {
  return {
    ruleId: String(r.rule_id),
    ruleType: String(r.rule_type),
    title: String(r.title),
    createdAt: String(r.created_at)
  };
}

function mapVersion(r: Record<string, unknown>): ProceduralRuleVersionRow {
  return {
    versionId: String(r.version_id),
    ruleId: String(r.rule_id),
    versionNumber: Number(r.version_number),
    paramsJson: String(r.params_json),
    policyHash: String(r.policy_hash),
    lifecycleStatus: String(r.lifecycle_status),
    replayReportArtifactId:
      r.replay_report_artifact_id == null ? null : String(r.replay_report_artifact_id),
    approvedBy: r.approved_by == null ? null : String(r.approved_by),
    approvedAt: r.approved_at == null ? null : String(r.approved_at),
    createdBy: String(r.created_by),
    createdAt: String(r.created_at)
  };
}

function mapActivation(r: Record<string, unknown>): ProceduralRuleActivationRow {
  return {
    activationId: String(r.activation_id),
    versionId: String(r.version_id),
    action: String(r.action),
    actorId: String(r.actor_id),
    reason: r.reason == null ? null : String(r.reason),
    replacesActivationId:
      r.replaces_activation_id == null ? null : String(r.replaces_activation_id),
    createdAt: String(r.created_at)
  };
}

export class ProceduralRuleDefinitionsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(row: ProceduralRuleDefinitionRow): void {
    this.db
      .prepare(
        `INSERT INTO procedural_rule_definitions (rule_id, rule_type, title, created_at)
         VALUES (@ruleId, @ruleType, @title, @createdAt)`
      )
      .run(row);
  }

  list(): ProceduralRuleDefinitionRow[] {
    return this.db
      .prepare(`SELECT * FROM procedural_rule_definitions ORDER BY created_at ASC`)
      .all()
      .map((r) => mapDefinition(r as Record<string, unknown>));
  }

  getByType(ruleType: string): ProceduralRuleDefinitionRow | undefined {
    const row = this.db
      .prepare(`SELECT * FROM procedural_rule_definitions WHERE rule_type = ?`)
      .get(ruleType) as Record<string, unknown> | undefined;
    return row ? mapDefinition(row) : undefined;
  }

  getById(ruleId: string): ProceduralRuleDefinitionRow | undefined {
    const row = this.db
      .prepare(`SELECT * FROM procedural_rule_definitions WHERE rule_id = ?`)
      .get(ruleId) as Record<string, unknown> | undefined;
    return row ? mapDefinition(row) : undefined;
  }
}

export class ProceduralRuleVersionsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(row: ProceduralRuleVersionRow): void {
    this.db
      .prepare(
        `INSERT INTO procedural_rule_versions
          (version_id, rule_id, version_number, params_json, policy_hash, lifecycle_status,
           replay_report_artifact_id, approved_by, approved_at, created_by, created_at)
         VALUES
          (@versionId, @ruleId, @versionNumber, @paramsJson, @policyHash, @lifecycleStatus,
           @replayReportArtifactId, @approvedBy, @approvedAt, @createdBy, @createdAt)`
      )
      .run(row);
  }

  getById(versionId: string): ProceduralRuleVersionRow | undefined {
    const row = this.db
      .prepare(`SELECT * FROM procedural_rule_versions WHERE version_id = ?`)
      .get(versionId) as Record<string, unknown> | undefined;
    return row ? mapVersion(row) : undefined;
  }

  listForRule(ruleId: string): ProceduralRuleVersionRow[] {
    return this.db
      .prepare(
        `SELECT * FROM procedural_rule_versions WHERE rule_id = ? ORDER BY version_number ASC`
      )
      .all(ruleId)
      .map((r) => mapVersion(r as Record<string, unknown>));
  }

  nextVersionNumber(ruleId: string): number {
    const row = this.db
      .prepare(
        `SELECT MAX(version_number) AS max_v FROM procedural_rule_versions WHERE rule_id = ?`
      )
      .get(ruleId) as { max_v: number | null } | undefined;
    return (row?.max_v ?? 0) + 1;
  }

  /** Lifecycle metadata only — never mutates params_json / policy_hash. */
  updateLifecycle(
    versionId: string,
    input: {
      lifecycleStatus: string;
      replayReportArtifactId?: string | null;
      approvedBy?: string | null;
      approvedAt?: string | null;
    }
  ): void {
    const row = this.getById(versionId);
    if (!row) return;
    this.db
      .prepare(
        `UPDATE procedural_rule_versions
         SET lifecycle_status = ?,
             replay_report_artifact_id = ?,
             approved_by = ?,
             approved_at = ?
         WHERE version_id = ?`
      )
      .run(
        input.lifecycleStatus,
        input.replayReportArtifactId ?? row.replayReportArtifactId,
        input.approvedBy ?? row.approvedBy,
        input.approvedAt ?? row.approvedAt,
        versionId
      );
  }
}

export class ProceduralRuleActivationsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(row: ProceduralRuleActivationRow): void {
    this.db
      .prepare(
        `INSERT INTO procedural_rule_activations
          (activation_id, version_id, action, actor_id, reason, replaces_activation_id, created_at)
         VALUES
          (@activationId, @versionId, @action, @actorId, @reason, @replacesActivationId, @createdAt)`
      )
      .run(row);
  }

  listForVersion(versionId: string): ProceduralRuleActivationRow[] {
    return this.db
      .prepare(
        `SELECT * FROM procedural_rule_activations WHERE version_id = ? ORDER BY created_at ASC`
      )
      .all(versionId)
      .map((r) => mapActivation(r as Record<string, unknown>));
  }

  /**
   * Latest activation for a rule (join versions), chronologically.
   * Active when action is activate or rollback; inactive on retire.
   */
  latestForRule(ruleId: string): ProceduralRuleActivationRow | undefined {
    const row = this.db
      .prepare(
        `SELECT a.*
         FROM procedural_rule_activations a
         INNER JOIN procedural_rule_versions v ON v.version_id = a.version_id
         WHERE v.rule_id = ?
         ORDER BY a.created_at DESC, a.activation_id DESC
         LIMIT 1`
      )
      .get(ruleId) as Record<string, unknown> | undefined;
    return row ? mapActivation(row) : undefined;
  }

  getById(activationId: string): ProceduralRuleActivationRow | undefined {
    const row = this.db
      .prepare(`SELECT * FROM procedural_rule_activations WHERE activation_id = ?`)
      .get(activationId) as Record<string, unknown> | undefined;
    return row ? mapActivation(row) : undefined;
  }
}
