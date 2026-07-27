import { AppError, type RunStatus } from "@maa/contracts";

/**
 * Allowed run status transitions. Terminal states have no outgoing edges.
 * Any active (non-terminal) state may move to needs_revision | cancelled | failed.
 */
const TERMINAL: ReadonlySet<RunStatus> = new Set([
  "completed",
  "partial",
  "evidence_insufficient",
  "cancelled",
  "failed"
]);

const HAPPY_PATH: ReadonlyArray<RunStatus> = [
  "accepted",
  "planning",
  "recalling_memory",
  "evaluating_evidence",
  "analyzing",
  "reviewing_output",
  "proposing_memory",
  "completed"
];

/** Branches from evaluating_evidence that the planner/readiness gate may take. */
const FROM_EVALUATING: ReadonlySet<RunStatus> = new Set([
  "awaiting_evidence",
  "analyzing",
  "evidence_insufficient"
]);

const FROM_AWAITING: ReadonlySet<RunStatus> = new Set([
  "analyzing",
  "cancelled",
  "failed",
  "needs_revision"
]);

const ACTIVE_ABORT: ReadonlySet<RunStatus> = new Set([
  "needs_revision",
  "cancelled",
  "failed"
]);

export function isTerminalStatus(status: RunStatus): boolean {
  return TERMINAL.has(status);
}

export function isActiveStatus(status: RunStatus): boolean {
  return !TERMINAL.has(status);
}

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  if (from === to) return true;
  if (TERMINAL.has(from)) return false;

  if (ACTIVE_ABORT.has(to)) return true;

  const happyIndex = HAPPY_PATH.indexOf(from);
  const nextHappy = happyIndex >= 0 ? HAPPY_PATH[happyIndex + 1] : undefined;
  if (nextHappy && to === nextHappy) return true;

  if (from === "evaluating_evidence" && FROM_EVALUATING.has(to)) return true;
  if (from === "awaiting_evidence" && FROM_AWAITING.has(to)) return true;
  if (from === "proposing_memory" && (to === "partial" || to === "evidence_insufficient")) {
    return true;
  }
  if (
    (from === "reviewing_output" || from === "analyzing") &&
    (to === "partial" || to === "evidence_insufficient")
  ) {
    return true;
  }

  return false;
}

export function assertTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransition(from, to)) {
    throw new AppError({
      code: "INVALID_STATE_TRANSITION",
      message: `Invalid run status transition: ${from} -> ${to}`
    });
  }
}

/** Fake M1 workflow phase sequence (happy path). */
export const FAKE_WORKFLOW_PHASES: ReadonlyArray<RunStatus> = [
  "planning",
  "recalling_memory",
  "evaluating_evidence",
  "analyzing",
  "reviewing_output",
  "proposing_memory",
  "completed"
];
