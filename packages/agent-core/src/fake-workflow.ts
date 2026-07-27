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
    /** Optional M6 procedural rule resolver for context assembly. */
    resolveProceduralRules?: (input: {
      projectId: string;
      platform?: string;
      marketplace?: string;
      category?: string;
      productType?: string;
      analysisAreas: AnalysisArea[];
    }) => import("@maa/contracts").ProceduralRulePromptItem[];
    projects?: import("@maa/database").ProjectsRepository;
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
        return;
      }

      if (isTerminalStatus(current.status as RunStatus)) {
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
          await executeAnalysisPhase(deps, runId, readinessReport, options.analysis, recalled);
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
          return;
        }
      }

      if (phase === "proposing_memory" && options.memory && !terminalOverride) {
        executeProposeMemory(deps, runId, options.memory);
      }

      if (phase !== "completed" && options.phaseDelayMs > 0) {
        await sleep(options.phaseDelayMs);
      }
    }
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    deps.locks.release(lockKey, options.ownerInstance);
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
  }
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
  const evidenceItems = analysis.evidence.getItemsForPackages(packageIds);
  const requestedAreas = JSON.parse(request.requestedAnalysisJson) as AnalysisArea[];

  const result = await analysis.run(analysis.deps, {
    runId,
    requestId: run.requestId,
    correlationId: run.correlationId ?? undefined,
    operation: request.operation,
    productContext,
    requestedAreas,
    readiness: readinessReport,
    evidenceItems,
    approvedMemory: recalled?.approved,
    failureCorrections: recalled?.failureCorrections,
    proceduralRules: recalled?.proceduralRules,
    fixtureKey: analysis.fixtureKey
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

  const result = memory.service.recallForRun({
    runId,
    projectId: request.projectId,
    query: queryParts.join(" "),
    scope: {
      projectId: request.projectId,
      platform: project?.platform ?? (request.capabilityId?.includes("amazon") ? "amazon" : undefined),
      marketplace: project?.marketplace ?? "US",
      category: project?.category,
      productType: project?.productType,
      analysisAreas: requestedAreas
    },
    requestedAreas,
    proceduralRules
  });

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
      assemblyId: result.assembly.assemblyId,
      selectedCount: result.assembly.selectedMemoryIds.length,
      omittedCount: result.assembly.omitted.length,
      proceduralRuleCount: proceduralRules.length
    }),
    createdAt: new Date().toISOString()
  });

  memory.agentLog.info(
    {
      eventType: "memory_recalled",
      runId,
      selected: result.assembly.selectedMemoryIds.length,
      proceduralRules: proceduralRules.length
    },
    "project memory recalled"
  );

  return {
    approved: result.approved,
    failureCorrections: result.failureCorrections,
    proceduralRules,
    assemblyId: result.assembly.assemblyId
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

  const report = evaluateReadiness({
    items,
    requestedAreas: requestedAnalysis,
    packageIds,
    platform: request.capabilityId?.includes("amazon") ? "amazon" : "amazon",
    marketplace: "US",
    runId
  });

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
