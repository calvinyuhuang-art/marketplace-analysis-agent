import {
  WORKFLOW_FEEDBACK_PAYLOAD_SCHEMA_VERSION
} from "@learning-plane/contracts";
import type { LearningPlaneAdapterRepository } from "./adapterRepository.js";
import type { LearningPlaneAdapterConfig } from "./config.js";
import {
  RESEARCH_ORCHESTRATOR_AGENT_ID,
  canonicalMaaResolutionId,
  createdIdempotencyKey,
  evaluatedIdempotencyKey,
  mapCreatedPayload,
  mapEvaluatedPayload,
  workflowFeedbackCorrelationId,
  type MaaWorkflowFeedbackSnapshot
} from "./workflowFeedbackMapping.js";

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

function parseMissingRequirement(raw: string): MaaWorkflowFeedbackSnapshot["missingRequirement"] {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return value ?? {};
  } catch {
    return {};
  }
}

export function toFeedbackSnapshot(row: {
  workflowFeedbackId: string;
  projectId: string;
  runId: string;
  requestId: string;
  experienceId: string | null;
  externalWorkOrderId?: string | null;
  correlationId?: string | null;
  feedbackType?: string;
  gapFingerprintId: string;
  collectionRequestIdsJson: string;
  status: string;
  missingRequirementJson: string;
  resolutionAction: string | null;
  resolutionQuality: string | null;
  revisionRunId: string | null;
  detectedAt: string;
  resolvedAt: string | null;
}): MaaWorkflowFeedbackSnapshot {
  return {
    workflowFeedbackId: row.workflowFeedbackId,
    projectId: row.projectId,
    runId: row.runId,
    requestId: row.requestId,
    experienceId: row.experienceId,
    externalWorkOrderId: row.externalWorkOrderId ?? null,
    correlationId: row.correlationId ?? null,
    feedbackType: row.feedbackType ?? "late_evidence_gap",
    gapFingerprintId: row.gapFingerprintId,
    collectionRequestIds: parseJsonArray(row.collectionRequestIdsJson),
    status: row.status,
    missingRequirement: parseMissingRequirement(row.missingRequirementJson),
    resolutionAction: row.resolutionAction,
    resolutionQuality:
      row.resolutionQuality === "full" ||
      row.resolutionQuality === "partial" ||
      row.resolutionQuality === "ineffective"
        ? row.resolutionQuality
        : null,
    revisionRunId: row.revisionRunId,
    detectedAt: row.detectedAt,
    resolvedAt: row.resolvedAt
  };
}

export class WorkflowFeedbackLearningPlaneCapture {
  constructor(
    private readonly deps: {
      config: LearningPlaneAdapterConfig;
      repo: LearningPlaneAdapterRepository;
    }
  ) {}

  /** Must be called inside the same SQLite transaction as the canonical insert. */
  captureCreated(row: Parameters<typeof toFeedbackSnapshot>[0]): string | null {
    const { config, repo } = this.deps;
    if (!config.enabled || !config.publishEnabled || !repo.tablesPresent()) return null;

    const feedback = toFeedbackSnapshot(row);
    const payload = mapCreatedPayload(feedback);
    const correlationId = workflowFeedbackCorrelationId(feedback);
    const result = repo.insertOutbox({
      sourceRecordType: "workflow_feedback",
      sourceRecordId: feedback.workflowFeedbackId,
      sourceRecordVersion: "created:v1",
      workflowFeedbackId: feedback.workflowFeedbackId,
      eventType: "workflow_feedback.created",
      payloadSchemaVersion: WORKFLOW_FEEDBACK_PAYLOAD_SCHEMA_VERSION,
      targetAgentId: RESEARCH_ORCHESTRATOR_AGENT_ID,
      workOrderId: feedback.externalWorkOrderId,
      correlationId,
      sourceExperienceId: feedback.experienceId,
      idempotencyKey: createdIdempotencyKey(feedback.workflowFeedbackId),
      payload,
      status: "pending"
    });
    if (result.created) {
      repo.recordProcessingEvent({
        eventKind: "learning_plane.workflow_feedback_created_captured",
        relatedOutboxId: result.outboxId,
        correlationId,
        detail: {
          workflowFeedbackId: feedback.workflowFeedbackId,
          idempotencyKey: createdIdempotencyKey(feedback.workflowFeedbackId)
        }
      });
    }
    return result.outboxId;
  }

