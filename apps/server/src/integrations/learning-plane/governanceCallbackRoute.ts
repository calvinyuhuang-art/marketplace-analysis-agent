import type { Request, Response, NextFunction, Router } from "express";
import { Router as createRouter } from "express";
import {
  GOVERNANCE_CALLBACK_PATH,
  GovernanceDecisionNotificationSchema
} from "@learning-plane/contracts";
import { verifyGovernanceDecisionSignature } from "@learning-plane/client";
import type { LearningPlaneAdapterConfig } from "./config.js";
import type { LearningPlaneSecretStore } from "./secretStore.js";
import type { LearningPlaneAdapterRepository } from "./adapterRepository.js";
import type { GovernanceBridgeService } from "./governanceBridgeService.js";
import { createAgentClient } from "./clientFactory.js";

export type GovernanceCallbackDeps = {
  config: LearningPlaneAdapterConfig;
  secrets: LearningPlaneSecretStore;
  adapterRepo: LearningPlaneAdapterRepository;
  bridge: GovernanceBridgeService;
};

function rawBodyOf(req: Request): Buffer {
  const withRaw = req as Request & { rawBody?: Buffer };
  if (Buffer.isBuffer(withRaw.rawBody)) return withRaw.rawBody;
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body, "utf8");
  return Buffer.from(JSON.stringify(req.body ?? {}), "utf8");
}

export function governanceCallbackRoutes(deps: GovernanceCallbackDeps): Router {
  const router = createRouter();

  router.post(GOVERNANCE_CALLBACK_PATH, (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const { config, secrets, adapterRepo, bridge } = deps;
        if (
          !config.enabled ||
          !config.governanceBridgeEnabled ||
          !config.governanceReceiveEnabled
        ) {
          res.status(503).json({
            error: {
              code: "LP_GOVERNANCE_RECEIVE_DISABLED",
              message: "Governance decision receive is disabled.",
              retryable: true
            }
          });
          return;
        }
        if (!secrets.exists()) {
          res.status(503).json({
            error: {
              code: "LP_ADAPTER_SECRETS_MISSING",
              message: "Learning Plane secrets are missing.",
              retryable: true
            }
          });
          return;
        }
        const secret = secrets.load();
        if (!secret) {
          res.status(503).json({
            error: {
              code: "LP_ADAPTER_SECRETS_MISSING",
              message: "Learning Plane secrets could not be loaded.",
              retryable: true
            }
          });
          return;
        }

        const rawBody = rawBodyOf(req);
        let parsedUnknown: unknown;
        try {
          parsedUnknown = JSON.parse(rawBody.toString("utf8"));
        } catch {
          res.status(400).json({
            error: {
              code: "LP_INVALID_JSON",
              message: "Governance body is not valid JSON.",
              retryable: false
            }
          });
          return;
        }

        const parsed = GovernanceDecisionNotificationSchema.safeParse(parsedUnknown);
        if (!parsed.success) {
          res.status(400).json({
            error: {
              code: "LP_INVALID_NOTIFICATION",
              message: "GovernanceDecisionNotification failed schema validation.",
              retryable: false
            }
          });
          return;
        }
        const notification = parsed.data;

        const verified = verifyGovernanceDecisionSignature({
          verificationSecret: secret.callbackVerificationSecret,
          expectedTargetAgentId: config.agentId,
          rawBody,
          headers: {
            keyId: String(req.headers["x-learning-plane-key-id"] ?? ""),
            timestamp: String(req.headers["x-learning-plane-timestamp"] ?? ""),
            deliveryId: String(req.headers["x-learning-plane-delivery-id"] ?? ""),
            signature: String(req.headers["x-learning-plane-signature"] ?? ""),
            messageType: String(req.headers["x-learning-plane-message-type"] ?? "")
          },
          notificationTargetAgentId: notification.targetAgentId,
          notificationDecisionId: notification.governanceDecisionId,
          notificationDeliveryId: notification.governanceDeliveryId
        });

        if (!verified.ok) {
          adapterRepo.recordProcessingEvent({
            eventKind: "learning_plane.governance_signature_rejected",
            detail: { code: verified.code }
          });
          res.status(401).json({
            error: {
              code: "LP_SIGNATURE_REJECTED",
              message: `Governance signature rejected (${verified.code}).`,
              retryable: false
            }
          });
          return;
        }

        const handled = bridge.handleGovernanceDecision(notification);

        // Acknowledge after durable persist (idempotent).
        try {
          const client = createAgentClient(config, secret.agentApiKey);
          await client.acknowledgeGovernanceDelivery(notification.governanceDeliveryId, {
            idempotencyKey: `maa-gov-ack-${notification.governanceDeliveryId}`,
            processingReceipt: `inbox:${handled.inboxId}`
          });
          adapterRepo.recordProcessingEvent({
            eventKind: "learning_plane.governance_decision_acknowledged",
            detail: {
              deliveryId: notification.governanceDeliveryId,
              inboxId: handled.inboxId
            }
          });
        } catch (ackError) {
          adapterRepo.recordProcessingEvent({
            eventKind: "learning_plane.governance_ack_uncertain",
            detail: {
              deliveryId: notification.governanceDeliveryId,
              error:
                ackError instanceof Error
                  ? ackError.message.slice(0, 200)
                  : "ack_failed"
            }
          });
        }

        res.status(200).json({
          received: true,
          inboxId: handled.inboxId,
          duplicate: handled.idempotentReplay,
          localValidationStatus: handled.validationStatus,
          activated: false
        });
      } catch (error) {
        next(error);
      }
    })();
  });

  return router;
}
