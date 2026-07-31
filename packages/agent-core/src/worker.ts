import type {
  AnalysisRunsRepository,
  ExecutionLocksRepository
} from "@maa/database";
import type { Logger } from "@maa/logging";
import type { RunStatus } from "@maa/contracts";
import { isActiveStatus } from "./state-machine";
import {
  newExecutionId,
  runFakeWorkflow,
  type FakeWorkflowOptions
} from "./fake-workflow";
import { transitionRun, type TransitionDeps } from "./transition";

export interface WorkerOptions {
  ownerInstance: string;
  pollMs: number;
  heartbeatMs: number;
  leaseMs: number;
  staleExecutionMs: number;
  phaseDelayMs: number;
  sleep?: (ms: number) => Promise<void>;
  onPhase?: (runId: string, status: RunStatus) => void;
  readiness?: FakeWorkflowOptions["readiness"];
  analysis?: FakeWorkflowOptions["analysis"];
  memory?: FakeWorkflowOptions["memory"];
  experience?: FakeWorkflowOptions["experience"];
  planReview?: FakeWorkflowOptions["planReview"];
  workflowFeedback?: FakeWorkflowOptions["workflowFeedback"];
  outcomeReassess?: FakeWorkflowOptions["outcomeReassess"];
}

/**
 * In-process durable worker. Claims queued/active runs via execution locks,
 * recovers stale leases on startup/poll, and drives the fake workflow
 * (with M2 readiness evaluation when configured).
 */
export class DurableWorker {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private busy = false;

  constructor(
    private readonly deps: TransitionDeps & {
      runs: AnalysisRunsRepository;
      locks: ExecutionLocksRepository;
      agentLog: Logger;
    },
    private readonly options: WorkerOptions
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.deps.agentLog.info(
      { eventType: "worker_started", ownerInstance: this.options.ownerInstance },
      "durable worker started"
    );
    this.recoverStale();
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.deps.agentLog.info(
      { eventType: "worker_stopped", ownerInstance: this.options.ownerInstance },
      "durable worker stopped"
    );
  }

  /** Exposed for tests: process one poll cycle immediately. */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      this.recoverStale();
      await this.claimAndExecute();
    } finally {
      this.busy = false;
    }
  }

  private schedule(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      void this.tick().finally(() => this.schedule());
    }, this.options.pollMs);
    this.timer.unref?.();
  }

  recoverStale(): void {
    const now = Date.now();
    const active = this.deps.runs.listActive();
    for (const run of active) {
      const lockKey = `run:${run.runId}`;
      const lock = this.deps.locks.get(lockKey);
      const leaseExpired =
        !lock ||
        lock.status !== "held" ||
        !lock.leaseExpiresAt ||
        Date.parse(lock.leaseExpiresAt) <= now;

      if (!leaseExpired) continue;

      const heartbeatAge = run.heartbeatAt ? now - Date.parse(run.heartbeatAt) : Infinity;
      const startedAge = run.startedAt ? now - Date.parse(run.startedAt) : Infinity;
      const isStale =
        heartbeatAge >= this.options.staleExecutionMs ||
        (run.heartbeatAt === null && startedAge >= this.options.staleExecutionMs) ||
        (run.status === "accepted" && !lock);

      if (!isStale && run.status !== "accepted") continue;

      this.deps.agentLog.warn(
        {
          eventType: "stale_execution_recovered",
          runId: run.runId,
          status: run.status,
          lockStatus: lock?.status ?? "missing"
        },
        "stale execution marked for reclaim"
      );

      if (lock && lock.status === "held" && leaseExpired) {
        this.deps.locks.release(lockKey, lock.ownerInstance ?? "");
      }
    }
  }

  private async claimAndExecute(): Promise<void> {
    const candidates = this.deps.runs.listActive();
    for (const run of candidates) {
      if (!isActiveStatus(run.status as RunStatus)) continue;

      const lockKey = `run:${run.runId}`;
      const existing = this.deps.locks.get(lockKey);
      const now = Date.now();
      if (
        existing &&
        existing.status === "held" &&
        existing.leaseExpiresAt &&
        Date.parse(existing.leaseExpiresAt) > now &&
        existing.ownerInstance !== this.options.ownerInstance
      ) {
        continue;
      }

      const executionId = newExecutionId();
      const claimed = this.deps.locks.tryClaim({
        lockKey,
        runId: run.runId,
        executionId,
        ownerInstance: this.options.ownerInstance,
        leaseMs: this.options.leaseMs
      });
      if (!claimed) continue;

      const startedAt = run.startedAt ?? new Date().toISOString();
      this.deps.runs.update({
        runId: run.runId,
        executionId,
        startedAt,
        heartbeatAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      this.deps.agentLog.info(
        {
          eventType: "execution_claimed",
          runId: run.runId,
          executionId,
          ownerInstance: this.options.ownerInstance
        },
        "execution claimed"
      );

      const wfOptions: FakeWorkflowOptions = {
        phaseDelayMs: this.options.phaseDelayMs,
        heartbeatMs: this.options.heartbeatMs,
        leaseMs: this.options.leaseMs,
        ownerInstance: this.options.ownerInstance,
        onPhase: this.options.onPhase,
        sleep: this.options.sleep,
        readiness: this.options.readiness,
        analysis: this.options.analysis,
        memory: this.options.memory,
        experience: this.options.experience,
        planReview: this.options.planReview,
        workflowFeedback: this.options.workflowFeedback,
        outcomeReassess: this.options.outcomeReassess
      };

      try {
        await runFakeWorkflow(this.deps, run.runId, wfOptions);
      } catch (err) {
        this.deps.agentLog.error(
          {
            eventType: "execution_failed",
            runId: run.runId,
            err
          },
          "fake workflow failed"
        );
        try {
          transitionRun(this.deps, {
            runId: run.runId,
            toStatus: "failed",
            phase: "failed",
            failureCode: "INTERNAL_ERROR",
            failureMessage: err instanceof Error ? err.message : String(err),
            actorType: "system",
            actorId: "worker"
          });
        } catch {
          // ignore
        }
        this.deps.locks.release(lockKey, this.options.ownerInstance);
      }

      return;
    }
  }
}
