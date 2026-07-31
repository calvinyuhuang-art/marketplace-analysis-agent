import {
  WORKFLOW_FEEDBACK_AGENT_IDS,
  WORKFLOW_FEEDBACK_PAYLOAD_SCHEMA_VERSION,
  WORKFLOW_FEEDBACK_PRODUCER_CONTRACTS,
  buildWorkflowFeedbackCreatedIdempotencyKey,
  buildWorkflowFeedbackResolutionEvaluatedIdempotencyKey,
  type WorkflowFeedbackCreatedPayloadV1,
  type WorkflowFeedbackResolutionEvaluatedPayloadV1
} from "@learning-plane/contracts";

export type MaaWorkflowFeedbackSnapshot = {
  workflowFeedbackId: string;
  projectId: string;
  runId: string;
  requestId: string;
  experienceId: string | null;
  externalWorkOrderId: string | null;
  correlationId: string | null;
  feedbackType: string;
  gapFingerprintId: string;
  collectionRequestIds: string[];
  status: string;
  missingRequirement: {
    analysisArea?: string;
    reasons?: string[];
    [key: string]: unknown;
  };
  resolutionAction: string | null;
  resolutionQuality: "full" | "partial" | "ineffective" | null;
  revisionRunId: string | null;
  detectedAt: string;
  resolvedAt: string | null;
};

/** Stable correlation for the full MAA ↔ RO learning conversation. */
export function workflowFeedbackCorrelationId(
  feedback: Pick<MaaWorkflowFeedbackSnapshot, "workflowFeedbackId" | "correlationId">
): string {
  if (feedback.correlationId && feedback.correlationId.trim()) {
    return feedback.correlationId.trim();
  }
  return `maa:wf:${feedback.workflowFeedbackId}`;
}

/**
 * Canonical MAA operational resolution identity.
 * One durable resolution per workflow-feedback record once resolve() has set resolutionAction.
 * Frozen at evaluated-event capture; never rewritten on causation release.
 */
export function canonicalMaaResolutionId(workflowFeedbackId: string): string {
  return `maa:resolution:${workflowFeedbackId}`;
}

export function mapCreatedPayload(
  feedback: MaaWorkflowFeedbackSnapshot
): WorkflowFeedbackCreatedPayloadV1 {
  const area =
    typeof feedback.missingRequirement.analysisArea === "string"
      ? feedback.missingRequirement.analysisArea
      : "pricing";
  const reasons = Array.isArray(feedback.missingRequirement.reasons)
    ? feedback.missingRequirement.reasons.map(String)
    : [];
  const summary = [
    `Late evidence gap (${feedback.feedbackType}) on ${area}.`,
    ...reasons.slice(0, 5)
  ]
    .join(" ")
    .slice(0, 2000);

  return {
    payloadSchemaVersion: WORKFLOW_FEEDBACK_PAYLOAD_SCHEMA_VERSION,
    maaWorkflowFeedbackId: feedback.workflowFeedbackId,
    maaProjectId: feedback.projectId,
    maaRunId: feedback.runId,
    ...(feedback.externalWorkOrderId
      ? { workOrderId: feedback.externalWorkOrderId }
      : {}),
    ...(feedback.experienceId ? { sourceExperienceId: feedback.experienceId } : {}),
    gapFingerprintId: feedback.gapFingerprintId,
    feedbackCategory: "late_evidence_gap",
    affectedAnalysisAreas: [area],
    severity: "blocking",
    status: feedback.status as WorkflowFeedbackCreatedPayloadV1["status"],
    summary,
    collectionRequestIds: feedback.collectionRequestIds.slice(0, 20),
    operationalFeedbackRef: {
      owningService: WORKFLOW_FEEDBACK_AGENT_IDS.marketplaceAnalysisAgent,
      resourceType: "workflow_feedback",
      resourceId: feedback.workflowFeedbackId,
      relativePath: `/v1/workflow-feedback/${feedback.workflowFeedbackId}`,
      producerContractVersion: `${WORKFLOW_FEEDBACK_PRODUCER_CONTRACTS.maaWorkflowFeedback.name}.${WORKFLOW_FEEDBACK_PRODUCER_CONTRACTS.maaWorkflowFeedback.version}`
    },
    producerContract: {
      name: WORKFLOW_FEEDBACK_PRODUCER_CONTRACTS.maaWorkflowFeedback.name,
      version: WORKFLOW_FEEDBACK_PRODUCER_CONTRACTS.maaWorkflowFeedback.version
    },
    createdAt: feedback.detectedAt
  };
}

export function mapEvaluatedPayload(input: {
  feedback: MaaWorkflowFeedbackSnapshot;
  resolutionId: string;
  evaluationId: string;
  effectiveness: "full" | "partial" | "ineffective";
  summary: string;
}): WorkflowFeedbackResolutionEvaluatedPayloadV1 {
  return {
    payloadSchemaVersion: WORKFLOW_FEEDBACK_PAYLOAD_SCHEMA_VERSION,
    maaWorkflowFeedbackId: input.feedback.workflowFeedbackId,
    resolutionId: input.resolutionId,
    evaluationId: input.evaluationId,
    effectiveness: input.effectiveness,
    revisedAnalysisRunId: input.feedback.revisionRunId,
    ...(input.feedback.experienceId
      ? { sourceExperienceId: input.feedback.experienceId }
      : {}),
    summary: input.summary.slice(0, 2000),
    evaluatedAt: input.feedback.resolvedAt ?? new Date().toISOString(),
    producerContract: {
      name: WORKFLOW_FEEDBACK_PRODUCER_CONTRACTS.maaWorkflowFeedback.name,
      version: WORKFLOW_FEEDBACK_PRODUCER_CONTRACTS.maaWorkflowFeedback.version
    }
  };
}

export function createdIdempotencyKey(workflowFeedbackId: string): string {
  return buildWorkflowFeedbackCreatedIdempotencyKey(workflowFeedbackId);
}

export function evaluatedIdempotencyKey(
  workflowFeedbackId: string,
  resolutionId: string,
  evaluationId: string
): string {
  return buildWorkflowFeedbackResolutionEvaluatedIdempotencyKey(
    workflowFeedbackId,
    resolutionId,
    evaluationId
  );
}

export const RESEARCH_ORCHESTRATOR_AGENT_ID =
  WORKFLOW_FEEDBACK_AGENT_IDS.researchOrchestrator;

export const MAA_AGENT_ID = WORKFLOW_FEEDBACK_AGENT_IDS.marketplaceAnalysisAgent;
