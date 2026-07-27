import { describe, expect, it } from "vitest";
import { AppError } from "@maa/contracts";
import { assertTransition, canTransition, isTerminalStatus } from "./state-machine";

describe("run state machine", () => {
  it("allows the happy-path sequence", () => {
    expect(canTransition("accepted", "planning")).toBe(true);
    expect(canTransition("planning", "recalling_memory")).toBe(true);
    expect(canTransition("recalling_memory", "evaluating_evidence")).toBe(true);
    expect(canTransition("evaluating_evidence", "analyzing")).toBe(true);
    expect(canTransition("analyzing", "reviewing_output")).toBe(true);
    expect(canTransition("reviewing_output", "proposing_memory")).toBe(true);
    expect(canTransition("proposing_memory", "completed")).toBe(true);
  });

  it("allows abort from any active state", () => {
    expect(canTransition("analyzing", "cancelled")).toBe(true);
    expect(canTransition("planning", "failed")).toBe(true);
    expect(canTransition("evaluating_evidence", "needs_revision")).toBe(true);
  });

  it("rejects transitions out of terminal states", () => {
    expect(canTransition("completed", "planning")).toBe(false);
    expect(canTransition("cancelled", "analyzing")).toBe(false);
    expect(isTerminalStatus("failed")).toBe(true);
  });

  it("rejects invalid jumps and throws AppError", () => {
    expect(canTransition("accepted", "completed")).toBe(false);
    expect(() => assertTransition("accepted", "completed")).toThrow(AppError);
  });

  it("allows readiness branches from evaluating_evidence", () => {
    expect(canTransition("evaluating_evidence", "awaiting_evidence")).toBe(true);
    expect(canTransition("evaluating_evidence", "evidence_insufficient")).toBe(true);
  });
});
