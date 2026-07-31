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
  const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1));
  return exp + Math.floor(Math.random() * 250);
}

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
    return {
      retryable: false,
      code: error.code,
      message
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { retryable: true, code: "UNKNOWN", message: message.slice(0, 500) };
}

export class LearningPlaneOutboxWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly leaseOwner = `maa-outbox-${process.pid}`;

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
    const interval = this.deps.intervalMs ?? 500;
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
    const { config, repo, secrets } = this.deps;
    if (!config.enabled || !config.publishEnabled || !repo.tablesPresent()) return;
    if (!secrets.exists()) return;

    this.running = true;
    try {
      const candidates = repo.listOutboxByStatus(["pending", "retry_scheduled"], 20);
      for (const row of candidates) {
        const claimed = repo.claimOutbox(row.outbox_id, this.leaseOwner, LEASE_MS);
        if (!claimed) continue;
        // HTTP outside SQLite transaction — claim already committed.
        await this.publishClaimed(claimed.outbox_id);
      }
    } finally {
      this.running = false;
    }
  }

  private async publishClaimed(outboxId: string): Promise<void> {
    const { repo, secrets, config, logger } = this.deps;
    const row = repo.getOutbox(outboxId);
    if (!row || row.status !== "claimed") return;

    if (row.attempt_count > MAX_ATTEMPTS) {
      repo.markOutboxPermanentFailure(
        outboxId,
        "MAX_ATTEMPTS",
        "Outbox exceeded maximum publish attempts."
      );
      repo.recordProcessingEvent({
        eventKind: "learning_plane.outbox_permanent_failure",
        relatedOutboxId: outboxId,
        correlationId: row.correlation_id,
        detail: { code: "MAX_ATTEMPTS" }
      });
      return;
    }

    if (!row.payload_json) {
      repo.markOutboxPermanentFailure(outboxId, "MISSING_PAYLOAD", "Outbox payload missing.");
      return;
    }

    const secret = secrets.load();
    if (!secret) {
      repo.markOutboxRetry(outboxId, backoffMs(row.attempt_count), "SECRET_MISSING", "Secrets missing");
      return;
    }

    try {
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      const client = createAgentClient(config, secret.agentApiKey);
      const result = (await client.publishEvent({
        eventType: row.event_type as
          | "workflow_feedback.created"
          | "workflow_feedback.resolution_evaluated",
        schemaVersion: "1.0",
        sourceAgentId: config.agentId,
        targetAgentId: row.target_agent_id ?? "research-orchestrator",
        workOrderId: row.work_order_id ?? row.workflow_feedback_id ?? row.outbox_id,
        correlationId: row.correlation_id ?? row.outbox_id,
        ...(row.causation_event_id ? { causationEventId: row.causation_event_id } : {}),
        occurredAt: new Date().toISOString(),
        idempotencyKey: row.idempotency_key,
        payload,
        artifactReferences: [],
        metadata: {
          producerServiceVersion: "0.21.0",
          payloadSchemaVersion: row.payload_schema_version,
          learningPlaneContractVersion: "1.0"
        }
      })) as {
        event: { eventId: string };
        idempotentReplay?: boolean;
      };

      const eventId = result.event.eventId;
      repo.markOutboxPublished(outboxId, eventId);
      const kind =
        row.event_type === "workflow_feedback.resolution_evaluated"
          ? "learning_plane.workflow_feedback_evaluated_published"
          : "learning_plane.workflow_feedback_created_published";
      repo.recordProcessingEvent({
        eventKind: kind,
        relatedOutboxId: outboxId,
        correlationId: row.correlation_id,
        detail: {
          learningPlaneEventId: eventId,
          idempotentReplay: Boolean(result.idempotentReplay)
        }
      });
    } catch (error) {
      const classified = classifyPublishError(error);
      if (classified.retryable) {
        repo.markOutboxRetry(
          outboxId,
          backoffMs(row.attempt_count),
          classified.code,
          classified.message
        );
        repo.recordProcessingEvent({
          eventKind: "learning_plane.outbox_retry_scheduled",
          relatedOutboxId: outboxId,
          correlationId: row.correlation_id,
          detail: { code: classified.code }
        });
        logger.warn(
          { eventType: "learning_plane.outbox_retry_scheduled", outboxId, code: classified.code },
          "Learning Plane outbox retry scheduled"
        );
      } else {
        repo.markOutboxPermanentFailure(outboxId, classified.code, classified.message);
        repo.recordProcessingEvent({
          eventKind: "learning_plane.outbox_permanent_failure",
          relatedOutboxId: outboxId,
          correlationId: row.correlation_id,
          detail: { code: classified.code }
        });
      }
    }
  }
}
