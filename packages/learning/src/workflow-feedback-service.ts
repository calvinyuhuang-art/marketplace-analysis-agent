import type { ArtifactStore } from "@maa/artifacts";
import {
  GAP_FINGERPRINT_VERSION,
  formatGapFingerprintKey,
  type GapFingerprintComponents
} from "@maa/agent-memory-contracts";
import {
  AppError,
  IdPrefix,
  newId,
  type AnalysisArea,
  type EvidenceItem,
  type ResolveWorkflowFeedback,
  type WorkflowFeedbackResponse
} from "@maa/contracts";
import type {
  AgentExperiencesRepository,
  ArtifactsRepository,
  CollectionRequestsRepository,
  GapFingerprintsRepository,
  WorkflowFeedbackRepository
} from "@maa/database";

export type WorkflowFeedbackServiceDeps = {
  feedback: WorkflowFeedbackRepository;
  fingerprints: GapFingerprintsRepository;
  collectionRequests: CollectionRequestsRepository;
  artifacts: ArtifactsRepository;
  artifactStore: ArtifactStore;
  experiences?: AgentExperiencesRepository;
  projectWarningThreshold: number;
  crossProjectPromotionThreshold: number;
  /** Optional SQLite handle for transactional Learning Plane outbox capture. */
  db?: import("@maa/database").SqliteDatabase;
  /** Optional Learning Plane production capture hooks (LP8-I3b). */
  learningPlaneCapture?: {
    captureCreated: (row: import("@maa/database").WorkflowFeedbackRow) => void;
    captureEvaluated: (row: import("@maa/database").WorkflowFeedbackRow) => void;
  };
};

