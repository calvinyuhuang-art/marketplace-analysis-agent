import { IdPrefix, newId, type RunStatus } from "@maa/contracts";
import type { AuditLog } from "@maa/audit";
import type {
  AnalysisRequestsRepository,
  AnalysisRunsRepository,
  RunEventsRepository
} from "@maa/database";
import type { Logger } from "@maa/logging";
import { assertTransition, isTerminalStatus } from "./state-machine";

export interface TransitionDeps {
  runs: AnalysisRunsRepository;
  requests: AnalysisRequestsRepository;
  events: RunEventsRepository;
  auditLog: AuditLog;
  agentLog: Logger;
}

export interface TransitionInput {
  runId: string;
  toStatus: RunStatus;
  phase?: string | null;
  detail?: Record<string, unknown>;
  actorType?: "system" | "operator" | "client";
  actorId?: string;
  failureCode?: string | null;
  failureMessage?: string | null;
}

/**
 * Persist a validated status transition, emit a run event, and append an audit
 * record. Returns the updated run row status.
 */
export function transitionRun(deps: TransitionDeps, input: TransitionInput): RunStatus {
  const run = deps.runs.getById(input.runId);
  if (!run) {
    throw new Error(`Run not found: ${input.runId}`);
  }

  const fromStatus = run.status as RunStatus;
  assertTransition(fromStatus, input.toStatus);

  if (fromStatus === input.toStatus && (input.phase ?? null) === run.currentPhase) {
    return fromStatus;
  }

  const now = new Date().toISOString();
  const terminal = isTerminalStatus(input.toStatus);

  deps.runs.update({
    runId: run.runId,
    status: input.toStatus,
    currentPhase: input.phase ?? input.toStatus,
    completedAt: terminal ? now : run.completedAt,
    failureCode: input.failureCode ?? run.failureCode,
    failureMessage: input.failureMessage ?? run.failureMessage,
    updatedAt: now
  });

  deps.requests.updateStatus(run.requestId, input.toStatus, now);

  const eventId = newId(IdPrefix.event);
  deps.events.insert({
    eventId,
    runId: run.runId,
    requestId: run.requestId,
    correlationId: run.correlationId,
    eventType: "status_transition",
    phase: input.phase ?? input.toStatus,
    fromStatus,
    toStatus: input.toStatus,
    detailJson: input.detail ? JSON.stringify(input.detail) : null,
    createdAt: now
  });

  deps.auditLog.append({
    actorType: input.actorType ?? "system",
    actorId: input.actorId ?? "agent-core",
    action: "run.status_transition",
    targetType: "analysis_run",
    targetId: run.runId,
    before: { status: fromStatus, phase: run.currentPhase },
    after: { status: input.toStatus, phase: input.phase ?? input.toStatus },
    correlationId: run.correlationId ?? undefined,
    requestId: run.requestId,
    runId: run.runId
  });

  deps.agentLog.info(
    {
      eventType: "run_status_transition",
      runId: run.runId,
      requestId: run.requestId,
      correlationId: run.correlationId,
      fromStatus,
      toStatus: input.toStatus,
      phase: input.phase ?? input.toStatus
    },
    "run status transition"
  );

  return input.toStatus;
}
