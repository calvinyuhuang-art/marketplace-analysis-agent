import type { ArtifactStore } from "@maa/artifacts";
import type { AuditLog } from "@maa/audit";
import {
  IdPrefix,
  newId,
  type AnalysisArea,
  type CollectionRequest,
  type ReadinessReport,
  type RunStatus
} from "@maa/contracts";
import type {
  AnalysisRequestsRepository,
  AnalysisRunsRepository,
  ArtifactsRepository,
  CollectionRequestsRepository,
  EvidencePackagesRepository,
  ExecutionLocksRepository,
  RunReadinessRepository
} from "@maa/database";
import type { Logger } from "@maa/logging";
import {
  buildCollectionRequests,
  evaluateReadiness
} from "@maa/capability-amazon-kdp";
import type { EvidenceService } from "@maa/evidence";
import { isActiveStatus, isTerminalStatus } from "./state-machine";
import { transitionRun, type TransitionDeps } from "./transition";

export interface FakeWorkflowOptions {
  phaseDelayMs: number;
  heartbeatMs: number;
  leaseMs: number;
  ownerInstance: string;
  onPhase?: (runId: string, status: RunStatus) => void;
  sleep?: (ms: number) => Promise<void>;
  /** When set, evaluating_evidence runs the real readiness gate. */
  readiness?: {
    evidence: EvidenceService;
    packages: EvidencePackagesRepository;
    collectionRequests: CollectionRequestsRepository;
    readinessRepo: RunReadinessRepository;
    artifacts: ArtifactsRepository;
    artifactStore: ArtifactStore;
    auditLog: AuditLog;
    agentLog: Logger;
    /** N4: enrich readiness with active typed procedural prevention rules. */
    applyTypedProceduralRules?: (input: {
      report: import("@maa/contracts").ReadinessReport;
      items: import("@maa/contracts").EvidenceItem[];
      requestedAreas: AnalysisArea[];
    }) => import("@maa/contracts").ReadinessReport;
  };
  /** When set, analyzing runs structured model analysis + quality gates. */
  analysis?: {
    run: (
      deps: import("@maa/analysis").AnalysisRunnerDeps,
      input: import("@maa/analysis").RunAnalysisInput
    ) => Promise<import("@maa/analysis").RunAnalysisResult>;
    deps: import("@maa/analysis").AnalysisRunnerDeps;
    projects: import("@maa/database").ProjectsRepository;
    evidence: EvidenceService;
    packages: EvidencePackagesRepository;
    agentLog: Logger;
    auditLog: AuditLog;
    fixtureKey?: string;
    /** Called after successful analysis when the run is a revision. */
    onRevisionComplete?: (runId: string) => void;
  };
  /** When set, recalling_memory / proposing_memory use the memory service. */
  memory?: {
    service: import("@maa/memory").MemoryService;
    findings: import("@maa/database").FindingsRepository;
    items: import("@maa/database").MemoryItemsRepository;
    scopes: import("@maa/database").MemoryScopesRepository;
    links: import("@maa/database").MemoryLinksRepository;
    saveWorking: typeof import("@maa/memory").saveWorkingMemoryFromFindings;
    agentLog: Logger;
    auditLog: AuditLog;
    resolveProceduralRules?: (input: {
      projectId: string;
      platform?: string;
      marketplace?: string;
      category?: string;
      productType?: string;
      analysisAreas: AnalysisArea[];
    }) => import("@maa/contracts").ProceduralRulePromptItem[];
    projects?: import("@maa/database").ProjectsRepository;
    /** LP8-I6d: optional external published-knowledge assembly (server-wired). */
    recallAnalysisContext?: (input: {
      runId: string;
      projectId: string;
      query: string;
      scope: {
        projectId: string;
        platform?: string;
        marketplace?: string;
        category?: string;
        productType?: string;
        analysisAreas: AnalysisArea[];
      };
      requestedAreas: AnalysisArea[];
      proceduralRules?: import("@maa/contracts").ProceduralRulePromptItem[];
    }) => {
      approved: import("@maa/contracts").MemoryPromptItem[];
      failureCorrections: import("@maa/contracts").MemoryPromptItem[];
      proceduralRules?: import("@maa/contracts").ProceduralRulePromptItem[];
      assemblyId: string;
      externalKnowledgeSection?: string;
      combinedMemorySection?: string;
    };
  };
  /** N1: experience/evaluation capture hooks (duck-typed; implemented by ExperienceService). */
  experience?: {
    captureStarted: (input: {
      projectId: string;
      requestId: string;
      runId: string;
      attempt: number;
      correlationId?: string | null;
      operation: string;
      capabilityKey?: string | null;
      capabilityVersion?: string | null;
      evidencePackageIds?: string[];
    }) => void;
    complete: (input: {
      runId: string;
      status: "completed" | "failed" | "cancelled";
      contextAssemblyId?: string | null;
      outputArtifactId?: string | null;
      tokenInput?: number;
      tokenOutput?: number;
      costUsd?: number;
      summary?: string;
    }) => void;
    recordDeterministicEvaluation?: (input: {
      runId: string;
      decision: string;
      sourceRecordId: string;
      scores?: Record<string, unknown>;
    }) => void;
  };
  /** N2: deterministic evidence-plan review (duck-typed EvidencePlanService). */
  planReview?: {
    reviewForRun: (input: {
      planId: string;
      planVersion?: number;
      runId: string;
    }) => {
      reviewId: string;
      decision: string;
      report: unknown;
      reportArtifactId: string;
    };
  };
  /** N3: late-gap detection after analysis. */
  workflowFeedback?: {
    detectLatePricingGaps: (input: {
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
      evidenceItems: import("@maa/contracts").EvidenceItem[];
      outputArtifactId?: string | null;
      readiness?: import("@maa/contracts").ReadinessReport;
    }) => { workflowFeedbackId: string } | null;
  };
  /** N5: deterministic outcome reassessment. */
  outcomeReassess?: {
    reassessForRun: (input: {
      outcomeId: string;
      runId: string;
      experienceId?: string;
    }) => {
      reassessmentId: string;
      judgments: Array<{ findingId?: string; judgment: string; rationale: string }>;
      reportArtifactId: string;
    };
  };
}

