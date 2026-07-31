import type { ArtifactStore } from "@maa/artifacts";
import type { AuditLog } from "@maa/audit";
import {
  AppError,
  IdPrefix,
  newId,
  type AnalysisArea,
  type CreateRevisionRequest,
  type LearningEventType,
  type RevisionResponse,
  type RunReviewRequest,
  type RunStatus
} from "@maa/contracts";
import type {
  AnalysisRequestsRepository,
  AnalysisRunsRepository,
  ArtifactsRepository,
  EvidencePackagesRepository,
  FindingsRepository,
  FindingReviewsRepository,
  IdempotencyRepository,
  LearningEventsRepository,
  ProjectsRepository,
  RevisionDiffsRepository,
  RunEventsRepository,
  RunReviewsRepository,
  SqliteDatabase
} from "@maa/database";
import type { Logger } from "@maa/logging";
import { createHash } from "node:crypto";
import { isTerminalStatus } from "./state-machine";
import { buildRevisionDiff } from "./revision-diff";

export interface RevisionServiceDeps {
  db: SqliteDatabase;
  projects: ProjectsRepository;
  requests: AnalysisRequestsRepository;
  runs: AnalysisRunsRepository;
  events: RunEventsRepository;
  evidencePackages: EvidencePackagesRepository;
  findings: FindingsRepository;
  findingReviews: FindingReviewsRepository;
  learningEvents: LearningEventsRepository;
  runReviews: RunReviewsRepository;
  revisionDiffs: RevisionDiffsRepository;
  artifacts: ArtifactsRepository;
  artifactStore: ArtifactStore;
  idempotency: IdempotencyRepository;
  auditLog: AuditLog;
  agentLog: Logger;
  /** N1 one-way dual-write into agent_evaluations (never creates learning_events). */
  experienceDualWrite?: {
    recordFromLegacy: (input: {
      runId: string;
      evaluatorType: "human" | "deterministic" | "model" | "research_orchestrator" | "outcome";
      decision: string;
      sourceSystem:
        | "maa.learning_events"
        | "maa.finding_reviews"
        | "maa.run_reviews"
        | "maa.outcome_reviews"
        | "maa.deterministic"
        | "maa.model"
        | "research_team"
        | "maa.outcome_reassess";
      sourceRecordId: string;
      scores?: Record<string, unknown>;
    }) => void;
  };
  /** N3: attach / complete workflow feedback around revision. */
  workflowFeedback?: {
    attachRevision: (input: { workflowFeedbackId: string; revisionRunId: string }) => void;
    completeRevision: (input: {
      revisionRunId: string;
      priorRunId: string;
      costUsd?: number;
    }) => void;
  };
  assertEvidencePackagesExist: (packageIds: string[]) => void;
  defaultTimeoutSeconds: number;
  defaultModelProfileId: string;
}