  /**
   * Must be called inside the same SQLite transaction as the canonical evaluation update.
   * Freezes resolutionId / evaluationId / idempotencyKey / payload at capture time.
   * Waiting-for-causation only leaves causationEventId null.
   */
  captureEvaluated(row: Parameters<typeof toFeedbackSnapshot>[0]): string | null {
    const { config, repo } = this.deps;
    if (!config.enabled || !config.publishEnabled || !repo.tablesPresent()) return null;

    const feedback = toFeedbackSnapshot(row);
    if (!feedback.resolutionQuality) return null;

    if (!feedback.resolutionAction) {
      repo.recordProcessingEvent({
        eventKind: "learning_plane.evaluated.capture_gap",
        correlationId: workflowFeedbackCorrelationId(feedback),
        detail: {
          reason: "missing_canonical_resolution_action",
          workflowFeedbackId: feedback.workflowFeedbackId
        }
      });
      return null;
    }

    if (!feedback.revisionRunId) {
      repo.recordProcessingEvent({
        eventKind: "learning_plane.evaluated.capture_gap",
        correlationId: workflowFeedbackCorrelationId(feedback),
        detail: {
          reason: "missing_evaluation_id",
          workflowFeedbackId: feedback.workflowFeedbackId
        }
      });
      return null;
    }

    const resolutionId = canonicalMaaResolutionId(feedback.workflowFeedbackId);
    const evaluationId = feedback.revisionRunId;
    const correlationId = workflowFeedbackCorrelationId(feedback);
    const idempotencyKey = evaluatedIdempotencyKey(
      feedback.workflowFeedbackId,
      resolutionId,
      evaluationId
    );
    const payload = mapEvaluatedPayload({
      feedback,
      resolutionId,
      evaluationId,
      effectiveness: feedback.resolutionQuality,
      summary: `Resolution effectiveness ${feedback.resolutionQuality} for ${feedback.workflowFeedbackId}.`
    });

    const submitted = repo.findReconciledSubmitted(
      feedback.workflowFeedbackId,
      resolutionId
    );
    const causationEventId =
      submitted?.event_id &&
      submitted.correlation_id === correlationId &&
      submitted.resolution_id === resolutionId
        ? submitted.event_id
        : null;
    const waiting = !causationEventId;

    const result = repo.insertOutbox({
      sourceRecordType: "workflow_feedback_evaluation",
      sourceRecordId: evaluationId,
      sourceRecordVersion: "evaluated:v1",
      workflowFeedbackId: feedback.workflowFeedbackId,
      resolutionId,
      evaluationId,
      eventType: "workflow_feedback.resolution_evaluated",
      payloadSchemaVersion: WORKFLOW_FEEDBACK_PAYLOAD_SCHEMA_VERSION,
      targetAgentId: RESEARCH_ORCHESTRATOR_AGENT_ID,
      workOrderId: feedback.externalWorkOrderId,
      correlationId,
      causationEventId,
      sourceExperienceId: feedback.experienceId,
      idempotencyKey,
      payload,
      status: waiting ? "waiting_for_causation" : "pending"
    });

    if (result.created) {
      repo.recordProcessingEvent({
        eventKind: "learning_plane.evaluated.capture_identity_frozen",
        relatedOutboxId: result.outboxId,
        correlationId,
        detail: {
          workflowFeedbackId: feedback.workflowFeedbackId,
          resolutionId,
          evaluationId,
          idempotencyKey,
          payloadSha256: repo.getOutbox(result.outboxId)?.payload_sha256 ?? null,
          causationEventId,
          waitingForCausation: waiting,
          effectiveness: feedback.resolutionQuality
        }
      });
      repo.recordProcessingEvent({
        eventKind: waiting
          ? "learning_plane.workflow_feedback_evaluated_waiting_for_causation"
          : "learning_plane.workflow_feedback_evaluated_captured",
        relatedOutboxId: result.outboxId,
        correlationId,
        detail: {
          workflowFeedbackId: feedback.workflowFeedbackId,
          resolutionId,
          evaluationId,
          causationEventId
        }
      });
    }
    return result.outboxId;
  }
}
