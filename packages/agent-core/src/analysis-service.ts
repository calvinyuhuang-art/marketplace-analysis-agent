import { createHash } from "node:crypto";
import type { AuditLog } from "@maa/audit";
import {
  AppError,
  IdPrefix,
  newId,
  type AnalysisRequestResponse,
  type AnalysisRunResponse,
  type CapabilitySummary,
  type CreateAnalysisRequest,
  type CreateProject,
  type ProductContext,
  type ProjectResponse,
  type RunStatus
} from "@maa/contracts";
import type {
  AnalysisRequestsRepository,
  AnalysisRunsRepository,
  EvidencePackagesRepository,
  ExecutionLocksRepository,
  IdempotencyRepository,
  ProjectsRepository,
  RunEventsRepository,
  SqliteDatabase
} from "@maa/database";
import type { Logger } from "@maa/logging";
import { isTerminalStatus } from "./state-machine";
import { transitionRun } from "./transition";

export interface AnalysisServiceDeps {
  db: SqliteDatabase;
  projects: ProjectsRepository;
  requests: AnalysisRequestsRepository;
  runs: AnalysisRunsRepository;
  events: RunEventsRepository;
  locks: ExecutionLocksRepository;
  idempotency: IdempotencyRepository;
  evidencePackages: EvidencePackagesRepository;
  /** Validates that referenced evidence packages exist before accepting a run. */
  assertEvidencePackagesExist: (packageIds: string[]) => void;
  auditLog: AuditLog;
  agentLog: Logger;
  capabilities: CapabilitySummary[];
  defaultModelProfileId: string;
  defaultTimeoutSeconds: number;
}

