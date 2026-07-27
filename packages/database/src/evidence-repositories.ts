import type { SqliteDatabase } from "./connection";

export interface EvidencePackageRow {
  packageId: string;
  projectId: string | null;
  externalWorkOrderId: string | null;
  sourceClient: string;
  schemaVersion: string;
  platform: string;
  marketplace: string;
  category: string | null;
  productType: string | null;
  status: string;
  itemCount: number;
  coverageSummaryJson: string;
  diagnosticsJson: string | null;
  packageArtifactId: string | null;
  contentHash: string;
  observedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapPackage(r: Record<string, unknown>): EvidencePackageRow {
  return {
    packageId: r.package_id as string,
    projectId: (r.project_id as string | null) ?? null,
    externalWorkOrderId: (r.external_work_order_id as string | null) ?? null,
    sourceClient: r.source_client as string,
    schemaVersion: r.schema_version as string,
    platform: r.platform as string,
    marketplace: r.marketplace as string,
    category: (r.category as string | null) ?? null,
    productType: (r.product_type as string | null) ?? null,
    status: r.status as string,
    itemCount: r.item_count as number,
    coverageSummaryJson: r.coverage_summary_json as string,
    diagnosticsJson: (r.diagnostics_json as string | null) ?? null,
    packageArtifactId: (r.package_artifact_id as string | null) ?? null,
    contentHash: r.content_hash as string,
    observedAt: (r.observed_at as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string
  };
}

export interface EvidenceItemRow {
  evidenceId: string;
  evidencePackageId: string;
  sourceType: string;
  platform: string;
  marketplace: string;
  category: string | null;
  productType: string | null;
  subjectId: string;
  sourceUrl: string | null;
  observedAt: string;
  collector: string;
  collectorVersion: string;
  confidence: number;
  title: string | null;
  textContent: string | null;
  fieldsJson: string;
  provenanceJson: string;
  rawSnapshotArtifactId: string | null;
  contentHash: string;
  validationStatus: string;
  createdAt: string;
}

function mapItem(r: Record<string, unknown>): EvidenceItemRow {
  return {
    evidenceId: r.evidence_id as string,
    evidencePackageId: r.evidence_package_id as string,
    sourceType: r.source_type as string,
    platform: r.platform as string,
    marketplace: r.marketplace as string,
    category: (r.category as string | null) ?? null,
    productType: (r.product_type as string | null) ?? null,
    subjectId: r.subject_id as string,
    sourceUrl: (r.source_url as string | null) ?? null,
    observedAt: r.observed_at as string,
    collector: r.collector as string,
    collectorVersion: r.collector_version as string,
    confidence: r.confidence as number,
    title: (r.title as string | null) ?? null,
    textContent: (r.text_content as string | null) ?? null,
    fieldsJson: r.fields_json as string,
    provenanceJson: r.provenance_json as string,
    rawSnapshotArtifactId: (r.raw_snapshot_artifact_id as string | null) ?? null,
    contentHash: r.content_hash as string,
    validationStatus: r.validation_status as string,
    createdAt: r.created_at as string
  };
}

export class EvidencePackagesRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(row: EvidencePackageRow): void {
    this.db
      .prepare(
        `INSERT INTO evidence_packages
          (package_id, project_id, external_work_order_id, source_client, schema_version,
           platform, marketplace, category, product_type, status, item_count,
           coverage_summary_json, diagnostics_json, package_artifact_id, content_hash,
           observed_at, created_at, updated_at)
         VALUES
          (@packageId, @projectId, @externalWorkOrderId, @sourceClient, @schemaVersion,
           @platform, @marketplace, @category, @productType, @status, @itemCount,
           @coverageSummaryJson, @diagnosticsJson, @packageArtifactId, @contentHash,
           @observedAt, @createdAt, @updatedAt)`
      )
      .run(row);
  }

  getById(packageId: string): EvidencePackageRow | undefined {
    const r = this.db
      .prepare(`SELECT * FROM evidence_packages WHERE package_id = ?`)
      .get(packageId) as Record<string, unknown> | undefined;
    return r ? mapPackage(r) : undefined;
  }

  list(limit = 100): EvidencePackageRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM evidence_packages ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as Record<string, unknown>[];
    return rows.map(mapPackage);
  }

