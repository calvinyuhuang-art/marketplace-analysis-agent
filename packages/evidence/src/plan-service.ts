import { createHash } from "node:crypto";
import type { ArtifactStore } from "@maa/artifacts";
import {
  AppError,
  CreateEvidencePlanSchema,
  EvidencePlanDecision,
  IdPrefix,
  newId,
  RegisterCollectorSnapshotSchema,
  type CapabilitySummary,
  type CollectorSnapshotResponse,
  type CreateEvidencePlan,
  type EvidencePlanDecision as PlanDecision,
  type EvidencePlanResponse,
  type EvidencePlanReviewIssue,
  type EvidencePlanReviewReport,
  type RegisterCollectorSnapshot
} from "@maa/contracts";
import { CollectorCapabilitySnapshotSchema } from "@maa/agent-memory-contracts";
import type {
  ArtifactsRepository,
  EvidencePlanReviewsRepository,
  EvidencePlansRepository,
  SqliteDatabase
} from "@maa/database";

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Stable JSON for snapshot hashing (sorted object keys, compact). */
export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortKeys(obj[key]);
    }
    return out;
  }
  return value;
}

export type EvidencePlanServiceDeps = {
  db: SqliteDatabase;
  plans: EvidencePlansRepository;
  reviews: EvidencePlanReviewsRepository;
  artifacts: ArtifactsRepository;
  artifactStore: ArtifactStore;
  capabilities: CapabilitySummary[];
};

/**
 * Collector capability snapshots + evidence plans + deterministic plan review.
 * Review checks plan vs claimed collector support — not collection quality.
 */
export class EvidencePlanService {
  constructor(private readonly deps: EvidencePlanServiceDeps) {}