function hashPayload(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function toProjectResponse(row: {
  projectId: string;
  externalProjectId: string | null;
  name: string;
  platform: string;
  marketplace: string;
  category: string;
  productType: string;
  productContextJson: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}): ProjectResponse {
  return {
    projectId: row.projectId,
    externalProjectId: row.externalProjectId,
    name: row.name,
    platform: row.platform,
    marketplace: row.marketplace,
    category: row.category,
    productType: row.productType,
    productContext: JSON.parse(row.productContextJson) as ProductContext,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function toRunResponse(
  run: {
    runId: string;
    requestId: string;
    attemptNumber: number;
    status: string;
    currentPhase: string | null;
    executionId: string | null;
    correlationId: string | null;
    provider: string | null;
    model: string | null;
    startedAt: string | null;
    heartbeatAt: string | null;
    completedAt: string | null;
    timeoutAt: string | null;
    cancelRequestedAt: string | null;
    failureCode: string | null;
    failureMessage: string | null;
    tokenInput: number;
    tokenOutput: number;
    costUsd: number;
    priorRunId?: string | null;
    affectedAreasJson?: string | null;
    createdAt: string;
    updatedAt: string;
  },
  projectId: string
): AnalysisRunResponse {
  return {
    runId: run.runId,
    requestId: run.requestId,
    projectId,
    status: run.status as RunStatus,
    currentPhase: run.currentPhase,
    attemptNumber: run.attemptNumber,
    priorRunId: run.priorRunId ?? null,
    affectedAreas: run.affectedAreasJson
      ? (JSON.parse(run.affectedAreasJson) as AnalysisRunResponse["affectedAreas"])
      : null,
    executionId: run.executionId,
    correlationId: run.correlationId,
    provider: run.provider,
    model: run.model,
    startedAt: run.startedAt,
    heartbeatAt: run.heartbeatAt,
    completedAt: run.completedAt,
    timeoutAt: run.timeoutAt,
    cancelRequestedAt: run.cancelRequestedAt,
    failureCode: run.failureCode,
    failureMessage: run.failureMessage,
    tokenInput: run.tokenInput,
    tokenOutput: run.tokenOutput,
    costUsd: run.costUsd,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt
  };
}

export class AnalysisService {
  constructor(private readonly deps: AnalysisServiceDeps) {}

  resolveCapability(capability: CreateAnalysisRequest["capability"]): CapabilitySummary {
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
        message:
          "The requested operation is outside the supported marketplace-analysis capabilities.",
        details: [
          {
            path: "capability",
            message: `No capability pack for ${capability.platform}/${capability.marketplace}/${capability.category}/${capability.productType}`
          }
        ]
      });
    }
    if (capability.requestedVersion && capability.requestedVersion !== match.version) {
      throw new AppError({
        code: "UNSUPPORTED_CAPABILITY",
        message: `Requested capability version ${capability.requestedVersion} is not available (current: ${match.version}).`
      });
    }
    return match;
  }

  assertOperationAllowed(capability: CapabilitySummary, operation: string): void {
    if (!capability.supportedOperations.includes(operation as never)) {
      throw new AppError({
        code: "UNSUPPORTED_OPERATION",
        message: `Operation '${operation}' is not supported by capability '${capability.id}'.`
      });
    }
  }

  assertAnalysisAreasAllowed(capability: CapabilitySummary, areas: string[]): void {
    for (const area of areas) {
      if (!capability.supportedAnalysisAreas.includes(area as never)) {
        throw new AppError({
          code: "UNSUPPORTED_ANALYSIS_AREA",
          message: `Analysis area '${area}' is not supported by capability '${capability.id}'.`,
          details: [{ path: "requestedAnalysis", message: area }]
        });
      }
    }
  }

  /**
   * Comparative / multi-package guard: reject before any model call when a
   * package's capability coordinates do not match the request capability.
   */
  assertPackagesMatchCapability(
    packageIds: string[],
    capability: CreateAnalysisRequest["capability"]
  ): void {
    for (const packageId of packageIds) {
      const pkg = this.deps.evidencePackages.getById(packageId);
      if (!pkg) {
        throw new AppError({
          code: "EVIDENCE_PACKAGE_NOT_FOUND",
          message: `Evidence package '${packageId}' was not found.`
        });
      }
      if (
        pkg.platform !== capability.platform ||
        pkg.marketplace !== capability.marketplace ||
        pkg.category !== capability.category ||
        pkg.productType !== capability.productType
      ) {
        throw new AppError({
          code: "UNSUPPORTED_CAPABILITY",
          message:
            "Comparative analysis packages must match the request capability coordinates.",
          details: [
            {
              path: "evidencePackageIds",
              message: `Package '${packageId}' is ${pkg.platform}/${pkg.marketplace}/${pkg.category}/${pkg.productType}; request is ${capability.platform}/${capability.marketplace}/${capability.category}/${capability.productType}`
            }
          ]
        });
      }
    }
  }

  createProject(input: CreateProject): ProjectResponse {
    const capability = this.resolveCapability(input.capability);
    const now = new Date().toISOString();
    const projectId = input.projectId ?? newId(IdPrefix.project);

    const existing = this.deps.projects.getById(projectId);
    if (existing) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        message: `Project '${projectId}' already exists.`,
        details: [{ path: "projectId", message: "already exists" }]
      });
    }

    this.deps.projects.insert({
      projectId,
      externalProjectId: input.externalProjectId ?? null,
      name: input.name,
      platform: capability.platform,
      marketplace: capability.marketplace,
      category: capability.category,
      productType: capability.productType,
      productContextJson: JSON.stringify(input.productContext),
      status: "active",
      createdAt: now,
      updatedAt: now
    });

    this.deps.auditLog.append({
      actorType: "client",
      actorId: "api",
      action: "project.created",
      targetType: "analysis_project",
      targetId: projectId,
      after: { name: input.name, capabilityId: capability.id }
    });

    return toProjectResponse(this.deps.projects.getById(projectId)!);
  }

  getProject(projectId: string): ProjectResponse {
    const row = this.deps.projects.getById(projectId);
    if (!row) {
      throw new AppError({ code: "NOT_FOUND", message: `Project '${projectId}' not found.` });
    }
    return toProjectResponse(row);
  }

  listProjects(): ProjectResponse[] {
    return this.deps.projects.list().map(toProjectResponse);
  }

  /**
   * Resolve an existing project or create one from the analysis request's
   * projectId + product/capability context. Product details always come from
   * the upstream request — never from hardcoded defaults.
   */
  resolveOrCreateProject(input: CreateAnalysisRequest): ProjectResponse {
    const existing = this.deps.projects.getById(input.projectId);
    if (existing) {
      // Keep product context current for this project from upstream.
      this.deps.projects.updateProductContext(
        input.projectId,
        JSON.stringify(input.productContext),
        new Date().toISOString()
      );
      return toProjectResponse(this.deps.projects.getById(input.projectId)!);
    }
    return this.createProject({
      projectId: input.projectId,
      name: input.productContext.name,
      capability: input.capability,
      productContext: input.productContext
    });
  }

  createAnalysisRequest(
    input: CreateAnalysisRequest,
    opts: { correlationId: string; idempotencyKey?: string }
  ): AnalysisRequestResponse & { reused: boolean } {
    // Guardrails BEFORE any model interaction (M1 has no model calls in the
    // happy path either — fake workflow only).
    const capability = this.resolveCapability(input.capability);
    this.assertOperationAllowed(capability, input.operation);
    this.assertAnalysisAreasAllowed(capability, input.requestedAnalysis);
    if (
      input.operation !== "review_evidence_plan" &&
      input.operation !== "reassess_with_outcome"
    ) {
      this.deps.assertEvidencePackagesExist(input.evidencePackageIds);
      if (input.operation === "comparative_analysis") {
        if ((input.baselineEvidencePackageIds?.length ?? 0) < 1) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            message: "baselineEvidencePackageIds is required for comparative_analysis."
          });
        }
        this.deps.assertEvidencePackagesExist(input.baselineEvidencePackageIds!);
        this.assertPackagesMatchCapability(
          [...input.evidencePackageIds, ...input.baselineEvidencePackageIds!],
          input.capability
        );
      }
    } else if (input.operation === "review_evidence_plan" && !input.evidencePlanId) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        message: "evidencePlanId is required for review_evidence_plan."
      });
    } else if (input.operation === "reassess_with_outcome" && !input.outcomeId) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        message: "outcomeId is required for reassess_with_outcome."
      });
    }

    const idempotencyKey = opts.idempotencyKey ?? input.idempotencyKey;
    const requestHash = hashPayload({
      ...input,
      idempotencyKey: undefined
    });

    if (idempotencyKey) {
      const existingRecord = this.deps.idempotency.get(input.client, idempotencyKey);
      if (existingRecord?.requestId) {
        if (existingRecord.requestHash && existingRecord.requestHash !== requestHash) {
          throw new AppError({
            code: "IDEMPOTENCY_CONFLICT",
            message:
              "Idempotency key was reused with a different request payload."
          });
        }
        const existingReq = this.deps.requests.getById(existingRecord.requestId);
        const existingRun = existingRecord.runId
          ? this.deps.runs.getById(existingRecord.runId)
          : this.deps.runs.getLatestByRequestId(existingRecord.requestId);
        if (existingReq && existingRun) {
          return {
            ...this.toRequestResponse(existingReq, existingRun, opts.correlationId),
            reused: true
          };
        }
      }
    }

    const project = this.resolveOrCreateProject(input);
    const now = new Date().toISOString();
    const requestId = newId(IdPrefix.request);
    const runId = newId(IdPrefix.run);
    const timeoutSeconds = input.timeoutSeconds ?? this.deps.defaultTimeoutSeconds;
    const timeoutAt = new Date(Date.now() + timeoutSeconds * 1000).toISOString();
    const modelProfileId = input.modelProfileId ?? this.deps.defaultModelProfileId;

    const createTx = this.deps.db.transaction(() => {
      this.deps.requests.insert({
        requestId,
        projectId: project.projectId,
        client: input.client,
        clientRequestId: input.clientRequestId ?? null,
        externalWorkOrderId: input.externalWorkOrderId ?? null,
        operation: input.operation,
        requestedAnalysisJson: JSON.stringify(input.requestedAnalysis),
        question: input.question ?? null,
        capabilityId: capability.id,
        capabilityVersion: capability.version,
        modelProfileId,
        requestPayloadArtifactId: null,
        idempotencyKey: idempotencyKey ?? null,
        requestHash,
        status: "accepted",
        evidencePlanId: input.evidencePlanId ?? null,
        evidencePlanVersion: input.evidencePlanVersion ?? null,
        outcomeId: input.outcomeId ?? null,
        baselineEvidencePackageIdsJson: JSON.stringify(
          input.baselineEvidencePackageIds ?? []
        ),
        createdAt: now,
        updatedAt: now
      });

      this.deps.runs.insert({
        runId,
        requestId,
        attemptNumber: 1,
        status: "accepted",
        currentPhase: "accepted",
        executionId: null,
        correlationId: opts.correlationId,
        provider: "fake",
        model: "fake-structured",
        promptVersion: null,
        capabilityVersion: capability.version,
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
        priorRunId: null,
        revisionOfRequestId: null,
        affectedAreasJson: null,
        createdAt: now,
        updatedAt: now
      });

      this.deps.events.insert({
        eventId: newId(IdPrefix.event),
        runId,
        requestId,
        correlationId: opts.correlationId,
        eventType: "request_accepted",
        phase: "accepted",
        fromStatus: null,
        toStatus: "accepted",
        detailJson: JSON.stringify({
          operation: input.operation,
          capabilityId: capability.id,
          evidencePackageIds: input.evidencePackageIds,
          baselineEvidencePackageIds: input.baselineEvidencePackageIds ?? []
        }),
        createdAt: now
      });

      if (idempotencyKey) {
        this.deps.idempotency.insert({
          idempotencyKey,
          client: input.client,
          requestId,
          runId,
          requestHash,
          createdAt: now
        });
      }

      const linked = new Set([
        ...input.evidencePackageIds,
        ...(input.baselineEvidencePackageIds ?? [])
      ]);
      for (const packageId of linked) {
        this.deps.evidencePackages.linkToRequest(requestId, packageId, now);
      }
    });

    try {
      createTx();
    } catch (err) {
      // Race on idempotency unique index — retry as reuse.
      if (idempotencyKey) {
        const raced = this.deps.idempotency.get(input.client, idempotencyKey);
        if (raced?.requestId) {
          const existingReq = this.deps.requests.getById(raced.requestId);
          const existingRun = raced.runId
            ? this.deps.runs.getById(raced.runId)
            : this.deps.runs.getLatestByRequestId(raced.requestId);
          if (existingReq && existingRun) {
            return {
              ...this.toRequestResponse(existingReq, existingRun, opts.correlationId),
              reused: true
            };
          }
        }
      }
      throw err;
    }

    this.deps.auditLog.append({
      actorType: "client",
      actorId: input.client,
      action: "analysis_request.accepted",
      targetType: "analysis_request",
      targetId: requestId,
      after: { runId, operation: input.operation, capabilityId: capability.id },
      correlationId: opts.correlationId,
      requestId,
      runId
    });

    this.deps.agentLog.info(
      {
        eventType: "analysis_request_accepted",
        requestId,
        runId,
        projectId: project.projectId,
        operation: input.operation,
        correlationId: opts.correlationId
      },
      "analysis request accepted"
    );

    const req = this.deps.requests.getById(requestId)!;
    const run = this.deps.runs.getById(runId)!;
    return { ...this.toRequestResponse(req, run, opts.correlationId), reused: false };
  }

  getRequest(requestId: string): AnalysisRequestResponse {
    const req = this.deps.requests.getById(requestId);
    if (!req) {
      throw new AppError({ code: "NOT_FOUND", message: `Request '${requestId}' not found.` });
    }
    const run = this.deps.runs.getLatestByRequestId(requestId);
    if (!run) {
      throw new AppError({ code: "NOT_FOUND", message: `No run for request '${requestId}'.` });
    }
    return this.toRequestResponse(req, run, run.correlationId ?? "");
  }

  getRun(runId: string): AnalysisRunResponse {
    const run = this.deps.runs.getById(runId);
    if (!run) {
      throw new AppError({ code: "NOT_FOUND", message: `Run '${runId}' not found.` });
    }
    const req = this.deps.requests.getById(run.requestId);
    return toRunResponse(run, req?.projectId ?? "unknown");
  }

  listRunsForProject(projectId: string): AnalysisRunResponse[] {
    if (!this.deps.projects.getById(projectId)) {
      throw new AppError({ code: "NOT_FOUND", message: `Project '${projectId}' not found.` });
    }
    return this.deps.runs.listByProject(projectId).map((r) => toRunResponse(r, projectId));
  }

  listRecentRuns(limit = 50): AnalysisRunResponse[] {
    return this.deps.runs.listRecent(limit).map((r) => {
      const req = this.deps.requests.getById(r.requestId);
      return toRunResponse(r, req?.projectId ?? "unknown");
    });
  }

  cancelRun(runId: string, actor: { type: "operator" | "client"; id: string }) {
    const run = this.deps.runs.getById(runId);
    if (!run) {
      throw new AppError({ code: "NOT_FOUND", message: `Run '${runId}' not found.` });
    }
    if (isTerminalStatus(run.status as RunStatus)) {
      throw new AppError({
        code: "RUN_NOT_CANCELLABLE",
        message: `Run '${runId}' is already terminal (${run.status}).`
      });
    }

    const now = new Date().toISOString();
    this.deps.runs.update({
      runId,
      cancelRequestedAt: now,
      updatedAt: now
    });

    this.deps.events.insert({
      eventId: newId(IdPrefix.event),
      runId,
      requestId: run.requestId,
      correlationId: run.correlationId,
      eventType: "cancel_requested",
      phase: run.currentPhase,
      fromStatus: run.status,
      toStatus: run.status,
      detailJson: JSON.stringify({ actor }),
      createdAt: now
    });

    this.deps.auditLog.append({
      actorType: actor.type,
      actorId: actor.id,
      action: "run.cancel_requested",
      targetType: "analysis_run",
      targetId: runId,
      correlationId: run.correlationId ?? undefined,
      requestId: run.requestId,
      runId
    });

    // If still queued (accepted, not claimed), cancel immediately.
    if (run.status === "accepted") {
      const lock = this.deps.locks.get(`run:${runId}`);
      if (!lock || lock.status !== "held") {
        transitionRun(
          {
            runs: this.deps.runs,
            requests: this.deps.requests,
            events: this.deps.events,
            auditLog: this.deps.auditLog,
            agentLog: this.deps.agentLog
          },
          {
            runId,
            toStatus: "cancelled",
            phase: "cancelled",
            detail: { reason: "cancelled_before_start" },
            actorType: actor.type === "operator" ? "operator" : "client",
            actorId: actor.id
          }
        );
      }
    }

    const updated = this.deps.runs.getById(runId)!;
    return {
      runId,
      status: updated.status as RunStatus,
      cancelRequestedAt: updated.cancelRequestedAt ?? now,
      message:
        updated.status === "cancelled"
          ? "Run cancelled."
          : "Cancellation requested; worker will stop at the next checkpoint."
    };
  }

  listEvents(runId: string) {
    if (!this.deps.runs.getById(runId)) {
      throw new AppError({ code: "NOT_FOUND", message: `Run '${runId}' not found.` });
    }
    return this.deps.events.listByRun(runId).map((e) => ({
      eventId: e.eventId,
      runId: e.runId,
      requestId: e.requestId,
      correlationId: e.correlationId,
      eventType: e.eventType,
      phase: e.phase,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      detail: e.detailJson ? (JSON.parse(e.detailJson) as unknown) : null,
      createdAt: e.createdAt
    }));
  }

  private toRequestResponse(
    req: {
      requestId: string;
      projectId: string;
      operation: string;
      status: string;
      createdAt: string;
    },
    run: {
      runId: string;
      status: string;
      currentPhase: string | null;
      correlationId: string | null;
    },
    correlationId: string
  ): AnalysisRequestResponse {
    return {
      requestId: req.requestId,
      runId: run.runId,
      projectId: req.projectId,
      status: run.status as RunStatus,
      currentPhase: run.currentPhase,
      operation: req.operation as AnalysisRequestResponse["operation"],
      correlationId: run.correlationId ?? correlationId,
      statusUrl: `/v1/analysis-runs/${run.runId}`,
      createdAt: req.createdAt
    };
  }
}
