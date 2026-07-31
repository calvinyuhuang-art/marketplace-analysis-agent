import type { SqliteDatabase } from "./connection";

export interface EvidencePlanRow {
  planId: string;
  planVersion: number;
  projectId: string;
  client: string;
  status: string;
  requestedAnalysisJson: string;
  requiredFieldsJson: string;
  budgetJson: string | null;
  capabilityJson: string;
  collectorCapabilitySnapshotArtifactId: string;
  collectorCapabilitySnapshotHash: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export class EvidencePlansRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(row: EvidencePlanRow): void {
    this.db
      .prepare(
        `INSERT INTO evidence_plans
          (plan_id, plan_version, project_id, client, status,
           requested_analysis_json, required_fields_json, budget_json, capability_json,
           collector_capability_snapshot_artifact_id, collector_capability_snapshot_hash,
           notes, created_at, updated_at)
         VALUES
          (@planId, @planVersion, @projectId, @client, @status,
           @requestedAnalysisJson, @requiredFieldsJson, @budgetJson, @capabilityJson,
           @collectorCapabilitySnapshotArtifactId, @collectorCapabilitySnapshotHash,
           @notes, @createdAt, @updatedAt)`
      )
      .run(row);
  }

  get(planId: string, planVersion?: number): EvidencePlanRow | undefined {
    if (planVersion !== undefined) {
      const row = this.db
        .prepare(
          `SELECT * FROM evidence_plans WHERE plan_id = ? AND plan_version = ?`
        )
        .get(planId, planVersion) as Record<string, unknown> | undefined;
      return row ? mapPlan(row) : undefined;
    }
    const row = this.db
      .prepare(
        `SELECT * FROM evidence_plans WHERE plan_id = ? ORDER BY plan_version DESC LIMIT 1`
      )
      .get(planId) as Record<string, unknown> | undefined;
    return row ? mapPlan(row) : undefined;
  }

  updateStatus(
    planId: string,
    planVersion: number,
    status: string,
    updatedAt: string
  ): void {
    this.db
      .prepare(
        `UPDATE evidence_plans SET status = ?, updated_at = ?
         WHERE plan_id = ? AND plan_version = ?`
      )
      .run(status, updatedAt, planId, planVersion);
  }
}

function mapPlan(r: Record<string, unknown>): EvidencePlanRow {
  return {
    planId: r.plan_id as string,
    planVersion: r.plan_version as number,
    projectId: r.project_id as string,
    client: r.client as string,
    status: r.status as string,
    requestedAnalysisJson: r.requested_analysis_json as string,
    requiredFieldsJson: r.required_fields_json as string,
    budgetJson: (r.budget_json as string | null) ?? null,
    capabilityJson: r.capability_json as string,
    collectorCapabilitySnapshotArtifactId:
      r.collector_capability_snapshot_artifact_id as string,
    collectorCapabilitySnapshotHash: r.collector_capability_snapshot_hash as string,
    notes: (r.notes as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string
  };
}

export interface EvidencePlanReviewRow {
  reviewId: string;
  planId: string;
  planVersion: number;
  runId: string | null;
  decision: string;
  collectorCapabilitySnapshotArtifactId: string;
  collectorCapabilitySnapshotHash: string;
  reportJson: string;
  reportArtifactId: string | null;
  createdAt: string;
}

export class EvidencePlanReviewsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(row: EvidencePlanReviewRow): void {
    this.db
      .prepare(
        `INSERT INTO evidence_plan_reviews
          (review_id, plan_id, plan_version, run_id, decision,
           collector_capability_snapshot_artifact_id, collector_capability_snapshot_hash,
           report_json, report_artifact_id, created_at)
         VALUES
          (@reviewId, @planId, @planVersion, @runId, @decision,
           @collectorCapabilitySnapshotArtifactId, @collectorCapabilitySnapshotHash,
           @reportJson, @reportArtifactId, @createdAt)`
      )
      .run(row);
  }

  getByRunId(runId: string): EvidencePlanReviewRow | undefined {
    const row = this.db
      .prepare(`SELECT * FROM evidence_plan_reviews WHERE run_id = ?`)
      .get(runId) as Record<string, unknown> | undefined;
    return row ? mapReview(row) : undefined;
  }

  listByPlan(planId: string, planVersion?: number): EvidencePlanReviewRow[] {
    const rows =
      planVersion === undefined
        ? (this.db
            .prepare(
              `SELECT * FROM evidence_plan_reviews WHERE plan_id = ? ORDER BY created_at`
            )
            .all(planId) as Record<string, unknown>[])
        : (this.db
            .prepare(
              `SELECT * FROM evidence_plan_reviews
               WHERE plan_id = ? AND plan_version = ? ORDER BY created_at`
            )
            .all(planId, planVersion) as Record<string, unknown>[]);
    return rows.map(mapReview);
  }
}

function mapReview(r: Record<string, unknown>): EvidencePlanReviewRow {
  return {
    reviewId: r.review_id as string,
    planId: r.plan_id as string,
    planVersion: r.plan_version as number,
    runId: (r.run_id as string | null) ?? null,
    decision: r.decision as string,
    collectorCapabilitySnapshotArtifactId:
      r.collector_capability_snapshot_artifact_id as string,
    collectorCapabilitySnapshotHash: r.collector_capability_snapshot_hash as string,
    reportJson: r.report_json as string,
    reportArtifactId: (r.report_artifact_id as string | null) ?? null,
    createdAt: r.created_at as string
  };
}
