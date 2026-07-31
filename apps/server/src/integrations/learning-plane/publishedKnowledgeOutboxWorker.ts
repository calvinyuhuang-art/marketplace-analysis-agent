import { LearningPlaneClientError } from "@learning-plane/client";
import type { Logger } from "@maa/logging";
import type { LearningPlaneAdapterConfig } from "./config.js";
import { createAgentClient } from "./clientFactory.js";
import type { LearningPlaneSecretStore } from "./secretStore.js";
import type { PublishedKnowledgeBridgeRepository } from "./publishedKnowledgeBridgeRepository.js";
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

export class PublishedKnowledgeOutboxWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly deps: {
      config: LearningPlaneAdapterConfig;
      pkRepo: PublishedKnowledgeBridgeRepository;
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
    const { config, secrets, pkRepo } = this.deps;
    if (!config.enabled || !config.publicationBridgeEnabled) return;
    if (!secrets.exists()) return;
    if (!pkRepo.tablesPresent()) return;

    this.running = true;
    try {
      const apiKey = secrets.load()?.agentApiKey;
      if (!apiKey) return;
      const client = createAgentClient(config, apiKey);
      const rows = pkRepo.claimOutbox(5);
      for (const row of rows) {
        try {
          if (row.attempt_count > MAX_ATTEMPTS) {
            pkRepo.markOutboxFailed(row.outbox_id, "MAX_ATTEMPTS", "Exceeded retry budget.");
            continue;
          }
          const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
          let ref: string | null = null;
          if (row.kind === "publication_proposal" && row.related_id) {
            const mapped = payload as {
              sourceRecordId: string;
              sourceRecordVersion: string;
              knowledgeType: string;
              title: string;
              summary: string;
              scope: string;
              authority: string;
              confidence: number;
              tags: string[];
              applicabilityConditions: string[];
              limitations: string[];
              packageBody: unknown;
              sourceReferences: unknown[];
              evidenceReferences: unknown[];
              freshnessPolicy: unknown;
            };
            const proposal = pkRepo.getProposal(row.related_id);
            const result = (await client.submitKnowledgePublicationProposal({
              ...mapped,
              idempotencyKey: proposal?.idempotency_key ?? row.idempotency_key
            } as never)) as {
              proposal?: { publicationProposalId?: string; governanceCaseId?: string };
              caseId?: string;
              idempotentReplay?: boolean;
            };
            const lpProposalId = String(
              result.proposal?.publicationProposalId ?? ""
            );
            const caseId = String(
              result.caseId ?? result.proposal?.governanceCaseId ?? ""
            );
            pkRepo.updateProposal(row.related_id, {
              status: "submitted",
              lp_proposal_id: lpProposalId || null,
              lp_case_id: caseId || null,
              submitted_at: new Date().toISOString()
            });
            ref = lpProposalId || caseId || "submitted";
          } else if (row.kind === "reference_receipt" && row.published_knowledge_id) {
            const result = (await client.submitKnowledgeDiscoveryReceipt(
              row.published_knowledge_id,
              payload as never
            )) as { receiptId?: string };
            ref = result.receiptId ?? "reference_receipt";
          } else if (row.kind === "use_receipt" && row.published_knowledge_id) {
            const result = (await client.submitKnowledgeDiscoveryReceipt(
              row.published_knowledge_id,
              payload as never
            )) as { receiptId?: string };
            ref = result.receiptId ?? "use_receipt";
          } else if (row.kind === "influence_receipt" && row.published_knowledge_id) {
            const result = (await client.submitKnowledgeDiscoveryReceipt(
              row.published_knowledge_id,
              payload as never
            )) as { receiptId?: string };
            ref = result.receiptId ?? "influence_receipt";
          } else if (row.kind === "challenge" && row.published_knowledge_id) {
            const result = (await client.submitKnowledgeChallenge(
              row.published_knowledge_id,
              payload as never
            )) as { challengeId?: string; challenge?: { challenge_id?: string } };
            ref =
              result.challengeId ??
              result.challenge?.challenge_id ??
              "challenge";
          } else {
            pkRepo.markOutboxFailed(row.outbox_id, "UNKNOWN_KIND", row.kind);
            continue;
          }
          pkRepo.markOutboxPublished(row.outbox_id, ref);
        } catch (error) {
          const classified = classifyPublishError(error);
          if (classified.retryable) {
            const delay = Math.min(60_000, 500 * 2 ** Math.min(row.attempt_count, 6));
            pkRepo.markOutboxRetry(
              row.outbox_id,
              classified.code,
              classified.message,
              delay
            );
          } else {
            pkRepo.markOutboxFailed(row.outbox_id, classified.code, classified.message);
            if (row.kind === "publication_proposal" && row.related_id) {
              pkRepo.updateProposal(row.related_id, {
                status: "failed",
                last_error_code: classified.code,
                last_bounded_error: classified.message
              });
            }
          }
          this.deps.logger.warn(
            {
              eventType: "learning_plane.pk_outbox_error",
              outboxId: row.outbox_id,
              code: classified.code
            },
            "Published-knowledge outbox item failed"
          );
        }
      }
    } finally {
      this.running = false;
    }
  }
}
