import type { Request, Response, NextFunction, Router } from "express";
import { Router as createRouter } from "express";
import {
  REPLAY_CALLBACK_PATH,
  ReplayJobNotificationSchema
} from "@learning-plane/contracts";
import { verifyReplayJobSignature } from "@learning-plane/client";
import type { LearningPlaneAdapterConfig } from "./config.js";
import type { LearningPlaneSecretStore } from "./secretStore.js";
import type { LearningPlaneAdapterRepository } from "./adapterRepository.js";
import type { GovernanceBridgeService } from "./governanceBridgeService.js";
import { createAgentClient } from "./clientFactory.js";

export type ReplayCallbackDeps = {
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

export function replayCallbackRoutes(deps: ReplayCallbackDeps): Router {
  const router = createRouter();

  router.post(REPLAY_CALLBACK_PATH, (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const { config, secrets, adapterRepo, bridge } = deps;
        if (!config.enabled || !config.replayBridgeEnabled) {
          res.status(503).json({
            error: {
              code: "LP_REPLAY_BRIDGE_DISABLED",
              message: "Replay bridge is disabled.",
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
              message: "Replay body is not valid JSON.",
              retryable: false
            }
          });
          return;
        }

        const parsed = ReplayJobNotificationSchema.safeParse(parsedUnknown);
        if (!parsed.success) {
          res.status(400).json({
            error: {
              code: "LP_INVALID_NOTIFICATION",
              message: "ReplayJobNotification failed schema validation.",
              retryable: false
            }
          });
          return;
        }
        const notification = parsed.data;

        const verified = verifyReplayJobSignature({
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
          notificationReplayJobId: notification.replayJobId,
          notificationDeliveryId: notification.replayDeliveryId
        });

        if (!verified.ok) {
          adapterRepo.recordProcessingEvent({
            eventKind: "learning_plane.replay_signature_rejected",
            detail: { code: verified.code }
          });
          res.status(401).json({
            error: {
              code: "LP_SIGNATURE_REJECTED",
              message: `Replay signature rejected (${verified.code}).`,
              retryable: false
            }
          });
          return;
        }

        // Persist before acknowledgement; never execute inside callback.
        const handled = bridge.handleReplayJob(notification);

        try {
          const client = createAgentClient(config, secret.agentApiKey);
          await client.acknowledgeReplayDelivery(notification.replayDeliveryId, {
            idempotencyKey: `maa-replay-ack-${notification.replayDeliveryId}`,
            processingReceipt: `inbox:${handled.inboxId}`
          });
          adapterRepo.recordProcessingEvent({
            eventKind: "learning_plane.replay_acknowledged",
            detail: {
              deliveryId: notification.replayDeliveryId,
              replayJobId: notification.replayJobId
            }
          });
        } catch (ackError) {
          adapterRepo.recordProcessingEvent({
            eventKind: "learning_plane.replay_ack_uncertain",
            detail: {
              deliveryId: notification.replayDeliveryId,
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
          activated: false,
          executedInCallback: false
        });
      } catch (error) {
        next(error);
      }
    })();
  });

  return router;
}