function parseJsonArray(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function hasNonEmpty(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Late-evidence-gap detection and RT resolution loop (N3).
 * Does not activate typed procedural rules.
 */
export class WorkflowFeedbackService {
  constructor(private readonly deps: WorkflowFeedbackServiceDeps) {}

  /**
   * Inspect priced listings after analysis. Emits at most one late_evidence_gap per run.
   */
  detectLatePricingGaps(input: {
    projectId: string;
    runId: string;
    requestId: string;
    correlationId?: string | null;
    externalWorkOrderId?: string | null;
    operation: string;
    capabilityVersion: string;
    platform: string;
    marketplace: string;
    productType: string;
    requestedAreas: AnalysisArea[];
    evidenceItems: EvidenceItem[];
    outputArtifactId?: string | null;
    /** When set, skip late detect if readiness already blocked pricing (N4 prevention). */
    readiness?: import("@maa/contracts").ReadinessReport;
  }): WorkflowFeedbackResponse | null {
    if (!input.requestedAreas.includes("pricing")) return null;
    const pricingReadiness = input.readiness?.areas.find((a) => a.area === "pricing");
    if (
      pricingReadiness &&
      pricingReadiness.allowedOutputLevel === "none" &&
      pricingReadiness.gaps.some((g) => g.field === "binding")
    ) {
      return null;
    }
    const existing = this.deps.feedback.getByRunId(input.runId);
    if (existing) return this.toResponse(existing);

    const listings = input.evidenceItems.filter((i) => i.sourceType === "listing");
    const priced = listings.filter((l) => typeof l.fields.price === "number");
    if (priced.length === 0) return null;

    const missingBinding = priced.filter((l) => !hasNonEmpty(l.fields.binding));
    const missingFormat = priced.filter((l) => !hasNonEmpty(l.fields.format));
    const contradictory = priced.filter((l) => {
      const binding = String(l.fields.binding ?? "")
        .toLowerCase()
        .trim();
      const format = String(l.fields.format ?? "")
        .toLowerCase()
        .trim();
      if (!binding || !format) return false;
      return binding !== format && !format.includes(binding) && !binding.includes(format);
    });
    const formats = new Set(
      priced
        .map((l) => String(l.fields.format ?? "").toLowerCase().trim())
        .filter((f) => f.length > 0)
    );
    const mixedUnsegmented = formats.size > 1 && missingFormat.length > 0;

    if (
      missingBinding.length === 0 &&
      missingFormat.length === 0 &&
      contradictory.length === 0 &&
      !mixedUnsegmented
    ) {
      return null;
    }

    const reasons: string[] = [];
    if (missingBinding.length > 0) {
      reasons.push(`${missingBinding.length} priced listing(s) missing binding`);
    }
    if (missingFormat.length > 0) {
      reasons.push(`${missingFormat.length} priced listing(s) missing format`);
    }
    if (contradictory.length > 0) {
      reasons.push(`${contradictory.length} listing(s) with contradictory binding/format`);
    }
    if (mixedUnsegmented) {
      reasons.push("mixed formats without complete format segmentation");
    }

    const components: GapFingerprintComponents = {
      platform: input.platform,
      marketplace: input.marketplace,
      productType: input.productType,
      capabilityVersion: input.capabilityVersion,
      operation: input.operation,
      analysisArea: "pricing",
      upstreamStep: "evidence_collection",
      missingEvidenceType: "format_normalization",
      collectorCapabilityKey: "listing.binding+format"
    };
    const fingerprintKey = formatGapFingerprintKey(components, GAP_FINGERPRINT_VERSION);
    const now = new Date().toISOString();

    let fingerprint = this.deps.fingerprints.getByKey(fingerprintKey);
    if (!fingerprint) {
      const fingerprintId = newId(IdPrefix.gapFingerprint);
      this.deps.fingerprints.insert({
        fingerprintId,
        fingerprintKey,
        fingerprintVersion: GAP_FINGERPRINT_VERSION,
        componentsJson: JSON.stringify(components),
        projectId: input.projectId,
        firstSeenAt: now,
        lastSeenAt: now,
        distinctRunCount: 1,
        distinctProjectCount: 1
      });
      fingerprint = this.deps.fingerprints.getById(fingerprintId)!;
    } else {
      const priorRuns = this.deps.feedback.countDistinctRunsForFingerprint(
        fingerprint.fingerprintId
      );
      const priorProjects = this.deps.feedback.countDistinctProjectsForFingerprint(
        fingerprint.fingerprintId
      );
      const projectKnown = this.deps.feedback.projectSeenForFingerprint(
        fingerprint.fingerprintId,
        input.projectId
      );
      this.deps.fingerprints.touch({
        fingerprintId: fingerprint.fingerprintId,
        lastSeenAt: now,
        distinctRunCount: Math.max(fingerprint.distinctRunCount, priorRuns + 1),
        distinctProjectCount: Math.max(
          fingerprint.distinctProjectCount,
          projectKnown ? priorProjects : priorProjects + 1
        )
      });
      fingerprint = this.deps.fingerprints.getById(fingerprint.fingerprintId)!;
    }

    const collectionRequestId = newId(IdPrefix.collectionRequest);
    const collectionPayload = {
      collectionRequestId,
      requestType: "supplemental_collection" as const,
      status: "proposed" as const,
      priority: "high" as const,
      platform: input.platform,
      marketplace: input.marketplace,
      targetSet: priced.map((p) => p.subjectId),
      requiredEvidence: [
        "listing.binding",
        "listing.format",
        "format_normalized_price_segments"
      ],
      reason: `Late evidence gap during pricing analysis: ${reasons.join("; ")}.`,
      analysisAreasBlocked: ["pricing"] as AnalysisArea[],
      completionRule: {
        requiredFields: ["binding", "format"],
        minimumItems: Math.max(2, priced.length)
      },
      suggestedCollectorCapability: "mcec",
      runId: input.runId,
      requestId: input.requestId,
      createdAt: now
    };
    this.deps.collectionRequests.insert({
      collectionRequestId,
      runId: input.runId,
      requestId: input.requestId,
      requestType: "supplemental_collection",
      status: "proposed",
      priority: "high",
      platform: input.platform,
      marketplace: input.marketplace,
      targetSetJson: JSON.stringify(priced.map((p) => p.subjectId)),
      requiredEvidenceJson: JSON.stringify([
        "listing.binding",
        "listing.format",
        "format_normalized_price_segments"
      ]),
      reason: `Late evidence gap during pricing analysis: ${reasons.join("; ")}.`,
      analysisAreasBlockedJson: JSON.stringify(["pricing"]),
      completionRuleJson: JSON.stringify({
        requiredFields: ["binding", "format"],
        minimumItems: Math.max(2, priced.length)
      }),
      suggestedCollectorCapability: "mcec",
      payloadJson: JSON.stringify(collectionPayload),
      createdAt: now,
      updatedAt: now
    });

    const experienceId =
      this.deps.experiences?.getByRunId(input.runId)?.experienceId ?? null;
    const workflowFeedbackId = newId(IdPrefix.workflowFeedback);
    const missingRequirement = {
      analysisArea: "pricing",
      reasons,
      requiredFields: ["binding", "format"],
      pricedListingCount: priced.length,
      missingBindingCount: missingBinding.length,
      missingFormatCount: missingFormat.length,
      contradictoryCount: contradictory.length
    };

    const report = this.deps.artifactStore.writeJson(
      {
        schemaVersion: "maa.workflow_feedback.v1",
        workflowFeedbackId,
        missingRequirement,
        collectionRequestId,
        fingerprintKey
      },
      { subdir: "workflow-feedback", accessClass: "internal" }
    );
    this.deps.artifacts.insert({
      artifactId: report.artifactId,
      relativePath: report.relativePath,
      contentHash: report.contentHash,
      mimeType: report.mimeType,
      sizeBytes: report.sizeBytes,
      redactionStatus: report.redactionStatus,
      accessClass: report.accessClass,
      relatedRunId: input.runId,
      relatedRequestId: input.requestId,
      createdAt: report.createdAt
    });

    let createdRow: import("@maa/database").WorkflowFeedbackRow | null = null;
    const writeCanonicalAndOutbox = (): boolean => {
      const inserted = this.deps.feedback.insert({
        workflowFeedbackId,
        status: "detected",
        projectId: input.projectId,
        runId: input.runId,
        requestId: input.requestId,
        experienceId,
        externalWorkOrderId: input.externalWorkOrderId ?? null,
        correlationId: input.correlationId ?? null,
        sourceAgentId: "research-team",
        discoveringAgentId: "marketplace-analysis-agent",
        upstreamStepKey: "evidence_collection",
        downstreamStepKey: "pricing_analysis",
        feedbackType: "late_evidence_gap",
        gapFingerprintId: fingerprint.fingerprintId,
        missingRequirementJson: JSON.stringify(missingRequirement),
        originalArtifactIdsJson: JSON.stringify(
          [input.outputArtifactId].filter(Boolean) as string[]
        ),
        collectionRequestIdsJson: JSON.stringify([collectionRequestId]),
        resolutionAction: null,
        supplementalEvidencePackageIdsJson: "[]",
        revisionRunId: null,
        resolutionQuality: null,
        resolved: null,
        addedDurationMs: null,
        addedCostUsd: null,
        addedCollectionRounds: null,
        candidateLessonStatus: "none",
        reportArtifactId: report.artifactId,
        detectedAt: now,
        updatedAt: now,
        resolvedAt: null
      });
      if (!inserted) return false;
      createdRow = this.deps.feedback.getById(workflowFeedbackId)!;
      this.deps.learningPlaneCapture?.captureCreated(createdRow);
      return true;
    };

    const ok = this.deps.db
      ? this.deps.db.transaction(writeCanonicalAndOutbox)()
      : writeCanonicalAndOutbox();

    if (!ok || !createdRow) {
      return this.toResponse(this.deps.feedback.getByRunId(input.runId)!);
    }
    return this.toResponse(createdRow);
  }

  getById(id: string): WorkflowFeedbackResponse {
    const row = this.deps.feedback.getById(id);
    if (!row) {
      throw new AppError({
        code: "NOT_FOUND",
        message: `Workflow feedback '${id}' was not found.`
      });
    }
    return this.toResponse(row);
  }

  listByRun(runId: string): WorkflowFeedbackResponse[] {
    return this.deps.feedback.listByRun(runId).map((r) => this.toResponse(r));
  }

  resolve(id: string, input: ResolveWorkflowFeedback): WorkflowFeedbackResponse {
    const row = this.deps.feedback.getById(id);
    if (!row) {
      throw new AppError({
        code: "NOT_FOUND",
        message: `Workflow feedback '${id}' was not found.`
      });
    }
    if (
      row.status === "resolved" ||
      row.status === "partially_resolved" ||
      row.status === "abandoned"
    ) {
      throw new AppError({
        code: "IDEMPOTENCY_CONFLICT",
        message: `Workflow feedback '${id}' is already terminal (${row.status}).`
      });
    }

    const now = new Date().toISOString();
    const status =
      input.supplementalEvidencePackageIds.length > 0
        ? "supplemental_attached"
        : "resolution_proposed";

    this.deps.feedback.update({
      workflowFeedbackId: id,
      status,
      resolutionAction: input.resolutionAction,
      supplementalEvidencePackageIdsJson: JSON.stringify(
        input.supplementalEvidencePackageIds
      ),
      updatedAt: now
    });
    return this.toResponse(this.deps.feedback.getById(id)!);
  }

  attachRevision(input: { workflowFeedbackId: string; revisionRunId: string }): void {
    const row = this.deps.feedback.getById(input.workflowFeedbackId);
    if (!row) return;
    this.deps.feedback.update({
      workflowFeedbackId: input.workflowFeedbackId,
      status: "revision_in_progress",
      revisionRunId: input.revisionRunId,
      updatedAt: new Date().toISOString()
    });
  }

  completeRevision(input: {
    revisionRunId: string;
    priorRunId: string;
    costUsd?: number;
    bindingPresentInSupplemental: boolean;
  }): WorkflowFeedbackResponse | null {
    const row =
      this.deps.feedback.getByRevisionRunId(input.revisionRunId) ??
      this.deps.feedback.getByRunId(input.priorRunId);
    if (!row) return null;

    const now = new Date().toISOString();
    const detectedMs = Date.parse(row.detectedAt);
    const durationMs = Number.isFinite(detectedMs)
      ? Math.max(0, Date.now() - detectedMs)
      : 0;
    const quality = input.bindingPresentInSupplemental ? "full" : "partial";
    const status = quality === "full" ? "resolved" : "partially_resolved";
    const rounds =
      parseJsonArray(row.supplementalEvidencePackageIdsJson).length > 0 ? 1 : 0;

    const writeEvaluationAndOutbox = () => {
      this.deps.feedback.update({
        workflowFeedbackId: row.workflowFeedbackId,
        status,
        revisionRunId: input.revisionRunId,
        resolutionQuality: quality,
        resolved: quality === "full" ? 1 : 0,
        addedDurationMs: durationMs,
        addedCostUsd: input.costUsd ?? 0,
        addedCollectionRounds: rounds,
        candidateLessonStatus: "none",
        updatedAt: now,
        resolvedAt: now
      });
      const updated = this.deps.feedback.getById(row.workflowFeedbackId)!;
      this.deps.learningPlaneCapture?.captureEvaluated(updated);
      return updated;
    };

    const updated = this.deps.db
      ? this.deps.db.transaction(writeEvaluationAndOutbox)()
      : writeEvaluationAndOutbox();
    return this.toResponse(updated);
  }

  getFingerprint(fingerprintId: string) {
    const fp = this.deps.fingerprints.getById(fingerprintId);
    if (!fp) {
      throw new AppError({
        code: "NOT_FOUND",
        message: `Gap fingerprint '${fingerprintId}' was not found.`
      });
    }
    return {
      fingerprintId: fp.fingerprintId,
      fingerprintKey: fp.fingerprintKey,
      fingerprintVersion: fp.fingerprintVersion,
      components: JSON.parse(fp.componentsJson),
      projectId: fp.projectId,
      firstSeenAt: fp.firstSeenAt,
      lastSeenAt: fp.lastSeenAt,
      distinctRunCount: fp.distinctRunCount,
      distinctProjectCount: fp.distinctProjectCount,
      projectWarning: fp.distinctRunCount >= this.deps.projectWarningThreshold,
      promotionEligible:
        fp.distinctProjectCount >= this.deps.crossProjectPromotionThreshold
    };
  }

  private toResponse(row: {
    workflowFeedbackId: string;
    status: string;
    projectId: string;
    runId: string;
    requestId: string;
    experienceId: string | null;
    gapFingerprintId: string;
    missingRequirementJson: string;
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
    detectedAt: string;
    updatedAt: string;
    resolvedAt: string | null;
  }): WorkflowFeedbackResponse {
    const fp = this.deps.fingerprints.getById(row.gapFingerprintId);
    return {
      workflowFeedbackId: row.workflowFeedbackId,
      status: row.status as WorkflowFeedbackResponse["status"],
      projectId: row.projectId,
      runId: row.runId,
      requestId: row.requestId,
      experienceId: row.experienceId,
      feedbackType: "late_evidence_gap",
      gapFingerprintId: row.gapFingerprintId,
      gapFingerprintKey: fp?.fingerprintKey,
      missingRequirement: JSON.parse(row.missingRequirementJson) as Record<
        string,
        unknown
      >,
      collectionRequestIds: parseJsonArray(row.collectionRequestIdsJson),
      resolutionAction: row.resolutionAction as WorkflowFeedbackResponse["resolutionAction"],
      supplementalEvidencePackageIds: parseJsonArray(
        row.supplementalEvidencePackageIdsJson
      ),
      revisionRunId: row.revisionRunId,
      resolutionQuality:
        row.resolutionQuality as WorkflowFeedbackResponse["resolutionQuality"],
      resolved: row.resolved === null ? null : row.resolved === 1,
      addedDurationMs: row.addedDurationMs,
      addedCostUsd: row.addedCostUsd,
      addedCollectionRounds: row.addedCollectionRounds,
      candidateLessonStatus: row.candidateLessonStatus,
      projectWarning: (fp?.distinctRunCount ?? 0) >= this.deps.projectWarningThreshold,
      detectedAt: row.detectedAt,
      updatedAt: row.updatedAt,
      resolvedAt: row.resolvedAt
    };
  }
}