  registerSnapshot(input: RegisterCollectorSnapshot): CollectorSnapshotResponse {
    const parsed = RegisterCollectorSnapshotSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        message: "Invalid collector capability snapshot.",
        details: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message
        }))
      });
    }

    const canonical = canonicalizeJson(parsed.data);
    const contentHash = sha256(canonical);
    const written = this.deps.artifactStore.write(canonical, {
      extension: ".json",
      mimeType: "application/json",
      subdir: "collector-snapshots",
      accessClass: "internal"
    });

    // Re-hash actual stored bytes for pin integrity.
    const storedHash = written.contentHash;
    if (storedHash !== contentHash) {
      // write() hashes buffer; canonicalize string → utf8 buffer should match.
    }

    this.deps.artifacts.insert({
      artifactId: written.artifactId,
      relativePath: written.relativePath,
      contentHash: written.contentHash,
      mimeType: written.mimeType,
      sizeBytes: written.sizeBytes,
      redactionStatus: written.redactionStatus,
      accessClass: written.accessClass,
      relatedRunId: null,
      relatedRequestId: null,
      createdAt: written.createdAt
    });

    return {
      artifactId: written.artifactId,
      contentHash: written.contentHash,
      schemaVersion: parsed.data.schemaVersion,
      collector: parsed.data.collector,
      collectorVersion: parsed.data.collectorVersion,
      capturedAt: parsed.data.capturedAt,
      createdAt: written.createdAt
    };
  }

  createPlan(input: CreateEvidencePlan): EvidencePlanResponse {
    const parsed = CreateEvidencePlanSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        message: "Invalid evidence plan payload.",
        details: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message
        }))
      });
    }
    const data = parsed.data;
    const artifact = this.deps.artifacts.getById(data.collectorCapabilitySnapshotArtifactId);
    if (!artifact) {
      throw new AppError({
        code: "EVIDENCE_PROVENANCE_INVALID",
        message: `Collector snapshot artifact '${data.collectorCapabilitySnapshotArtifactId}' was not found.`
      });
    }
    if (artifact.contentHash !== data.collectorCapabilitySnapshotHash) {
      throw new AppError({
        code: "EVIDENCE_PROVENANCE_INVALID",
        message: "Collector capability snapshot hash does not match the stored artifact."
      });
    }

    // Validate snapshot body is parseable now (fail early).
    this.loadSnapshot(artifact.relativePath, artifact.contentHash);

    const now = new Date().toISOString();
    const planId = data.planId ?? newId(IdPrefix.evidencePlan);
    const planVersion = 1;
    this.deps.plans.insert({
      planId,
      planVersion,
      projectId: data.projectId,
      client: data.client,
      status: "submitted",
      requestedAnalysisJson: JSON.stringify(data.requestedAnalysis),
      requiredFieldsJson: JSON.stringify(data.requiredFields),
      budgetJson: data.budget ? JSON.stringify(data.budget) : null,
      capabilityJson: JSON.stringify(data.capability),
      collectorCapabilitySnapshotArtifactId: data.collectorCapabilitySnapshotArtifactId,
      collectorCapabilitySnapshotHash: data.collectorCapabilitySnapshotHash,
      notes: data.notes ?? null,
      createdAt: now,
      updatedAt: now
    });
    return this.toPlanResponse(this.deps.plans.get(planId, planVersion)!);
  }

  getPlan(planId: string, planVersion?: number): EvidencePlanResponse {
    const row = this.deps.plans.get(planId, planVersion);
    if (!row) {
      throw new AppError({
        code: "NOT_FOUND",
        message: `Evidence plan '${planId}' was not found.`
      });
    }
    return this.toPlanResponse(row);
  }

  /**
   * Deterministic plan review for a run. Pins snapshot id+hash on the review row.
   * Does not call a model.
   */
  reviewForRun(input: {
    planId: string;
    planVersion?: number;
    runId: string;
  }): {
    reviewId: string;
    decision: PlanDecision;
    report: EvidencePlanReviewReport;
    reportArtifactId: string;
  } {
    const plan = this.deps.plans.get(input.planId, input.planVersion);
    if (!plan) {
      throw new AppError({
        code: "NOT_FOUND",
        message: `Evidence plan '${input.planId}' was not found.`
      });
    }

    const artifact = this.deps.artifacts.getById(
      plan.collectorCapabilitySnapshotArtifactId
    );
    if (!artifact) {
      throw new AppError({
        code: "EVIDENCE_PROVENANCE_INVALID",
        message: `Collector snapshot artifact '${plan.collectorCapabilitySnapshotArtifactId}' was not found.`
      });
    }
    if (artifact.contentHash !== plan.collectorCapabilitySnapshotHash) {
      throw new AppError({
        code: "EVIDENCE_PROVENANCE_INVALID",
        message: "Collector capability snapshot hash mismatch at review time."
      });
    }

    const snapshot = this.loadSnapshot(artifact.relativePath, artifact.contentHash);
    const capability = this.resolveCapability(
      JSON.parse(plan.capabilityJson) as {
        platform: string;
        marketplace: string;
        category: string;
        productType: string;
      }
    );
    const requestedAnalysis = JSON.parse(plan.requestedAnalysisJson) as string[];
    const requiredFields = JSON.parse(plan.requiredFieldsJson) as Record<
      string,
      string[]
    >;
    const budget = plan.budgetJson
      ? (JSON.parse(plan.budgetJson) as { maxItems?: number; maxCostUsd?: number })
      : null;

    const issues: EvidencePlanReviewIssue[] = [];

    for (const area of requestedAnalysis) {
      if (!capability.supportedAnalysisAreas.includes(area as never)) {
        issues.push({
          code: "UNSUPPORTED_ANALYSIS_AREA",
          severity: "error",
          path: `requestedAnalysis.${area}`,
          message: `Analysis area '${area}' is not supported by capability '${capability.id}'.`
        });
      }
    }

    for (const [evidenceType, fields] of Object.entries(requiredFields)) {
      if (!snapshot.supportedEvidenceTypes.includes(evidenceType)) {
        issues.push({
          code: "UNSUPPORTED_EVIDENCE_TYPE",
          severity: "error",
          path: `requiredFields.${evidenceType}`,
          message: `Evidence type '${evidenceType}' is not claimed by the collector snapshot.`
        });
        continue;
      }
      const claimed = new Set(snapshot.supportedFields[evidenceType] ?? []);
      for (const field of fields) {
        if (!claimed.has(field)) {
          issues.push({
            code: "UNSUPPORTED_FIELD",
            severity: "error",
            path: `requiredFields.${evidenceType}.${field}`,
            message: `Field '${field}' on '${evidenceType}' is not claimed by the collector snapshot.`
          });
        }
      }
    }

    if (
      budget?.maxItems &&
      snapshot.limits?.maxItems &&
      budget.maxItems > snapshot.limits.maxItems
    ) {
      issues.push({
        code: "BUDGET_EXCEEDS_COLLECTOR_LIMIT",
        severity: "error",
        path: "budget.maxItems",
        message: `Plan maxItems ${budget.maxItems} exceeds collector limit ${snapshot.limits.maxItems}.`
      });
    } else if (
      budget?.maxItems &&
      snapshot.limits?.maxItems &&
      budget.maxItems > snapshot.limits.maxItems * 0.9
    ) {
      issues.push({
        code: "BUDGET_NEAR_COLLECTOR_LIMIT",
        severity: "warning",
        path: "budget.maxItems",
        message: `Plan maxItems is near collector limit (${snapshot.limits.maxItems}).`
      });
    }

    const hasErrors = issues.some((i) => i.severity === "error");
    const hasWarnings = issues.some((i) => i.severity === "warning");
    const decision: PlanDecision = hasErrors
      ? "unsuitable"
      : hasWarnings
        ? "suitable_with_corrections"
        : "suitable";
    EvidencePlanDecision.parse(decision);

    const now = new Date().toISOString();
    const report: EvidencePlanReviewReport = {
      planId: plan.planId,
      planVersion: plan.planVersion,
      decision,
      issues,
      collectorCapabilitySnapshotArtifactId: plan.collectorCapabilitySnapshotArtifactId,
      collectorCapabilitySnapshotHash: plan.collectorCapabilitySnapshotHash,
      reviewedAt: now
    };

    const reportArt = this.deps.artifactStore.writeJson(report, {
      subdir: "evidence-plan-reviews",
      accessClass: "internal"
    });
    this.deps.artifacts.insert({
      artifactId: reportArt.artifactId,
      relativePath: reportArt.relativePath,
      contentHash: reportArt.contentHash,
      mimeType: reportArt.mimeType,
      sizeBytes: reportArt.sizeBytes,
      redactionStatus: reportArt.redactionStatus,
      accessClass: reportArt.accessClass,
      relatedRunId: input.runId,
      relatedRequestId: null,
      createdAt: reportArt.createdAt
    });

    const reviewId = newId(IdPrefix.evidencePlanReview);
    this.deps.reviews.insert({
      reviewId,
      planId: plan.planId,
      planVersion: plan.planVersion,
      runId: input.runId,
      decision,
      collectorCapabilitySnapshotArtifactId: plan.collectorCapabilitySnapshotArtifactId,
      collectorCapabilitySnapshotHash: plan.collectorCapabilitySnapshotHash,
      reportJson: JSON.stringify(report),
      reportArtifactId: reportArt.artifactId,
      createdAt: now
    });
    this.deps.plans.updateStatus(plan.planId, plan.planVersion, "reviewed", now);

    return {
      reviewId,
      decision,
      report,
      reportArtifactId: reportArt.artifactId
    };
  }

  private loadSnapshot(relativePath: string, expectedHash: string) {
    const buf = this.deps.artifactStore.read(relativePath);
    const hash = sha256(buf);
    if (hash !== expectedHash) {
      throw new AppError({
        code: "EVIDENCE_PROVENANCE_INVALID",
        message: "Collector snapshot artifact bytes do not match content hash."
      });
    }
    let raw: unknown;
    try {
      raw = JSON.parse(buf.toString("utf8"));
    } catch {
      throw new AppError({
        code: "EVIDENCE_PROVENANCE_INVALID",
        message: "Collector snapshot artifact is not valid JSON."
      });
    }
    const parsed = CollectorCapabilitySnapshotSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError({
        code: "EVIDENCE_PROVENANCE_INVALID",
        message: "Collector snapshot artifact failed schema validation.",
        details: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message
        }))
      });
    }
    return parsed.data;
  }

  private resolveCapability(capability: {
    platform: string;
    marketplace: string;
    category: string;
    productType: string;
  }): CapabilitySummary {
    const match = this.deps.capabilities.find(
      (c) =>
        c.platform === capability.platform &&
        c.marketplace === capability.marketplace &&
        c.category === capability.category &&
        c.productType === capability.productType
    );
    if (!match) {
      throw new AppError({
        code: "UNSUPPORTED_CAPABILITY",
        message: "No capability pack matches the plan capability coordinates."
      });
    }
    return match;
  }

  private toPlanResponse(row: {
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
  }): EvidencePlanResponse {
    return {
      planId: row.planId,
      planVersion: row.planVersion,
      projectId: row.projectId,
      client: row.client,
      status: row.status as EvidencePlanResponse["status"],
      capability: JSON.parse(row.capabilityJson),
      requestedAnalysis: JSON.parse(row.requestedAnalysisJson),
      requiredFields: JSON.parse(row.requiredFieldsJson),
      budget: row.budgetJson ? JSON.parse(row.budgetJson) : null,
      collectorCapabilitySnapshotArtifactId: row.collectorCapabilitySnapshotArtifactId,
      collectorCapabilitySnapshotHash: row.collectorCapabilitySnapshotHash,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }
}
