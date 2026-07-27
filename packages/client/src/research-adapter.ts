import {
  ResearchTaskViewSchema,
  mapRunStatusToResearchTaskState,
  type AnalysisRunResponse,
  type ResearchAnalysisBrief,
  type ResearchTaskState,
  type ResearchTaskView
} from "@maa/contracts";
import type { MarketplaceAnalysisClient } from "./client.js";
import { MaaClientError } from "./errors.js";
import { wrapEvidenceArtifact, unwrapEvidenceArtifact } from "./evidence-exchange.js";
import type { EvidencePackageInput } from "@maa/contracts";

export type ResearchTeamAdapterOptions = {
  client: MarketplaceAnalysisClient;
  /**
   * Feature flag — when false, all mutating calls throw without touching MAA.
   * Research Team should gate on RESEARCH_TEAM_MAA_ENABLED (or equivalent).
   */
  enabled: boolean;
  defaultCorrelationId?: string;
};

/**
 * In-memory Research Team work-order record used by the adapter and tests.
 * Deliberately separate from MAA persistence — failure in MAA must not mutate
 * accepted Research Team artifacts.
 */
export type ResearchWorkOrderRecord = {
  externalWorkOrderId: string;
  status: "open" | "waiting_maa" | "artifact_accepted" | "needs_collection" | "errored";
  maaRequestId?: string;
  maaRunId?: string;
  correlationId?: string;
  acceptedArtifact?: {
    kind: "marketplace_analysis";
    maaRunId: string;
    output: unknown;
    acceptedAt: string;
  };
  lastError?: string;
};

export function buildResearchTaskView(input: {
  run: AnalysisRunResponse;
  externalWorkOrderId?: string;
  collectionRequestCount?: number;
  findingCount?: number;
  analysisArtifactId?: string;
}): ResearchTaskView {
  const hasCollection = (input.collectionRequestCount ?? 0) > 0;
  const taskState = mapRunStatusToResearchTaskState(input.run.status, {
    hasCollectionRequests: hasCollection
  });
  return ResearchTaskViewSchema.parse({
    externalWorkOrderId: input.externalWorkOrderId,
    maaRequestId: input.run.requestId,
    maaRunId: input.run.runId,
    projectId: input.run.projectId,
    correlationId: input.run.correlationId,
    taskState,
    maaStatus: input.run.status,
    currentPhase: input.run.currentPhase,
    collectionRequestCount: input.collectionRequestCount ?? 0,
    findingCount: input.findingCount ?? 0,
    analysisArtifactId: input.analysisArtifactId,
    failureCode: input.run.failureCode,
    failureMessage: input.run.failureMessage,
    updatedAt: input.run.updatedAt
  });
}

/**
 * Research Team ↔ MAA adapter. Uses @maa/client only (no DB coupling).
 */
export class ResearchTeamMaaAdapter {
  constructor(private readonly opts: ResearchTeamAdapterOptions) {}

  get enabled(): boolean {
    return this.opts.enabled;
  }

  private assertEnabled(): void {
    if (!this.opts.enabled) {
      throw new Error(
        "Research Team MAA adapter is disabled (feature flag RESEARCH_TEAM_MAA_ENABLED=false)"
      );
    }
  }

  /**
   * Register evidence artifact envelope → MAA evidence package.
   */
  async submitEvidenceArtifact(
    envelope: unknown,
    workOrder?: ResearchWorkOrderRecord
  ): Promise<{ packageId: string }> {
    this.assertEnabled();
    const pkg = unwrapEvidenceArtifact(envelope);
    try {
      const created = await this.opts.client.registerEvidencePackage(pkg, {
        correlationId:
          (typeof envelope === "object" &&
          envelope &&
          "correlationId" in envelope &&
          typeof (envelope as { correlationId?: unknown }).correlationId === "string"
            ? (envelope as { correlationId: string }).correlationId
            : undefined) ??
          workOrder?.correlationId ??
          this.opts.defaultCorrelationId
      });
      return { packageId: created.packageId };
    } catch (err) {
      if (workOrder) {
        workOrder.lastError =
          err instanceof Error ? err.message : "evidence_submit_failed";
        // Do not flip artifact_accepted → errored; only annotate.
        if (workOrder.status !== "artifact_accepted") {
          workOrder.status = "errored";
        }
      }
      throw err;
    }
  }

