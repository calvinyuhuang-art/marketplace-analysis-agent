import { LearningPlaneClientError } from "@learning-plane/client";
import type { Logger } from "@maa/logging";
import type { LearningPlaneAdapterConfig } from "./config.js";
import { createAgentClient } from "./clientFactory.js";
import type { LearningPlaneSecretStore } from "./secretStore.js";
import type { GovernanceReplayBridgeRepository } from "./governanceReplayBridgeRepository.js";
import type { LearningPlaneAdapterRepository } from "./adapterRepository.js";

const MAX_ATTEMPTS = 12;

function classifyPublishError(error: unknown): {
  retryable: boolean;
  code: string;
  message: string;
} {
  if (error instanceof LearningPlaneClientError) {
    const status = error.status ?? 0;
    const message = error.message.slice(0, 500);
    if (
      error.code === "NETWORK" ||
      error.code === "TIMEOUT" ||
      error.code === "ABORTED" ||
      status === 408 ||
      status === 425 ||
      status === 429 ||
      (status >= 500 && status <= 599)
    ) {
      return { retryable: true, code: error.code, message };
    }
    if (error.code === "CONFLICT" || status === 409) {
      return { retryable: false, code: "IDEMPOTENCY_CONFLICT", message };
    }
    return { retryable: false, code: error.code, message };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { retryable: true, code: "UNKNOWN", message: message.slice(0, 500) };
}

export class GovernanceBridgeOutboxWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly deps: {
      config: LearningPlaneAdapterConfig;
      bridge: GovernanceReplayBridgeRepository;
      adapterRepo: LearningPlaneAdapterRepository;
      secrets: LearningPlaneSecretStore;
      logger: Logger;
      intervalMs?: number;
      enabled?: () => boolean;
    }
  ) {}

  start(): void {
    if (this.timer) return;
    const interval = this.deps.intervalMs ?? 750;
    this.timer = setInterval(() => {
      void this.tick();
    }, interval);
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
    const { config, secrets } = this.deps;
    if (!config.enabled || !config.governanceBridgeEnabled) return;
    if (!secrets.exists()) return;

    this.running = true;
    try {
      const rows = this.deps.bridge.claimPendingOutbox(10);
      for (const row of rows) {
        await this.publishRow(row);
      }
    } finally {
      this.running = false;
    }
  }

  async publishRow(row: Record<string, unknown>): Promise<void> {
    const { bridge, secrets, config, logger, adapterRepo } = this.deps;
    const outboxId = String(row.outbox_id);
    const attemptCount = Number(row.attempt_count ?? 0);
    if (attemptCount > MAX_ATTEMPTS) {
      bridge.markOutboxRetry(outboxId, "MAX_ATTEMPTS", "Exceeded max attempts");
      return;
    }
    const secret = secrets.load();
    if (!secret) {
      bridge.markOutboxRetry(outboxId, "SECRET_MISSING", "Secrets missing");
      return;
    }

    const kind = String(row.kind);
    const payload = JSON.parse(String(row.payload_json)) as Record<string, unknown>;
    const client = createAgentClient(config, secret.agentApiKey);

    try {
      let learningPlaneRef = "";
      if (kind === "governance_submission") {
        if (!config.governancePublishEnabled) {
          bridge.markOutboxRetry(outboxId, "FLAG_OFF", "Governance publish disabled");
          return;
        }
        const result = (await client.submitProceduralChangeProposal(
          payload as never
        )) as {
          proposal?: { proposalId: string };
          case?: { caseId: string };
          idempotentReplay?: boolean;
        };
        const proposalId = result.proposal?.proposalId;
        const caseId = result.case?.caseId;
        if (!proposalId || !caseId) {
          throw new Error("Learning Plane proposal response missing case/proposal ids.");
        }
        learningPlaneRef = caseId;
        if (row.version_id) {
          bridge.markPublished(String(row.version_id), {
            lpProposalId: proposalId,
            lpCaseId: caseId
          });
        }
        adapterRepo.recordProcessingEvent({
          eventKind: "learning_plane.governance_submission_published",
          detail: {
            outboxId,
            proposalId,
            caseId,
            idempotentReplay: Boolean(result.idempotentReplay)
          }
        });
      } else if (
        kind === "local_validation_receipt" ||
        kind === "activation_receipt" ||
        kind === "activation_failure_receipt"
      ) {
        if (
          kind === "local_validation_receipt" &&
          !config.validationReceiptEnabled
        ) {
          bridge.markOutboxRetry(outboxId, "FLAG_OFF", "Validation receipt disabled");
          return;
        }
        if (
          (kind === "activation_receipt" || kind === "activation_failure_receipt") &&
          !config.activationReceiptEnabled
        ) {
          bridge.markOutboxRetry(outboxId, "FLAG_OFF", "Activation receipt disabled");
          return;
        }
        const caseId = String(row.case_id ?? "");
        const result = (await client.submitActivationReceipt(
          caseId,
          payload as never
        )) as { receiptId?: string };
        learningPlaneRef = result.receiptId ?? `activation:${caseId}`;
        adapterRepo.recordProcessingEvent({
          eventKind: "learning_plane.activation_receipt_published",
          detail: { outboxId, kind, caseId }
        });
      } else if (kind === "rollback_receipt" || kind === "rollback_failure_receipt") {
        if (!config.activationReceiptEnabled) {
          bridge.markOutboxRetry(outboxId, "FLAG_OFF", "Rollback receipt disabled");
          return;
        }
        const caseId = String(row.case_id ?? "");
        const result = (await client.submitRollbackReceipt(
          caseId,
          payload as never
        )) as { receiptId?: string };
        learningPlaneRef = result.receiptId ?? `rollback:${caseId}`;
        adapterRepo.recordProcessingEvent({
          eventKind: "learning_plane.rollback_receipt_published",
          detail: { outboxId, kind, caseId }
        });
      } else if (kind === "replay_report") {
        if (!config.replayReportEnabled) {
          bridge.markOutboxRetry(outboxId, "FLAG_OFF", "Replay report disabled");
          return;
        }
        const replayJobId = String(row.replay_job_id ?? payload.replayJobId ?? "");
        const result = (await client.submitReplayReport(
          replayJobId,
          payload as never
        )) as {
          verification?: { verificationId?: string; promotionEvidence?: string };
          report?: { replayReportId?: string };
        };
        learningPlaneRef =
          result.verification?.verificationId ??
          result.report?.replayReportId ??
          `report:${replayJobId}`;
        adapterRepo.recordProcessingEvent({
          eventKind: "learning_plane.replay_report_published",
          detail: {
            outboxId,
            replayJobId,
            promotionEvidence: result.verification?.promotionEvidence ?? null,
            activates: false
          }
        });
      } else if (kind === "legacy_local_reference") {
        if (!config.grandfatherRegisterEnabled) {
          bridge.markOutboxRetry(outboxId, "FLAG_OFF", "Grandfather register disabled");
          return;
        }
        const result = (await client.registerLegacyLocalRuleReference(
          payload as never
        )) as { referenceId?: string };
        learningPlaneRef = result.referenceId ?? `legacy:${String(payload.localRuleId)}`;
        adapterRepo.recordProcessingEvent({
          eventKind: "learning_plane.legacy_local_published",
          detail: { outboxId, ref: learningPlaneRef }
        });
      } else {
        bridge.markOutboxRetry(outboxId, "UNKNOWN_KIND", `Unknown outbox kind ${kind}`);
        return;
      }

      bridge.markOutboxPublished(outboxId, learningPlaneRef);
    } catch (error) {
      const classified = classifyPublishError(error);
      bridge.markOutboxRetry(outboxId, classified.code, classified.message);
      adapterRepo.recordProcessingEvent({
        eventKind: classified.retryable
          ? "learning_plane.governance_outbox_retry"
          : "learning_plane.governance_outbox_permanent_failure",
        detail: { outboxId, code: classified.code, retryable: classified.retryable }
      });
      logger.warn(
        {
          eventType: "learning_plane.governance_outbox_retry",
          outboxId,
          code: classified.code
        },
        "Governance bridge outbox publish issue"
      );
    }
  }
}
