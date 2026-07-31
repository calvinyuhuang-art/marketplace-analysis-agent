import { LearningPlaneClientError } from "@learning-plane/client";
import type { Logger } from "@maa/logging";
import type { LearningPlaneAdapterRepository } from "./adapterRepository.js";
import type { LearningPlaneAdapterConfig } from "./config.js";
import { createAgentClient } from "./clientFactory.js";
import type { LearningPlaneSecretStore } from "./secretStore.js";

const MAX_ATTEMPTS = 12;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 5 * 60_000;
const LEASE_MS = 30_000;

function backoffMs(attempt: number): number {
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1));
}

export class LearningPlaneAcknowledgementWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly leaseOwner = `maa-ack-${process.pid}`;

  constructor(
    private readonly deps: {
      config: LearningPlaneAdapterConfig;
      repo: LearningPlaneAdapterRepository;
      secrets: LearningPlaneSecretStore;
      logger: Logger;
      intervalMs?: number;
      enabled?: () => boolean;
    }
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.deps.intervalMs ?? 500);
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
    const { config, repo, secrets } = this.deps;
    if (!config.enabled || !config.receiveEnabled || !repo.tablesPresent()) return;
    if (!secrets.exists()) return;

    this.running = true;
    try {
      for (const row of repo.listPendingAcks(20)) {
        const claimed = repo.claimAck(row.acknowledgement_id, this.leaseOwner, LEASE_MS);
        if (!claimed) continue;
        await this.acknowledgeClaimed(claimed.acknowledgement_id);
      }
    } finally {
      this.running = false;
    }
  }

  private async acknowledgeClaimed(acknowledgementId: string): Promise<void> {
    const { repo, secrets, config, logger } = this.deps;
    const ack = repo.getAck(acknowledgementId);
    if (!ack || ack.status !== "claimed") return;
    if (ack.attempt_count > MAX_ATTEMPTS) {
      repo.markAckPermanentFailure(
        acknowledgementId,
        "MAX_ATTEMPTS",
        "Acknowledgement exceeded maximum attempts."
      );
      return;
    }

    const secret = secrets.load();
    if (!secret) {
      repo.markAckRetry(
        acknowledgementId,
        backoffMs(ack.attempt_count),
        "SECRET_MISSING",
        "Secrets missing"
      );
      return;
    }

    try {
      const client = createAgentClient(config, secret.agentApiKey);
      await client.acknowledgeDelivery(ack.delivery_id, {
        idempotencyKey: `maa:ack:${ack.delivery_id}`
      });
      repo.markAckSucceeded(acknowledgementId, ack.inbox_id);
      repo.recordProcessingEvent({
        eventKind: "learning_plane.acknowledgement_succeeded",
        relatedAcknowledgementId: acknowledgementId,
        relatedInboxId: ack.inbox_id,
        detail: { deliveryId: ack.delivery_id }
      });
    } catch (error) {
      const lpError = error instanceof LearningPlaneClientError ? error : null;
      const status = lpError?.status ?? 0;
      const retryable =
        !lpError ||
        lpError.code === "NETWORK" ||
        lpError.code === "TIMEOUT" ||
        status === 408 ||
        status === 425 ||
        status === 429 ||
        (status >= 500 && status <= 599);
      const code = lpError?.code ?? "UNKNOWN";
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      if (retryable) {
        repo.markAckRetry(acknowledgementId, backoffMs(ack.attempt_count), code, message);
        repo.recordProcessingEvent({
          eventKind: "learning_plane.acknowledgement_retry_scheduled",
          relatedAcknowledgementId: acknowledgementId,
          detail: { code }
        });
        logger.warn(
          { eventType: "learning_plane.acknowledgement_retry_scheduled", code },
          "Learning Plane acknowledgement retry scheduled"
        );
      } else {
        repo.markAckPermanentFailure(acknowledgementId, code, message);
      }
    }
  }
}