  /**
   * Create analysis from brief; returns 202-equivalent create response mapped to RT view seed.
   */
  async submitAnalysis(
    brief: ResearchAnalysisBrief,
    workOrder: ResearchWorkOrderRecord
  ): Promise<{ create: Awaited<ReturnType<MarketplaceAnalysisClient["createAnalysis"]>>; view: ResearchTaskView }> {
    this.assertEnabled();
    const priorStatus = workOrder.status;
    const priorArtifact = workOrder.acceptedArtifact;
    try {
      workOrder.status = "waiting_maa";
      const create = await this.opts.client.createAnalysis(
        {
          client: brief.client ?? "research-team",
          projectId: brief.projectId,
          externalWorkOrderId: brief.externalWorkOrderId ?? workOrder.externalWorkOrderId,
          operation: brief.operation,
          capability: brief.capability,
          productContext: brief.productContext,
          requestedAnalysis: brief.requestedAnalysis,
          evidencePackageIds: brief.evidencePackageIds,
          idempotencyKey:
            brief.idempotencyKey ??
            `${workOrder.externalWorkOrderId}:marketplace-analysis:v1`,
          costCapUsd: brief.costCapUsd,
          question: brief.question
        },
        {
          correlationId: workOrder.correlationId ?? this.opts.defaultCorrelationId,
          idempotencyKey:
            brief.idempotencyKey ??
            `${workOrder.externalWorkOrderId}:marketplace-analysis:v1`
        }
      );
      workOrder.maaRequestId = create.requestId;
      workOrder.maaRunId = create.runId;
      workOrder.correlationId = create.correlationId ?? workOrder.correlationId;
      const view = buildResearchTaskView({
        run: {
          runId: create.runId,
          requestId: create.requestId,
          projectId: create.projectId,
          status: create.status,
          currentPhase: create.currentPhase,
          attemptNumber: 1,
          executionId: null,
          correlationId: create.correlationId,
          provider: null,
          model: null,
          startedAt: null,
          heartbeatAt: null,
          completedAt: null,
          timeoutAt: null,
          cancelRequestedAt: null,
          failureCode: null,
          failureMessage: null,
          tokenInput: 0,
          tokenOutput: 0,
          costUsd: 0,
          createdAt: create.createdAt,
          updatedAt: create.createdAt
        },
        externalWorkOrderId: workOrder.externalWorkOrderId
      });
      return { create, view };
    } catch (err) {
      // Restore prior RT state — MAA failure must not corrupt accepted artifacts.
      workOrder.status = priorStatus === "waiting_maa" ? "open" : priorStatus;
      workOrder.acceptedArtifact = priorArtifact;
      workOrder.lastError = err instanceof MaaClientError ? err.message : String(err);
      throw err;
    }
  }

  /**
   * Reload / reconnect: resolve same external run by stored maaRunId (or request id).
   */
  async reconnect(workOrder: ResearchWorkOrderRecord): Promise<ResearchTaskView> {
    this.assertEnabled();
    if (!workOrder.maaRunId) {
      throw new Error("Cannot reconnect: work order has no maaRunId");
    }
    return this.refreshView(workOrder);
  }

  async refreshView(workOrder: ResearchWorkOrderRecord): Promise<ResearchTaskView> {
    this.assertEnabled();
    if (!workOrder.maaRunId) {
      throw new Error("Work order missing maaRunId");
    }
    const run = await this.opts.client.getRun(workOrder.maaRunId, {
      correlationId: workOrder.correlationId ?? this.opts.defaultCorrelationId
    });
    let collectionRequestCount = 0;
    let findingCount = 0;
    let analysisArtifactId: string | undefined;
    try {
      const collections = await this.opts.client.getCollectionRequests(run.runId);
      collectionRequestCount = collections.collectionRequests?.length ?? 0;
    } catch {
      /* optional enrichment */
    }
    try {
      const findings = await this.opts.client.getFindings(run.runId);
      findingCount = findings.findings?.length ?? 0;
    } catch {
      /* optional */
    }

    const view = buildResearchTaskView({
      run,
      externalWorkOrderId: workOrder.externalWorkOrderId,
      collectionRequestCount,
      findingCount,
      analysisArtifactId
    });

    if (view.taskState === "needs_orchestrator_decision") {
      workOrder.status = "needs_collection";
    } else if (view.taskState === "failed" || view.taskState === "cancelled") {
      if (workOrder.status !== "artifact_accepted") {
        workOrder.status = "errored";
        workOrder.lastError = run.failureMessage ?? run.status;
      }
    } else if (
      view.taskState === "ready_for_review" &&
      workOrder.status !== "artifact_accepted"
    ) {
      workOrder.status = "waiting_maa";
    }

    return view;
  }