  linkToRequest(requestId: string, packageId: string, createdAt: string): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO evidence_package_links (request_id, package_id, created_at)
         VALUES (?, ?, ?)`
      )
      .run(requestId, packageId, createdAt);
  }

  listForRequest(requestId: string): EvidencePackageRow[] {
    const rows = this.db
      .prepare(
        `SELECT p.* FROM evidence_packages p
         INNER JOIN evidence_package_links l ON l.package_id = p.package_id
         WHERE l.request_id = ?`
      )
      .all(requestId) as Record<string, unknown>[];
    return rows.map(mapPackage);
  }
}

export class EvidenceItemsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(row: EvidenceItemRow): void {
    const insert = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO evidence_items
            (evidence_id, evidence_package_id, source_type, platform, marketplace,
             category, product_type, subject_id, source_url, observed_at, collector,
             collector_version, confidence, title, text_content, fields_json,
             provenance_json, raw_snapshot_artifact_id, content_hash, validation_status,
             created_at)
           VALUES
            (@evidenceId, @evidencePackageId, @sourceType, @platform, @marketplace,
             @category, @productType, @subjectId, @sourceUrl, @observedAt, @collector,
             @collectorVersion, @confidence, @title, @textContent, @fieldsJson,
             @provenanceJson, @rawSnapshotArtifactId, @contentHash, @validationStatus,
             @createdAt)`
        )
        .run(row);

      // Keep FTS in sync via explicit repository write (content= table).
      const rowid = (
        this.db
          .prepare(`SELECT rowid FROM evidence_items WHERE evidence_id = ?`)
          .get(row.evidenceId) as { rowid: number }
      ).rowid;
      this.db
        .prepare(
          `INSERT INTO evidence_fts(rowid, title, text_content, subject_id, source_type)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          rowid,
          row.title ?? "",
          row.textContent ?? "",
          row.subjectId,
          row.sourceType
        );
    });
    insert();
  }

  listByPackage(packageId: string): EvidenceItemRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM evidence_items WHERE evidence_package_id = ? ORDER BY created_at`)
      .all(packageId) as Record<string, unknown>[];
    return rows.map(mapItem);
  }

  listByPackages(packageIds: string[]): EvidenceItemRow[] {
    if (packageIds.length === 0) return [];
    const placeholders = packageIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT * FROM evidence_items WHERE evidence_package_id IN (${placeholders}) ORDER BY created_at`
      )
      .all(...packageIds) as Record<string, unknown>[];
    return rows.map(mapItem);
  }
}

export interface CollectionRequestRow {
  collectionRequestId: string;
  runId: string | null;
  requestId: string | null;
  requestType: string;
  status: string;
  priority: string;
  platform: string;
  marketplace: string;
  targetSetJson: string;
  requiredEvidenceJson: string;
  reason: string;
  analysisAreasBlockedJson: string;
  completionRuleJson: string;
  suggestedCollectorCapability: string | null;
  payloadJson: string;
  createdAt: string;
  updatedAt: string;
}

export class CollectionRequestsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(row: CollectionRequestRow): void {
    this.db
      .prepare(
        `INSERT INTO collection_requests
          (collection_request_id, run_id, request_id, request_type, status, priority,
           platform, marketplace, target_set_json, required_evidence_json, reason,
           analysis_areas_blocked_json, completion_rule_json, suggested_collector_capability,
           payload_json, created_at, updated_at)
         VALUES
          (@collectionRequestId, @runId, @requestId, @requestType, @status, @priority,
           @platform, @marketplace, @targetSetJson, @requiredEvidenceJson, @reason,
           @analysisAreasBlockedJson, @completionRuleJson, @suggestedCollectorCapability,
           @payloadJson, @createdAt, @updatedAt)`
      )
      .run(row);
  }

  listByRun(runId: string): CollectionRequestRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM collection_requests WHERE run_id = ? ORDER BY created_at`)
      .all(runId) as Record<string, unknown>[];
    return rows.map((r) => ({
      collectionRequestId: r.collection_request_id as string,
      runId: (r.run_id as string | null) ?? null,
      requestId: (r.request_id as string | null) ?? null,
      requestType: r.request_type as string,
      status: r.status as string,
      priority: r.priority as string,
      platform: r.platform as string,
      marketplace: r.marketplace as string,
      targetSetJson: r.target_set_json as string,
      requiredEvidenceJson: r.required_evidence_json as string,
      reason: r.reason as string,
      analysisAreasBlockedJson: r.analysis_areas_blocked_json as string,
      completionRuleJson: r.completion_rule_json as string,
      suggestedCollectorCapability: (r.suggested_collector_capability as string | null) ?? null,
      payloadJson: r.payload_json as string,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string
    }));
  }
}

export class RunReadinessRepository {
  constructor(private readonly db: SqliteDatabase) {}

  upsert(input: {
    runId: string;
    reportJson: string;
    overallStatus: string;
    artifactId: string | null;
    evaluatedAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO run_readiness (run_id, report_json, overall_status, artifact_id, evaluated_at)
         VALUES (@runId, @reportJson, @overallStatus, @artifactId, @evaluatedAt)
         ON CONFLICT(run_id) DO UPDATE SET
           report_json = excluded.report_json,
           overall_status = excluded.overall_status,
           artifact_id = excluded.artifact_id,
           evaluated_at = excluded.evaluated_at`
      )
      .run(input);
  }

  get(runId: string):
    | {
        runId: string;
        reportJson: string;
        overallStatus: string;
        artifactId: string | null;
        evaluatedAt: string;
      }
    | undefined {
    const r = this.db
      .prepare(`SELECT * FROM run_readiness WHERE run_id = ?`)
      .get(runId) as Record<string, unknown> | undefined;
    if (!r) return undefined;
    return {
      runId: r.run_id as string,
      reportJson: r.report_json as string,
      overallStatus: r.overall_status as string,
      artifactId: (r.artifact_id as string | null) ?? null,
      evaluatedAt: r.evaluated_at as string
    };
  }
}