function hashPayload(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const REVISABLE: ReadonlySet<string> = new Set([
  "completed",
  "partial",
  "evidence_insufficient",
  "failed"
]);

export class RevisionService {
  constructor(private readonly deps: RevisionServiceDeps) {}

  /**
   * Derive affected areas from explicit input, targeted findings, contested
   * reviews, or fall back to the prior request's analysis areas.
   */
  resolveAffectedAreas(
    priorRunId: string,
    priorRequestAreas: AnalysisArea[],
    input: CreateRevisionRequest
  ): AnalysisArea[] {
    if (input.affectedAreas && input.affectedAreas.length > 0) {
      return [...new Set(input.affectedAreas)];
    }

    if (input.findingIds && input.findingIds.length > 0) {
      const areas = new Set<AnalysisArea>();
      for (const id of input.findingIds) {
        const f = this.deps.findings.getById(id);
        if (f && f.runId === priorRunId) {
          areas.add(f.analysisArea as AnalysisArea);
        }
      }
      if (areas.size > 0) return [...areas];
    }

    const contested = this.deps.findings
      .listByRun(priorRunId)
      .filter(
        (f) =>
          f.validationStatus === "reviewer_rejected" ||
          f.validationStatus === "contested"
      )
      .map((f) => f.analysisArea as AnalysisArea);
    if (contested.length > 0) return [...new Set(contested)];

    return [...priorRequestAreas];
  }

  createRevision(
    priorRunId: string,
    input: CreateRevisionRequest,
    opts: { correlationId: string }
  ): RevisionResponse {
    const priorRun = this.deps.runs.getById(priorRunId);
    if (!priorRun) {
      throw new AppError({
        code: "NOT_FOUND",
        message: `Prior run '${priorRunId}' was not found.`
      });
    }
    if (!REVISABLE.has(priorRun.status)) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        message: `Run '${priorRunId}' cannot be revised from status '${priorRun.status}'.`
      });
    }

    const priorReq = this.deps.requests.getById(priorRun.requestId);
    if (!priorReq) {
      throw new AppError({
        code: "NOT_FOUND",
        message: `Prior request '${priorRun.requestId}' was not found.`
      });
    }

    const priorAreas = JSON.parse(priorReq.requestedAnalysisJson) as AnalysisArea[];
    const affectedAreas = this.resolveAffectedAreas(priorRunId, priorAreas, input);
    if (affectedAreas.length === 0) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        message: "Revision requires at least one affected analysis area."
      });
    }

    const priorPackages = this.deps.evidencePackages
      .listForRequest(priorReq.requestId)
      .map((p) => p.packageId);
    const evidencePackageIds = [
      ...new Set([
        ...(input.evidencePackageIds ?? priorPackages),
        ...input.supplementalEvidencePackageIds
      ])
    ];
    if (evidencePackageIds.length === 0) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        message: "Revision requires at least one evidence package."
      });
    }
    this.deps.assertEvidencePackagesExist(evidencePackageIds);

    const idempotencyKey = input.idempotencyKey;
    const requestHash = hashPayload({
      priorRunId,
      ...input,
      idempotencyKey: undefined
    });

    if (idempotencyKey) {
      const existing = this.deps.idempotency.get(priorReq.client, idempotencyKey);
      if (existing?.runId && existing.requestId) {
        if (existing.requestHash && existing.requestHash !== requestHash) {
          throw new AppError({
            code: "IDEMPOTENCY_CONFLICT",
            message: "Idempotency key was reused with a different revision payload."
          });
        }
        const run = this.deps.runs.getById(existing.runId)!;
        return {
          priorRunId,
          requestId: existing.requestId,
          runId: existing.runId,
          projectId: priorReq.projectId,
          attemptNumber: run.attemptNumber,
          affectedAreas,
          evidencePackageIds,
          learningEventId: "",
          statusUrl: `/v1/analysis-runs/${existing.runId}`,
          createdAt: run.createdAt
        };
      }
    }

    const now = new Date().toISOString();
    const requestId = newId(IdPrefix.request);
    const runId = newId(IdPrefix.run);
    const learningEventId = newId(IdPrefix.learning);
    const attemptNumber = priorRun.attemptNumber + 1;
    const timeoutSeconds = input.timeoutSeconds ?? this.deps.defaultTimeoutSeconds;
    const timeoutAt = new Date(Date.now() + timeoutSeconds * 1000).toISOString();

    const tx = this.deps.db.transaction(() => {
      this.deps.requests.insert({
        requestId,
        projectId: priorReq.projectId,
        client: priorReq.client,
        clientRequestId: null,
        externalWorkOrderId: priorReq.externalWorkOrderId,
        operation: "revise_analysis",
        requestedAnalysisJson: JSON.stringify(affectedAreas),
        question: input.question ?? priorReq.question,
        capabilityId: priorReq.capabilityId,
        capabilityVersion: priorReq.capabilityVersion,
        modelProfileId: priorReq.modelProfileId ?? this.deps.defaultModelProfileId,
        requestPayloadArtifactId: null,
        idempotencyKey: idempotencyKey ?? null,
        requestHash,
        status: "accepted",
        evidencePlanId: null,
        evidencePlanVersion: null,
        outcomeId: null,
        baselineEvidencePackageIdsJson: "[]",
        createdAt: now,
        updatedAt: now
      });

      this.deps.runs.insert({
        runId,
        requestId,
        attemptNumber,
        status: "accepted",
        currentPhase: "accepted",
        executionId: null,
        correlationId: opts.correlationId,
        provider: "fake",
        model: "fake-structured",
        promptVersion: null,
        capabilityVersion: priorReq.capabilityVersion,
        startedAt: null,
        heartbeatAt: null,
        completedAt: null,
        timeoutAt,
        cancelRequestedAt: null,
        failureCode: null,
        failureMessage: null,
        tokenInput: 0,
        tokenOutput: 0,
        costUsd: 0,
        outputArtifactId: null,
        qualityScore: null,
        priorRunId,
        revisionOfRequestId: priorReq.requestId,
        affectedAreasJson: JSON.stringify(affectedAreas),
        createdAt: now,
        updatedAt: now
      });

      this.deps.events.insert({
        eventId: newId(IdPrefix.event),
        runId,
        requestId,
        correlationId: opts.correlationId,
        eventType: "revision_accepted",
        phase: "accepted",
        fromStatus: null,
        toStatus: "accepted",
        detailJson: JSON.stringify({
          priorRunId,
          affectedAreas,
          evidencePackageIds,
          reasonCode: input.reasonCode
        }),
        createdAt: now
      });

      for (const packageId of evidencePackageIds) {
        this.deps.evidencePackages.linkToRequest(requestId, packageId, now);
      }

      this.deps.learningEvents.insert({
        learningEventId,
        projectId: priorReq.projectId,
        eventType: "revision_requested",
        reasonCode: input.reasonCode,
        notes: input.notes ?? null,
        sourceRunId: priorRunId,
        sourceFindingId: input.findingIds?.[0] ?? null,
        revisionRunId: runId,
        payloadJson: JSON.stringify({
          affectedAreas,
          findingIds: input.findingIds ?? [],
          supplementalEvidencePackageIds: input.supplementalEvidencePackageIds,
          reviewerId: input.reviewerId
        }),
        promotionStatus: "recorded",
        createdAt: now
      });

      this.deps.experienceDualWrite?.recordFromLegacy({
        runId: priorRunId,
        evaluatorType: "human",
        decision: "revision_requested",
        sourceSystem: "maa.learning_events",
        sourceRecordId: learningEventId,
        scores: { reasonCode: input.reasonCode, revisionRunId: runId }
      });

      if (idempotencyKey) {
        this.deps.idempotency.insert({
          idempotencyKey,
          client: priorReq.client,
          requestId,
          runId,
          requestHash,
          createdAt: now
        });
      }
    });

    tx();

    if (input.workflowFeedbackId) {
      this.deps.workflowFeedback?.attachRevision({
        workflowFeedbackId: input.workflowFeedbackId,
        revisionRunId: runId
      });
    }

    this.deps.auditLog.append({
      actorType: "reviewer",
      actorId: input.reviewerId,
      action: "run.revision_accepted",
      targetType: "analysis_run",
      targetId: runId,
      after: { priorRunId, affectedAreas, attemptNumber },
      correlationId: opts.correlationId,
      requestId,
      runId
    });

    this.deps.agentLog.info(
      {
        eventType: "revision_accepted",
        priorRunId,
        runId,
        requestId,
        affectedAreas
      },
      "revision run accepted"
    );

    return {
      priorRunId,
      requestId,
      runId,
      projectId: priorReq.projectId,
      attemptNumber,
      affectedAreas,
      evidencePackageIds,
      learningEventId,
      statusUrl: `/v1/analysis-runs/${runId}`,
      createdAt: now
    };
  }

  reviewRun(runId: string, input: RunReviewRequest) {
    const run = this.deps.runs.getById(runId);
    if (!run) {
      throw new AppError({ code: "NOT_FOUND", message: `Run '${runId}' was not found.` });
    }
    if (!isTerminalStatus(run.status as RunStatus) && input.action !== "request_revision") {
      // Allow request_revision on terminal; accept/reject also expect terminal output.
    }
    if (
      (input.action === "accept_run" || input.action === "reject_run") &&
      !isTerminalStatus(run.status as RunStatus)
    ) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        message: "Run must be terminal before accept/reject review."
      });
    }

    const req = this.deps.requests.getById(run.requestId);
    const now = new Date().toISOString();
    const reviewId = newId(IdPrefix.review);
    const learningEventId = newId(IdPrefix.learning);
    const eventType: LearningEventType =
      input.action === "accept_run"
        ? "run_accepted"
        : input.action === "reject_run"
          ? "run_rejected"
          : "revision_requested";

    this.deps.runReviews.insert({
      reviewId,
      runId,
      action: input.action,
      reasonCode: input.reasonCode ?? null,
      notes: input.notes ?? null,
      reviewerId: input.reviewerId,
      createdAt: now
    });

    this.deps.learningEvents.insert({
      learningEventId,
      projectId: req?.projectId ?? "unknown",
      eventType,
      reasonCode: input.reasonCode ?? null,
      notes: input.notes ?? null,
      sourceRunId: runId,
      sourceFindingId: null,
      revisionRunId: null,
      payloadJson: JSON.stringify({ action: input.action, reviewerId: input.reviewerId }),
      promotionStatus: "recorded",
      createdAt: now
    });

    this.deps.experienceDualWrite?.recordFromLegacy({
      runId,
      evaluatorType: "human",
      decision: input.action,
      sourceSystem: "maa.run_reviews",
      sourceRecordId: reviewId,
      scores: { reasonCode: input.reasonCode ?? null, learningEventId }
    });
    this.deps.experienceDualWrite?.recordFromLegacy({
      runId,
      evaluatorType: "human",
      decision: eventType,
      sourceSystem: "maa.learning_events",
      sourceRecordId: learningEventId,
      scores: { action: input.action, reviewId }
    });

    this.deps.auditLog.append({
      actorType: "reviewer",
      actorId: input.reviewerId,
      action: "run.reviewed",
      targetType: "analysis_run",
      targetId: runId,
      after: { action: input.action, reasonCode: input.reasonCode ?? null },
      runId
    });

    return {
      reviewId,
      runId,
      action: input.action,
      reasonCode: input.reasonCode ?? null,
      notes: input.notes ?? null,
      reviewerId: input.reviewerId,
      learningEventId,
      createdAt: now
    };
  }

  /**
   * After a revision analysis completes, supersede prior findings in affected
   * areas, persist a before/after diff artifact, and record a learning event.
   */
  finalizeRevision(revisionRunId: string): void {
    const run = this.deps.runs.getById(revisionRunId);
    if (!run?.priorRunId) return;

    const affectedAreas = (run.affectedAreasJson
      ? (JSON.parse(run.affectedAreasJson) as AnalysisArea[])
      : []) as AnalysisArea[];
    if (affectedAreas.length === 0) return;

    const priorFindings = this.deps.findings.listByRun(run.priorRunId);
    const newFindings = this.deps.findings.listByRun(revisionRunId);
    const now = new Date().toISOString();

    const diff = buildRevisionDiff({
      priorRunId: run.priorRunId,
      revisionRunId,
      affectedAreas,
      priorFindings,
      newFindings
    });

    // Supersede replaced prior findings; rejected/contested stay marked as such
    // unless replaced (then superseded wins for lineage).
    for (const entry of diff.entries) {
      if (
        (entry.change === "replaced" || entry.change === "unchanged") &&
        entry.priorFindingId &&
        entry.newFindingId
      ) {
        this.deps.findings.markSuperseded(entry.priorFindingId, entry.newFindingId, now);
      }
    }

    const artifact = this.deps.artifactStore.writeJson(diff, {
      subdir: "revision-diffs",
      accessClass: "internal"
    });
    this.deps.artifacts.insert({
      artifactId: artifact.artifactId,
      relativePath: artifact.relativePath,
      contentHash: artifact.contentHash,
      mimeType: artifact.mimeType,
      sizeBytes: artifact.sizeBytes,
      redactionStatus: artifact.redactionStatus,
      accessClass: artifact.accessClass,
      relatedRunId: revisionRunId,
      relatedRequestId: run.requestId,
      createdAt: artifact.createdAt
    });

    this.deps.revisionDiffs.insert({
      diffId: newId(IdPrefix.diff),
      priorRunId: run.priorRunId,
      revisionRunId,
      artifactId: artifact.artifactId,
      payloadJson: JSON.stringify(diff),
      createdAt: now
    });

    const req = this.deps.requests.getById(run.requestId);
    const revisionLearningEventId = newId(IdPrefix.learning);
    this.deps.learningEvents.insert({
      learningEventId: revisionLearningEventId,
      projectId: req?.projectId ?? "unknown",
      eventType: "revision_completed",
      reasonCode: null,
      notes: null,
      sourceRunId: run.priorRunId,
      sourceFindingId: null,
      revisionRunId,
      payloadJson: JSON.stringify({
        entryCount: diff.entries.length,
        affectedAreas,
        artifactId: artifact.artifactId
      }),
      promotionStatus: "recorded",
      createdAt: now
    });

    this.deps.experienceDualWrite?.recordFromLegacy({
      runId: revisionRunId,
      evaluatorType: "human",
      decision: "revision_completed",
      sourceSystem: "maa.learning_events",
      sourceRecordId: revisionLearningEventId,
      scores: {
        priorRunId: run.priorRunId,
        entryCount: diff.entries.length,
        artifactId: artifact.artifactId
      }
    });

    // N3: close late-gap feedback if this revision is linked.
    if (this.deps.workflowFeedback && run.priorRunId) {
      this.deps.workflowFeedback.completeRevision({
        revisionRunId,
        priorRunId: run.priorRunId,
        costUsd: run.costUsd ?? 0
      });
    }

    this.deps.events.insert({
      eventId: newId(IdPrefix.event),
      runId: revisionRunId,
      requestId: run.requestId,
      correlationId: run.correlationId,
      eventType: "revision_diff_recorded",
      phase: run.currentPhase,
      fromStatus: run.status,
      toStatus: run.status,
      detailJson: JSON.stringify({
        priorRunId: run.priorRunId,
        entryCount: diff.entries.length,
        artifactId: artifact.artifactId
      }),
      createdAt: now
    });
  }

  recordFindingLearningEvent(input: {
    projectId: string;
    findingId: string;
    runId: string;
    action: string;
    reasonCode?: string | null;
    notes?: string | null;
  }): string {
    const eventType: LearningEventType =
      input.action === "accept"
        ? "finding_accepted"
        : input.action === "reject"
          ? "finding_rejected"
          : "finding_contested";

    const learningEventId = newId(IdPrefix.learning);
    this.deps.learningEvents.insert({
      learningEventId,
      projectId: input.projectId,
      eventType,
      reasonCode: input.reasonCode ?? null,
      notes: input.notes ?? null,
      sourceRunId: input.runId,
      sourceFindingId: input.findingId,
      revisionRunId: null,
      payloadJson: JSON.stringify({ action: input.action }),
      promotionStatus: "recorded",
      createdAt: new Date().toISOString()
    });
    this.deps.experienceDualWrite?.recordFromLegacy({
      runId: input.runId,
      evaluatorType: "human",
      decision: eventType,
      sourceSystem: "maa.learning_events",
      sourceRecordId: learningEventId,
      scores: { action: input.action, findingId: input.findingId }
    });
    return learningEventId;
  }
}
