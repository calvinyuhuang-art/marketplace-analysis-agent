import { describe, expect, it } from "vitest";
import {
  AgentExperienceSchema,
  CaptureExperienceInputSchema,
  CollectorCapabilitySnapshotSchema,
  RecordEvaluationInputSchema,
  evaluationIdempotencyKey,
  formatGapFingerprintKey,
  WorkflowFeedbackEventSchema
} from "./index.js";

describe("agent-memory-contracts", () => {
  it("parses capture experience input", () => {
    const parsed = CaptureExperienceInputSchema.parse({
      projectId: "proj_1",
      requestId: "req_1",
      runId: "run_1",
      operation: "full_marketplace_analysis"
    });
    expect(parsed.attempt).toBe(1);
  });

  it("rejects invalid experience status via full schema", () => {
    expect(() =>
      AgentExperienceSchema.parse({
        experienceId: "exp_1",
        projectId: "p",
        requestId: "r",
        runId: "run",
        attempt: 1,
        operation: "full_marketplace_analysis",
        status: "queued",
        startedAt: "2026-07-28T00:00:00.000Z",
        createdAt: "2026-07-28T00:00:00.000Z",
        updatedAt: "2026-07-28T00:00:00.000Z"
      })
    ).toThrow();
  });

  it("stable evaluation idempotency key", () => {
    const a = evaluationIdempotencyKey({
      experienceId: "exp_1",
      evaluatorType: "human",
      rubricVersion: "v1",
      sourceSystem: "maa.finding_reviews",
      sourceRecordId: "rev_1"
    });
    const b = evaluationIdempotencyKey({
      experienceId: "exp_1",
      evaluatorType: "human",
      rubricVersion: "v1",
      sourceSystem: "maa.finding_reviews",
      sourceRecordId: "rev_1"
    });
    expect(a).toBe(b);
    expect(a).toContain("maa.finding_reviews");
  });

  it("requires sourceSystem on evaluations", () => {
    expect(() =>
      RecordEvaluationInputSchema.parse({
        experienceId: "exp_1",
        evaluatorType: "human",
        decision: "reject",
        sourceRecordId: "x"
      })
    ).toThrow();
  });

  it("formats gap fingerprint stably", () => {
    const key = formatGapFingerprintKey({
      platform: "amazon",
      marketplace: "US",
      productType: "adult_coloring_book",
      capabilityVersion: "1.0.0",
      operation: "full_marketplace_analysis",
      analysisArea: "pricing",
      upstreamStep: "evaluate_evidence_readiness",
      missingEvidenceType: "format_normalization",
      collectorCapabilityKey: "mcec@1.0.0"
    });
    expect(key.startsWith("gap_v1:")).toBe(true);
    expect(key).toContain("pricing");
  });

  it("parses collector snapshot and workflow feedback contracts", () => {
    CollectorCapabilitySnapshotSchema.parse({
      schemaVersion: "maa.collector_capability_snapshot.v1",
      collector: "mcec",
      collectorVersion: "1.0.0",
      capturedAt: "2026-07-28T00:00:00.000Z",
      supportedEvidenceTypes: ["listing"],
      supportedFields: { listing: ["price", "binding", "format"] }
    });
    WorkflowFeedbackEventSchema.parse({
      schemaVersion: "maa.workflow_feedback.v1",
      workflowFeedbackId: "wf_1",
      status: "detected",
      projectId: "proj_1",
      sourceAgentId: "research_orchestrator",
      discoveringAgentId: "marketplace_analysis_agent",
      upstreamStepKey: "evaluate_evidence_readiness",
      downstreamStepKey: "pricing_analysis",
      feedbackType: "late_evidence_gap",
      gapFingerprint: "gap_v1:x",
      gapFingerprintVersion: "v1",
      missingRequirement: { fields: ["format"] },
      createdAt: "2026-07-28T00:00:00.000Z"
    });
  });
});