  /**
   * Accept completed MAA analysis into Research Team as an immutable artifact snapshot.
   */
  async acceptAsResearchArtifact(
    workOrder: ResearchWorkOrderRecord
  ): Promise<ResearchWorkOrderRecord["acceptedArtifact"]> {
    this.assertEnabled();
    if (!workOrder.maaRunId) {
      throw new Error("No MAA run to accept");
    }
    const run = await this.opts.client.getRun(workOrder.maaRunId);
    if (run.status !== "completed" && run.status !== "partial") {
      throw new Error(`Cannot accept run in status ${run.status}`);
    }
    const output = await this.opts.client.getOutput(run.runId);
    const artifact = {
      kind: "marketplace_analysis" as const,
      maaRunId: run.runId,
      output,
      acceptedAt: new Date().toISOString()
    };
    workOrder.acceptedArtifact = artifact;
    workOrder.status = "artifact_accepted";
    return artifact;
  }

  /**
   * Route evidence gaps to Research Orchestrator decision shape (no MCEC call).
   */
  async toOrchestratorDecision(workOrder: ResearchWorkOrderRecord): Promise<{
    decision: "collect_evidence";
    reason: "maa_evidence_gap";
    collectionRequests: unknown[];
    correlationId?: string;
    maaRunId?: string;
  }> {
    this.assertEnabled();
    if (!workOrder.maaRunId) {
      throw new Error("No MAA run for orchestrator decision");
    }
    const collections = await this.opts.client.getCollectionRequests(workOrder.maaRunId);
    return {
      decision: "collect_evidence",
      reason: "maa_evidence_gap",
      collectionRequests: collections.collectionRequests ?? [],
      correlationId: workOrder.correlationId,
      maaRunId: workOrder.maaRunId
    };
  }

  async reviseWithSupplementalEvidence(
    workOrder: ResearchWorkOrderRecord,
    input: {
      reasonCode:
        | "unsupported_conclusion"
        | "incorrect_evidence_interpretation"
        | "missing_analysis"
        | "wrong_scope"
        | "stale_memory_or_evidence"
        | "contradiction_ignored"
        | "confidence_miscalibrated"
        | "other";
      instructions: string;
      supplementalPackage: EvidencePackageInput;
      affectedAreas?: Array<
        | "market_structure"
        | "competitor_set"
        | "customer_evidence"
        | "pricing"
        | "positioning"
        | "keywords_categories"
        | "risk_ip_policy"
      >;
    }
  ): Promise<ResearchTaskView> {
    this.assertEnabled();
    if (!workOrder.maaRunId) {
      throw new Error("No MAA run to revise");
    }
    const priorArtifact = workOrder.acceptedArtifact;
    try {
      const registered = await this.opts.client.registerEvidencePackage(
        input.supplementalPackage,
        { correlationId: workOrder.correlationId }
      );
      const create = await this.opts.client.revise(
        workOrder.maaRunId,
        {
          reasonCode: input.reasonCode,
          notes: input.instructions,
          reviewerId: "research-team",
          supplementalEvidencePackageIds: [registered.packageId],
          affectedAreas: input.affectedAreas,
          idempotencyKey: `${workOrder.externalWorkOrderId}:revise:${registered.packageId}`
        },
        { correlationId: workOrder.correlationId }
      );
      workOrder.maaRequestId = create.requestId;
      workOrder.maaRunId = create.runId;
      workOrder.status = "waiting_maa";
      // Accepted artifact stays until explicitly replaced.
      workOrder.acceptedArtifact = priorArtifact;
      return this.refreshView(workOrder);
    } catch (err) {
      workOrder.acceptedArtifact = priorArtifact;
      workOrder.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }
}

export { wrapEvidenceArtifact, unwrapEvidenceArtifact };
export type { ResearchTaskState };
