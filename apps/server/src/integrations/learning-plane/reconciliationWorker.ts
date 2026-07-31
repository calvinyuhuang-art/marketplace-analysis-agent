import type { WorkflowFeedbackRepository } from "@maa/database";
import type { Logger } from "@maa/logging";
import type { LearningPlaneAdapterRepository } from "./adapterRepository.js";
import type { LearningPlaneAdapterConfig } from "./config.js";

const MAX_AWAITING_AGE_MS = 24 * 60 * 60 * 1000;

export class LearningPlaneReconciliationWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly deps: {
      config: LearningPlaneAdapterConfig;
      repo: LearningPlaneAdapterRepository;
      feedback: WorkflowFeedbackRepository;
      logger: Logger;
      intervalMs?: number;
      enabled?: () => boolean;
    }
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.deps.intervalMs ?? 1_000);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    while (this.running) {
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  async tick(): Promise<void> {
    if (this.running) return;
    if (this.deps.enabled && !this.deps.enabled()) return;
    const { config, repo } = this.deps;
    if (!config.enabled || !repo.tablesPresent()) return;

    this.running = true;
    try {
      this.reconcileAwaitingInbox();
      this.releaseWaitingEvaluated();
    } finally {
      this.running = false;
    }
  }

  reconcileInboxRecord(inboxId: string): void {
    const { repo, feedback } = this.deps;
    const inbox = repo.getInbox(inboxId);
    if (!inbox) return;
    if (
      inbox.processing_status !== "received" &&
      inbox.processing_status !== "awaiting_local_reconciliation"
    ) {
      return;
    }
    if (!inbox.workflow_feedback_id || !inbox.resolution_id) {
      repo.updateInboxProcessing(inboxId, "permanent_failure", {
        errorCode: "MISSING_IDENTITIES",
        errorMessage: "Submitted event missing workflow/resolution identities."
      });
      return;
    }

    const local = feedback.getById(inbox.workflow_feedback_id);
    if (!local) {
      repo.updateInboxProcessing(inboxId, "awaiting_local_reconciliation", {
        errorCode: "FEEDBACK_NOT_FOUND",
        errorMessage: "Canonical workflow feedback not found yet."
      });
      repo.recordProcessingEvent({
        eventKind: "learning_plane.resolution_submitted_waiting_for_local_record",
        relatedInboxId: inboxId,
        correlationId: inbox.correlation_id,
        detail: { workflowFeedbackId: inbox.workflow_feedback_id }
      });
      return;
    }

    if (!local.resolutionAction) {
      const ageMs = Date.now() - Date.parse(inbox.received_at);
      if (Number.isFinite(ageMs) && ageMs > MAX_AWAITING_AGE_MS) {
        repo.updateInboxProcessing(inboxId, "permanent_failure", {
          errorCode: "LOCAL_RESOLUTION_TIMEOUT",
          errorMessage: "Canonical resolution never appeared."
        });
        return;
      }
      repo.updateInboxProcessing(inboxId, "awaiting_local_reconciliation", {
        errorCode: "RESOLUTION_NOT_YET_LOCAL",
        errorMessage: "Canonical resolution action not recorded yet."
      });
      repo.recordProcessingEvent({
        eventKind: "learning_plane.resolution_submitted_waiting_for_local_record",
        relatedInboxId: inboxId,
        correlationId: inbox.correlation_id,
        detail: { workflowFeedbackId: inbox.workflow_feedback_id }
      });
      return;
    }

    if (
      inbox.resolution_type &&
      local.resolutionAction &&
      inbox.resolution_type !== local.resolutionAction
    ) {
      // Allow known aliases that map losslessly between RT/MAA vocabularies.
      const aliases: Record<string, string> = {
        supplemental_collection: "supplemental_collection",
        human_evidence: "human_evidence",
        manual_evidence: "human_evidence",
        narrow_scope: "narrow_scope",
        narrow_analysis_scope: "narrow_scope",
        accept_bounded: "accept_bounded",
        accept_limitation: "accept_bounded",
        stop: "stop"
      };
      const normalizedEvent = aliases[inbox.resolution_type] ?? inbox.resolution_type;
      const normalizedLocal = aliases[local.resolutionAction] ?? local.resolutionAction;
      if (normalizedEvent !== normalizedLocal) {
        repo.updateInboxProcessing(inboxId, "semantic_conflict", {
          errorCode: "RESOLUTION_TYPE_MISMATCH",
          errorMessage: `Event resolutionType=${inbox.resolution_type} local=${local.resolutionAction}`,
          localResolutionRef: local.workflowFeedbackId
        });
        repo.recordProcessingEvent({
          eventKind: "learning_plane.resolution_submitted_semantic_conflict",
          relatedInboxId: inboxId,
          correlationId: inbox.correlation_id,
          detail: {
            eventResolutionType: inbox.resolution_type,
            localResolutionAction: local.resolutionAction
          }
        });
        return;
      }
    }

    repo.updateInboxProcessing(inboxId, "reconciled", {
      localResolutionRef: `workflow_feedback:${local.workflowFeedbackId}`,
      errorCode: null,
      errorMessage: null
    });
    repo.recordProcessingEvent({
      eventKind: "learning_plane.resolution_submitted_reconciled",
      relatedInboxId: inboxId,
      correlationId: inbox.correlation_id,
      detail: {
        workflowFeedbackId: inbox.workflow_feedback_id,
        resolutionId: inbox.resolution_id,
        learningPlaneEventId: inbox.event_id
      }
    });

    if (inbox.resolution_id && inbox.event_id && inbox.correlation_id) {
      const release = this.deps.repo.releaseWaitingEvaluated({
        workflowFeedbackId: inbox.workflow_feedback_id,
        resolutionId: inbox.resolution_id,
        causationEventId: inbox.event_id,
        correlationId: inbox.correlation_id,
        parentEventType: inbox.event_type
      });
      if (release.released > 0) {
        this.deps.repo.recordProcessingEvent({
          eventKind: "learning_plane.workflow_feedback_evaluated_captured",
          relatedInboxId: inboxId,
          correlationId: inbox.correlation_id,
          detail: {
            releasedWaitingEvaluated: release.released,
            causationEventId: inbox.event_id
          }
        });
      }
    }
  }

  private reconcileAwaitingInbox(): void {
    const rows = this.deps.repo.listInboxByProcessingStatus(
      ["received", "awaiting_local_reconciliation"],
      50
    );
    for (const row of rows) {
      this.reconcileInboxRecord(row.inbox_id);
    }
  }

  private releaseWaitingEvaluated(): void {
    // Waiting evaluated rows are released when matching submitted inbox reconciles.
    const waiting = this.deps.repo.listOutboxByStatus(["waiting_for_causation"], 50);
    for (const row of waiting) {
      if (!row.workflow_feedback_id || !row.resolution_id || !row.correlation_id) continue;
      const submitted = this.deps.repo.findReconciledSubmitted(
        row.workflow_feedback_id,
        row.resolution_id
      );
      if (!submitted?.event_id || !submitted.correlation_id) continue;
      if (
        submitted.source_agent_id !== "research-orchestrator" ||
        submitted.target_agent_id !== "marketplace-analysis-agent"
      ) {
        this.deps.repo.recordProcessingEvent({
          eventKind: "learning_plane.evaluated.causation_mismatch",
          relatedOutboxId: row.outbox_id,
          correlationId: row.correlation_id,
          detail: {
            reason: "invalid_parent_direction",
            sourceAgentId: submitted.source_agent_id,
            targetAgentId: submitted.target_agent_id
          }
        });
        continue;
      }
      this.deps.repo.releaseWaitingEvaluated({
        workflowFeedbackId: row.workflow_feedback_id,
        resolutionId: row.resolution_id,
        causationEventId: submitted.event_id,
        correlationId: submitted.correlation_id,
        parentEventType: submitted.event_type
      });
    }
  }
}