const DEFAULT_SLEEP = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Durable fake workflow. M2 adds a real readiness gate at evaluating_evidence;
 * later phases remain simulated until M3 analysis lands.
 */
export async function runFakeWorkflow(
  deps: TransitionDeps & {
    runs: AnalysisRunsRepository;
    requests: AnalysisRequestsRepository;
    locks: ExecutionLocksRepository;
  },
  runId: string,
  options: FakeWorkflowOptions
): Promise<void> {
  const sleep = options.sleep ?? DEFAULT_SLEEP;
  const lockKey = `run:${runId}`;

  const phases: RunStatus[] = [
    "planning",
    "recalling_memory",
    "evaluating_evidence",
    "analyzing",
    "reviewing_output",
    "proposing_memory",
    "completed"
  ];

  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let readinessReport: ReadinessReport | undefined;
  let terminalOverride: RunStatus | undefined;
  let recalled:
    | {
        approved: import("@maa/contracts").MemoryPromptItem[];
        failureCorrections: import("@maa/contracts").MemoryPromptItem[];
        proceduralRules: import("@maa/contracts").ProceduralRulePromptItem[];
        assemblyId: string;
      }
    | undefined;

  try {
    heartbeatTimer = setInterval(() => {
      deps.locks.heartbeat(lockKey, options.ownerInstance, options.leaseMs);
      const now = new Date().toISOString();
      deps.runs.update({ runId, heartbeatAt: now, updatedAt: now });
    }, options.heartbeatMs);
    heartbeatTimer.unref?.();

    const initial = deps.runs.getById(runId);
    const initialReq = initial ? deps.requests.getById(initial.requestId) : undefined;
    if (initial && initialReq && options.experience) {
      const evidencePackageIds =
        options.analysis?.packages.listForRequest(initialReq.requestId).map((p) => p.packageId) ??
        [];
      options.experience.captureStarted({
        projectId: initialReq.projectId,
        requestId: initialReq.requestId,
        runId,
        attempt: initial.attemptNumber ?? 1,
        correlationId: initial.correlationId,
        operation: initialReq.operation,
        capabilityKey: initialReq.capabilityId ?? null,
        capabilityVersion: initialReq.capabilityVersion ?? null,
        evidencePackageIds
      });
    }

    const syncExperienceTerminal = (
      experienceStatus: "completed" | "failed" | "cancelled",
      summary?: string
    ): void => {
      if (!options.experience) return;
      const run = deps.runs.getById(runId);
      if (!run) return;
      options.experience.complete({
        runId,
        status: experienceStatus,
        contextAssemblyId: recalled?.assemblyId ?? null,
        outputArtifactId: run.outputArtifactId,
        tokenInput: run.tokenInput ?? 0,
        tokenOutput: run.tokenOutput ?? 0,
        costUsd: run.costUsd ?? 0,
        summary
      });
    };

    // N2: review_evidence_plan is a short deterministic workflow (no model / evidence readiness).
    if (
      initialReq?.operation === "review_evidence_plan" &&
      options.planReview &&
      initialReq.evidencePlanId
    ) {
      try {
        for (const phase of ["planning", "recalling_memory", "evaluating_evidence"] as const) {
          transitionRun(deps, {
            runId,
            toStatus: phase,
            phase,
            detail: { operation: "review_evidence_plan" },
            actorType: "system",
            actorId: "fake-workflow"
          });
          options.onPhase?.(runId, phase);
        }

        const result = options.planReview.reviewForRun({
          planId: initialReq.evidencePlanId,
          planVersion: initialReq.evidencePlanVersion ?? undefined,
          runId
        });

        options.experience?.recordDeterministicEvaluation?.({
          runId,
          decision: result.decision,
          sourceRecordId: result.reviewId,
          scores: {
            decision: result.decision,
            reportArtifactId: result.reportArtifactId,
            planId: initialReq.evidencePlanId
          }
        });

        deps.runs.update({
          runId,
          outputArtifactId: result.reportArtifactId,
          updatedAt: new Date().toISOString()
        });

        for (const phase of [
          "analyzing",
          "reviewing_output",
          "proposing_memory",
          "completed"
        ] as const) {
          transitionRun(deps, {
            runId,
            toStatus: phase,
            phase,
            detail: {
              operation: "review_evidence_plan",
              decision: result.decision,
              reviewId: result.reviewId
            },
            actorType: "system",
            actorId: "fake-workflow"
          });
          options.onPhase?.(runId, phase);
        }
        syncExperienceTerminal("completed", `plan_review:${result.decision}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code =
          err && typeof err === "object" && "code" in err
            ? String((err as { code: string }).code)
            : "INTERNAL_ERROR";
        transitionRun(deps, {
          runId,
          toStatus: "failed",
          phase: "failed",
          failureCode: code,
          failureMessage: message,
          detail: { reason: "plan_review_failed" },
          actorType: "system",
          actorId: "fake-workflow"
        });
        options.onPhase?.(runId, "failed");
        syncExperienceTerminal("failed", "plan_review_failed");
      }
      return;
    }

    // N5: reassess_with_outcome is a short deterministic workflow (no model / readiness).
    if (
      initialReq?.operation === "reassess_with_outcome" &&
      options.outcomeReassess &&
      initialReq.outcomeId
    ) {
      try {
        for (const phase of ["planning", "recalling_memory", "evaluating_evidence"] as const) {
          transitionRun(deps, {
            runId,
            toStatus: phase,
            phase,
            detail: { operation: "reassess_with_outcome" },
            actorType: "system",
            actorId: "fake-workflow"
          });
          options.onPhase?.(runId, phase);
        }

        const result = options.outcomeReassess.reassessForRun({
          outcomeId: initialReq.outcomeId,
          runId
        });

        deps.runs.update({
          runId,
          outputArtifactId: result.reportArtifactId,
          updatedAt: new Date().toISOString()
        });

        for (const phase of [
          "analyzing",
          "reviewing_output",
          "proposing_memory",
          "completed"
        ] as const) {
          transitionRun(deps, {
            runId,
            toStatus: phase,
            phase,
            detail: {
              operation: "reassess_with_outcome",
              reassessmentId: result.reassessmentId,
              primaryJudgment: result.judgments[0]?.judgment
            },
            actorType: "system",
            actorId: "fake-workflow"
          });
          options.onPhase?.(runId, phase);
        }
        syncExperienceTerminal(
          "completed",
          `outcome_reassess:${result.judgments[0]?.judgment ?? "done"}`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code =
          err && typeof err === "object" && "code" in err
            ? String((err as { code: string }).code)
            : "INTERNAL_ERROR";
        transitionRun(deps, {
          runId,
          toStatus: "failed",
          phase: "failed",
          failureCode: code,
          failureMessage: message,
          detail: { reason: "outcome_reassess_failed" },
          actorType: "system",
          actorId: "fake-workflow"
        });
        options.onPhase?.(runId, "failed");
        syncExperienceTerminal("failed", "outcome_reassess_failed");
      }
      return;
    }

    for (const phase of phases) {
      const current = deps.runs.getById(runId);
      if (!current) return;

      if (current.cancelRequestedAt) {
        transitionRun(deps, {
          runId,
          toStatus: "cancelled",
          phase: "cancelled",
          detail: { reason: "cancel_requested" },
          actorType: "system",
          actorId: "worker"
        });
        syncExperienceTerminal("cancelled", "cancel_requested");
        return;
      }

      if (current.timeoutAt && current.timeoutAt <= new Date().toISOString()) {
        transitionRun(deps, {
          runId,
          toStatus: "failed",
          phase: "failed",
          failureCode: "TIMEOUT",
          failureMessage: "Run exceeded configured timeout.",
          detail: { reason: "timeout" },
          actorType: "system",
          actorId: "worker"
        });
        syncExperienceTerminal("failed", "timeout");
        return;
      }

      if (isTerminalStatus(current.status as RunStatus)) {
        syncExperienceFromRunStatus(current.status as RunStatus, syncExperienceTerminal);
        return;
      }

      if (shouldSkipPhase(current.status as RunStatus, phase)) {
        continue;
      }

      // Skip remaining analysis phases when readiness already decided a terminal outcome.
      if (
        terminalOverride &&
        (phase === "analyzing" ||
          phase === "reviewing_output" ||
          phase === "proposing_memory" ||
          phase === "completed")
      ) {
        transitionRun(deps, {
          runId,
          toStatus: terminalOverride,
          phase: terminalOverride,
          detail: { readinessOverall: readinessReport?.overallStatus },
          actorType: "system",
          actorId: "fake-workflow"
        });
        options.onPhase?.(runId, terminalOverride);
        syncExperienceFromRunStatus(terminalOverride, syncExperienceTerminal);
        return;
      }

      // For partial readiness, finish as partial after proposing_memory.
      if (phase === "completed" && readinessReport && readinessReport.overallStatus === "partial") {
        transitionRun(deps, {
          runId,
          toStatus: "partial",
          phase: "partial",
          detail: {
            readyAreas: readinessReport.readyAreas,
            blockedAreas: readinessReport.blockedAreas
          },
          actorType: "system",
          actorId: "fake-workflow"
        });
        options.onPhase?.(runId, "partial");
        syncExperienceTerminal("completed", "partial_readiness");
        return;
      }

      transitionRun(deps, {
        runId,
        toStatus: phase,
        phase,
        detail: { simulated: phase !== "evaluating_evidence" },
        actorType: "system",
        actorId: "fake-workflow"
      });
      options.onPhase?.(runId, phase);

      if (phase === "recalling_memory" && options.memory) {
        recalled = executeMemoryRecall(deps, runId, options.memory);
      }

      if (phase === "evaluating_evidence" && options.readiness) {
        const result = evaluateAndPersistReadiness(deps, runId, options.readiness);
        readinessReport = result.report;

        options.experience?.recordDeterministicEvaluation?.({
          runId,
          decision: result.report.overallStatus,
          sourceRecordId: `readiness:${runId}`,
          scores: {
            overallStatus: result.report.overallStatus,
            readyAreas: result.report.readyAreas,
            blockedAreas: result.report.blockedAreas
          }
        });

        const request = deps.requests.getById(current.requestId);
        const readinessOnly = request?.operation === "evaluate_evidence_readiness";

        if (result.report.overallStatus === "insufficient") {
          terminalOverride = "evidence_insufficient";
        } else if (readinessOnly) {
          terminalOverride =
            result.report.overallStatus === "ready" ? "completed" : "partial";
        }
      }

      if (phase === "analyzing" && options.analysis && !terminalOverride) {
        try {
          await executeAnalysisPhase(
            deps,
            runId,
            readinessReport,
            options.analysis,
            recalled,
            options.workflowFeedback,
            options.experience
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const code =
            err && typeof err === "object" && "code" in err
              ? String((err as { code: string }).code)
              : "INTERNAL_ERROR";
          transitionRun(deps, {
            runId,
            toStatus: "failed",
            phase: "failed",
            failureCode: code,
            failureMessage: message,
            detail: { reason: "analysis_failed" },
            actorType: "system",
            actorId: "analysis-runner"
          });
          options.onPhase?.(runId, "failed");
          syncExperienceTerminal("failed", "analysis_failed");
          return;
        }
      }

      if (phase === "proposing_memory" && options.memory && !terminalOverride) {
        executeProposeMemory(deps, runId, options.memory);
      }

      if (phase === "completed" && !terminalOverride) {
        syncExperienceTerminal("completed");
      }

      if (phase !== "completed" && options.phaseDelayMs > 0) {
        await sleep(options.phaseDelayMs);
      }
    }
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    deps.locks.release(lockKey, options.ownerInstance);
    // Safety net: sync experience if run already terminal but experience still started.
    if (options.experience) {
      const finalRun = deps.runs.getById(runId);
      if (finalRun && isTerminalStatus(finalRun.status as RunStatus)) {
        const map =
          finalRun.status === "cancelled"
            ? "cancelled"
            : finalRun.status === "failed" || finalRun.status === "evidence_insufficient"
              ? "failed"
              : "completed";
        options.experience.complete({
          runId,
          status: map,
          contextAssemblyId: recalled?.assemblyId ?? null,
          outputArtifactId: finalRun.outputArtifactId,
          tokenInput: finalRun.tokenInput ?? 0,
          tokenOutput: finalRun.tokenOutput ?? 0,
          costUsd: finalRun.costUsd ?? 0,
          summary: finalRun.status
        });
      }
    }
  }
}

function syncExperienceFromRunStatus(
  status: RunStatus,
  sync: (experienceStatus: "completed" | "failed" | "cancelled", summary?: string) => void
): void {
  if (status === "cancelled") sync("cancelled", status);
  else if (status === "failed" || status === "evidence_insufficient") sync("failed", status);
  else if (
    status === "completed" ||
    status === "partial" ||
    status === "blocked" ||
    status === "needs_revision"
  ) {
    sync("completed", status);
  }
}

async function executeAnalysisPhase(
  deps: TransitionDeps & {
    runs: AnalysisRunsRepository;
    requests: AnalysisRequestsRepository;
  },
  runId: string,
  readinessReport: ReadinessReport | undefined,
  analysis: NonNullable<FakeWorkflowOptions["analysis"]>,
  recalled?: {
    approved: import("@maa/contracts").MemoryPromptItem[];
    failureCorrections: import("@maa/contracts").MemoryPromptItem[];
    proceduralRules?: import("@maa/contracts").ProceduralRulePromptItem[];
    assemblyId: string;
    externalKnowledgeSection?: string;
  },
  workflowFeedback?: FakeWorkflowOptions["workflowFeedback"],
  experience?: FakeWorkflowOptions["experience"]
): Promise<void> {
  const run = deps.runs.getById(runId)!;
  const request = deps.requests.getById(run.requestId)!;
  const project = analysis.projects.getById(request.projectId);
  const productContext = project
    ? (JSON.parse(project.productContextJson) as {
        name: string;
        description?: string;
        salesGoal: string;
        constraints: string[];
      })
    : { name: "unknown", salesGoal: "unknown", constraints: [] };

  const packageIds = analysis.packages.listForRequest(run.requestId).map((p) => p.packageId);
  let baselineIds: string[] = [];
  try {
    baselineIds = JSON.parse(request.baselineEvidencePackageIdsJson || "[]") as string[];
  } catch {
    baselineIds = [];
  }
  const compareIds = packageIds.filter((id) => !baselineIds.includes(id));
  const evidenceItems = analysis.evidence.getItemsForPackages(packageIds);
  const baselineEvidenceItems =
    baselineIds.length > 0
      ? analysis.evidence.getItemsForPackages(baselineIds)
      : undefined;
  const compareEvidenceItems =
    compareIds.length > 0
      ? analysis.evidence.getItemsForPackages(compareIds)
      : undefined;
  const requestedAreas = JSON.parse(request.requestedAnalysisJson) as AnalysisArea[];
  const fixtureKey =
    request.operation === "comparative_analysis"
      ? "analysis.v1.comparative"
      : analysis.fixtureKey;

  const result = await analysis.run(analysis.deps, {
    runId,
    requestId: run.requestId,
    correlationId: run.correlationId ?? undefined,
    operation: request.operation,
    productContext,
    requestedAreas,
    readiness: readinessReport,
    evidenceItems,
    baselineEvidenceItems,
    compareEvidenceItems,
    approvedMemory: recalled?.approved,
    failureCorrections: recalled?.failureCorrections,
    proceduralRules: recalled?.proceduralRules,
    externalKnowledgeSection: recalled?.externalKnowledgeSection,
    fixtureKey
  });

  const now = new Date().toISOString();
  deps.runs.update({
    runId,
    tokenInput: (run.tokenInput ?? 0) + result.tokenInput,
    tokenOutput: (run.tokenOutput ?? 0) + result.tokenOutput,
    costUsd: (run.costUsd ?? 0) + result.costUsd,
    outputArtifactId: result.outputArtifactId,
    qualityScore: result.quality.score,
    provider: analysis.deps.provider.providerId,
    model: analysis.deps.model,
    updatedAt: now
  });

  deps.events.insert({
    eventId: newId(IdPrefix.event),
    runId,
    requestId: run.requestId,
    correlationId: run.correlationId,
    eventType: "analysis_completed",
    phase: "analyzing",
    fromStatus: "analyzing",
    toStatus: "analyzing",
    detailJson: JSON.stringify({
      findingCount: result.output.findings.length,
      qualityPassed: result.quality.passed,
      qualityScore: result.quality.score,
      tokenInput: result.tokenInput,
      tokenOutput: result.tokenOutput,
      costUsd: result.costUsd
    }),
    createdAt: now
  });

  analysis.auditLog.append({
    actorType: "system",
    actorId: "analysis-runner",
    action: "run.analysis_completed",
    targetType: "analysis_run",
    targetId: runId,
    after: {
      findingCount: result.output.findings.length,
      qualityScore: result.quality.score
    },
    artifactRefs: [result.outputArtifactId],
    correlationId: run.correlationId ?? undefined,
    requestId: run.requestId,
    runId
  });

  analysis.agentLog.info(
    {
      eventType: "analysis_completed",
      runId,
      findingCount: result.output.findings.length,
      qualityScore: result.quality.score
    },
    "structured analysis completed"
  );

  if (workflowFeedback) {
    const feedback = workflowFeedback.detectLatePricingGaps({
      projectId: request.projectId,
      runId,
      requestId: run.requestId,
      correlationId: run.correlationId,
      externalWorkOrderId: request.externalWorkOrderId,
      operation: request.operation,
      capabilityVersion: request.capabilityVersion ?? "0.1.0",
      platform: project?.platform ?? "amazon",
      marketplace: project?.marketplace ?? "US",
      productType: project?.productType ?? "adult_coloring_book",
      requestedAreas,
      evidenceItems,
      outputArtifactId: result.outputArtifactId,
      readiness: readinessReport
    });
    if (feedback) {
      experience?.recordDeterministicEvaluation?.({
        runId,
        decision: "late_evidence_gap_detected",
        sourceRecordId: feedback.workflowFeedbackId,
        scores: { feedbackType: "late_evidence_gap" }
      });
      deps.events.insert({
        eventId: newId(IdPrefix.event),
        runId,
        requestId: run.requestId,
        correlationId: run.correlationId,
        eventType: "late_evidence_gap_detected",
        phase: "analyzing",
        fromStatus: "analyzing",
        toStatus: "analyzing",
        detailJson: JSON.stringify({
          workflowFeedbackId: feedback.workflowFeedbackId
        }),
        createdAt: new Date().toISOString()
      });
    }
  }

  if (run.priorRunId && analysis.onRevisionComplete) {
    analysis.onRevisionComplete(runId);
  }
}

function executeMemoryRecall(
  deps: TransitionDeps & {
    runs: AnalysisRunsRepository;
    requests: AnalysisRequestsRepository;
  },
  runId: string,
  memory: NonNullable<FakeWorkflowOptions["memory"]>
): {
  approved: import("@maa/contracts").MemoryPromptItem[];
  failureCorrections: import("@maa/contracts").MemoryPromptItem[];
  proceduralRules: import("@maa/contracts").ProceduralRulePromptItem[];
  assemblyId: string;
  externalKnowledgeSection?: string;
} {
  const run = deps.runs.getById(runId)!;
  const request = deps.requests.getById(run.requestId)!;
  const requestedAreas = JSON.parse(request.requestedAnalysisJson) as AnalysisArea[];
  const project = memory.projects?.getById(request.projectId);
  const queryParts = [
    request.question ?? "",
    ...requestedAreas,
    request.operation
  ].filter(Boolean);

  const proceduralRules =
    memory.resolveProceduralRules?.({
      projectId: request.projectId,
      platform: project?.platform,
      marketplace: project?.marketplace,
      category: project?.category,
      productType: project?.productType,
      analysisAreas: requestedAreas
    }) ?? [];

  const scope = {
    projectId: request.projectId,
    platform: project?.platform ?? (request.capabilityId?.includes("amazon") ? "amazon" : undefined),
    marketplace: project?.marketplace ?? "US",
    category: project?.category,
    productType: project?.productType,
    analysisAreas: requestedAreas
  };
  const query = queryParts.join(" ");

  const result = memory.recallAnalysisContext
    ? memory.recallAnalysisContext({
        runId,
        projectId: request.projectId,
        query,
        scope,
        requestedAreas,
        proceduralRules
      })
    : (() => {
        const recall = memory.service.recallForRun({
          runId,
          projectId: request.projectId,
          query,
          scope,
          requestedAreas,
          proceduralRules
        });
        return {
          approved: recall.approved,
          failureCorrections: recall.failureCorrections,
          proceduralRules,
          assemblyId: recall.assembly.assemblyId,
          externalKnowledgeSection: undefined
        };
      })();

  deps.events.insert({
    eventId: newId(IdPrefix.event),
    runId,
    requestId: run.requestId,
    correlationId: run.correlationId,
    eventType: "memory_recalled",
    phase: "recalling_memory",
    fromStatus: "recalling_memory",
    toStatus: "recalling_memory",
    detailJson: JSON.stringify({
      assemblyId: result.assemblyId,
      selectedCount: result.approved.length,
      externalKnowledgeIncluded: Boolean(result.externalKnowledgeSection),
      proceduralRuleCount: proceduralRules.length
    }),
    createdAt: new Date().toISOString()
  });

  memory.agentLog.info(
    {
      eventType: "memory_recalled",
      runId,
      selected: result.approved.length,
      proceduralRules: proceduralRules.length,
      externalKnowledgeIncluded: Boolean(result.externalKnowledgeSection)
    },
    "project memory recalled"
  );

  return {
    approved: result.approved,
    failureCorrections: result.failureCorrections,
    proceduralRules,
    assemblyId: result.assemblyId,
    externalKnowledgeSection: result.externalKnowledgeSection
  };
}

function executeProposeMemory(
  deps: TransitionDeps & {
    runs: AnalysisRunsRepository;
    requests: AnalysisRequestsRepository;
  },
  runId: string,
  memory: NonNullable<FakeWorkflowOptions["memory"]>
): void {
  const run = deps.runs.getById(runId)!;
  const request = deps.requests.getById(run.requestId)!;
  const findings = memory.findings.listByRun(runId);
  const ids = memory.saveWorking(
    {
      items: memory.items,
      scopes: memory.scopes,
      links: memory.links
    },
    {
      findings,
      projectId: request.projectId,
      runId,
      platform: request.capabilityId?.includes("amazon") ? "amazon" : undefined,
      marketplace: "US"
    }
  );

  const now = new Date().toISOString();
  deps.events.insert({
    eventId: newId(IdPrefix.event),
    runId,
    requestId: run.requestId,
    correlationId: run.correlationId,
    eventType: "memory_proposed",
    phase: "proposing_memory",
    fromStatus: "proposing_memory",
    toStatus: "proposing_memory",
    detailJson: JSON.stringify({ workingMemoryIds: ids }),
    createdAt: now
  });

  memory.auditLog.append({
    actorType: "system",
    actorId: "memory-service",
    action: "memory.working_saved",
    targetType: "analysis_run",
    targetId: runId,
    after: { count: ids.length },
    runId,
    requestId: run.requestId
  });

  memory.agentLog.info(
    { eventType: "memory_proposed", runId, count: ids.length },
    "project working memory auto-saved"
  );
}

function evaluateAndPersistReadiness(
  deps: TransitionDeps & { requests: AnalysisRequestsRepository },
  runId: string,
  readiness: NonNullable<FakeWorkflowOptions["readiness"]>
): { report: ReadinessReport; collections: CollectionRequest[] } {
  const run = deps.runs.getById(runId)!;
  const request = deps.requests.getById(run.requestId)!;
  const packageIds = readiness.packages.listForRequest(run.requestId).map((p) => p.packageId);

  // Fall back to request payload links if not yet linked (should be linked at create).
  const items = readiness.evidence.getItemsForPackages(packageIds);
  const requestedAnalysis = JSON.parse(request.requestedAnalysisJson) as AnalysisArea[];

  const reportBase = evaluateReadiness({
    items,
    requestedAreas: requestedAnalysis,
    packageIds,
    platform: request.capabilityId?.includes("amazon") ? "amazon" : "amazon",
    marketplace: "US",
    runId
  });
  const report = readiness.applyTypedProceduralRules
    ? readiness.applyTypedProceduralRules({
        report: reportBase,
        items,
        requestedAreas: requestedAnalysis
      })
    : reportBase;

  const artifactMeta = readiness.artifactStore.writeJson(report, {
    subdir: "readiness",
    accessClass: "internal"
  });
  readiness.artifacts.insert({
    artifactId: artifactMeta.artifactId,
    relativePath: artifactMeta.relativePath,
    contentHash: artifactMeta.contentHash,
    mimeType: artifactMeta.mimeType,
    sizeBytes: artifactMeta.sizeBytes,
    redactionStatus: artifactMeta.redactionStatus,
    accessClass: artifactMeta.accessClass,
    relatedRequestId: run.requestId,
    relatedRunId: runId,
    createdAt: artifactMeta.createdAt
  });

  readiness.readinessRepo.upsert({
    runId,
    reportJson: JSON.stringify(report),
    overallStatus: report.overallStatus,
    artifactId: artifactMeta.artifactId,
    evaluatedAt: report.evaluatedAt
  });

  const collections = buildCollectionRequests(
    report,
    { platform: "amazon", marketplace: "US" },
    { runId, requestId: run.requestId }
  );

  const now = new Date().toISOString();
  for (const creq of collections) {
    readiness.collectionRequests.insert({
      collectionRequestId: creq.collectionRequestId,
      runId: runId,
      requestId: run.requestId,
      requestType: creq.requestType,
      status: creq.status,
      priority: creq.priority,
      platform: creq.platform,
      marketplace: creq.marketplace,
      targetSetJson: JSON.stringify(creq.targetSet),
      requiredEvidenceJson: JSON.stringify(creq.requiredEvidence),
      reason: creq.reason,
      analysisAreasBlockedJson: JSON.stringify(creq.analysisAreasBlocked),
      completionRuleJson: JSON.stringify(creq.completionRule),
      suggestedCollectorCapability: creq.suggestedCollectorCapability ?? null,
      payloadJson: JSON.stringify(creq),
      createdAt: now,
      updatedAt: now
    });
  }

  deps.events.insert({
    eventId: newId(IdPrefix.event),
    runId,
    requestId: run.requestId,
    correlationId: run.correlationId,
    eventType: "readiness_evaluated",
    phase: "evaluating_evidence",
    fromStatus: "evaluating_evidence",
    toStatus: "evaluating_evidence",
    detailJson: JSON.stringify({
      overallStatus: report.overallStatus,
      readyAreas: report.readyAreas,
      blockedAreas: report.blockedAreas,
      collectionRequestCount: collections.length
    }),
    createdAt: now
  });

  readiness.auditLog.append({
    actorType: "system",
    actorId: "readiness-gate",
    action: "run.readiness_evaluated",
    targetType: "analysis_run",
    targetId: runId,
    after: {
      overallStatus: report.overallStatus,
      readyAreas: report.readyAreas,
      blockedAreas: report.blockedAreas
    },
    artifactRefs: [artifactMeta.artifactId],
    correlationId: run.correlationId ?? undefined,
    requestId: run.requestId,
    runId
  });

  readiness.agentLog.info(
    {
      eventType: "readiness_evaluated",
      runId,
      overallStatus: report.overallStatus,
      readyAreas: report.readyAreas,
      blockedAreas: report.blockedAreas
    },
    "evidence readiness evaluated"
  );

  return { report, collections };
}

function shouldSkipPhase(current: RunStatus, candidate: RunStatus): boolean {
  void isActiveStatus;
  const order: RunStatus[] = [
    "accepted",
    "planning",
    "recalling_memory",
    "evaluating_evidence",
    "analyzing",
    "reviewing_output",
    "proposing_memory",
    "completed"
  ];
  const curIdx = order.indexOf(current);
  const candIdx = order.indexOf(candidate);
  if (curIdx < 0 || candIdx < 0) return false;
  return curIdx >= candIdx && current !== "accepted";
}

export function newExecutionId(): string {
  return newId(IdPrefix.execution);
}
