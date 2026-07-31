import type { Request, Response, NextFunction, Router } from "express";
import { Router as createRouter } from "express";
import {
  EventDeliveryNotificationSchema,
  WorkflowFeedbackResolutionSubmittedPayloadV1Schema
} from "@learning-plane/contracts";
import { verifyLearningPlaneDeliverySignature } from "@learning-plane/client";
import type { LearningPlaneAdapterRepository } from "./adapterRepository.js";
import type { LearningPlaneAdapterConfig } from "./config.js";
import type { LearningPlaneSecretStore } from "./secretStore.js";
import type { LearningPlaneReconciliationWorker } from "./reconciliationWorker.js";

export type CallbackRouteDeps = {
  config: LearningPlaneAdapterConfig;
  repo: LearningPlaneAdapterRepository;
  secrets: LearningPlaneSecretStore;
  reconciliation: LearningPlaneReconciliationWorker;
};

const SUPPORTED_RECEIVE_TYPES = new Set(["workflow_feedback.resolution_submitted"]);

function rawBodyOf(req: Request): Buffer {
  const withRaw = req as Request & { rawBody?: Buffer };
  if (Buffer.isBuffer(withRaw.rawBody)) return withRaw.rawBody;
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body, "utf8");
  return Buffer.from(JSON.stringify(req.body ?? {}), "utf8");
}

/**
 * LP8-I3b production receive path for workflow_feedback.resolution_submitted@1.0 only.
 */
export function learningPlaneCallbackRoutes(deps: CallbackRouteDeps): Router {
  const router = createRouter();

  router.post("/v1/learning-plane/deliveries", (req: Request, res: Response, next: NextFunction) => {
    try {
      const { config, repo, secrets } = deps;
      if (!config.enabled || !config.receiveEnabled) {
        repo.recordProcessingEvent({
          eventKind: "learning_plane.callback_rejected_unimplemented",
          detail: { reason: "receive_disabled" }
        });
        res.status(503).json({
          error: {
            code: "LP_ADAPTER_RECEIVE_DISABLED",
            message: "Learning Plane receiving is disabled.",
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
      let notificationUnknown: unknown;
      try {
        notificationUnknown = JSON.parse(rawBody.toString("utf8"));
      } catch {
        res.status(400).json({
          error: {
            code: "LP_INVALID_JSON",
            message: "Delivery body is not valid JSON.",
            retryable: false
          }
        });
        return;
      }

      const parsedNotification = EventDeliveryNotificationSchema.safeParse(notificationUnknown);
      if (!parsedNotification.success) {
        res.status(400).json({
          error: {
            code: "LP_INVALID_NOTIFICATION",
            message: "Delivery notification failed schema validation.",
            retryable: false
          }
        });
        return;
      }
      const notification = parsedNotification.data;

      const verified = verifyLearningPlaneDeliverySignature({
        verificationSecret: secret.callbackVerificationSecret,
        expectedTargetAgentId: config.agentId,
        rawBody,
        headers: {
          keyId: String(req.headers["x-learning-plane-key-id"] ?? ""),
          timestamp: String(req.headers["x-learning-plane-timestamp"] ?? ""),
          deliveryId: String(req.headers["x-learning-plane-delivery-id"] ?? ""),
          signature: String(req.headers["x-learning-plane-signature"] ?? "")
        },
        notificationTargetAgentId: notification.event.targetAgentId,
        notificationEventId: notification.event.eventId,
        notificationDeliveryId: notification.deliveryId
      });

      if (!verified.ok) {
        repo.recordProcessingEvent({
          eventKind: "learning_plane.callback_signature_rejected",
          detail: { code: verified.code }
        });
        res.status(401).json({
          error: {
            code: "LP_SIGNATURE_REJECTED",
            message: `Delivery signature rejected (${verified.code}).`,
            retryable: false
          }
        });
        return;
      }

      if (notification.event.targetAgentId !== config.agentId) {
        res.status(400).json({
          error: {
            code: "LP_WRONG_TARGET",
            message: "Delivery targetAgentId does not match this agent.",
            retryable: false
          }
        });
        return;
      }

      if (!SUPPORTED_RECEIVE_TYPES.has(notification.event.eventType)) {
        repo.recordProcessingEvent({
          eventKind: "learning_plane.callback_rejected_unimplemented",
          detail: { eventType: notification.event.eventType }
        });
        res.status(400).json({
          error: {
            code: "LP_UNSUPPORTED_EVENT_TYPE",
            message: `Unsupported event type '${notification.event.eventType}'.`,
            retryable: false
          }
        });
        return;
      }

      if (notification.event.metadata.payloadSchemaVersion !== "1.0") {
        res.status(400).json({
          error: {
            code: "LP_UNRELEASED_PAYLOAD_VERSION",
            message: `Unreleased payloadSchemaVersion '${notification.event.metadata.payloadSchemaVersion}'.`,
            retryable: false
          }
        });
        return;
      }

      const payloadParsed = WorkflowFeedbackResolutionSubmittedPayloadV1Schema.safeParse(
        notification.event.payload
      );
      if (!payloadParsed.success) {
        res.status(400).json({
          error: {
            code: "LP_INVALID_PAYLOAD",
            message: "resolution_submitted payload failed schema validation.",
            retryable: false
          }
        });
        return;
      }
      const payload = payloadParsed.data;

      const insert = repo.insertInboxIfNew({
        eventId: notification.event.eventId,
        deliveryId: notification.deliveryId,
        sourceAgentId: notification.event.sourceAgentId,
        targetAgentId: notification.event.targetAgentId,
        eventType: notification.event.eventType,
        payloadSchemaVersion: notification.event.metadata.payloadSchemaVersion,
        correlationId: notification.event.correlationId,
        causationEventId: notification.event.causationEventId,
        workflowFeedbackId: payload.maaWorkflowFeedbackId,
        resolutionId: payload.resolutionId,
        resolutionType: payload.resolutionType,
        producerContractName: payload.producerContract.name,
        producerContractVersion: payload.producerContract.version,
        operationalResolutionRef: payload.operationalResolutionRef,
        payload,
        processingStatus: "received"
      });

      repo.insertAckIfNew({
        inboxId: insert.inboxId,
        eventId: notification.event.eventId,
        deliveryId: notification.deliveryId
      });

      if (insert.created) {
        repo.recordProcessingEvent({
          eventKind: "learning_plane.resolution_submitted_received",
          relatedInboxId: insert.inboxId,
          correlationId: notification.event.correlationId,
          detail: {
            eventId: notification.event.eventId,
            deliveryId: notification.deliveryId,
            workflowFeedbackId: payload.maaWorkflowFeedbackId,
            resolutionId: payload.resolutionId
          }
        });
        deps.reconciliation.reconcileInboxRecord(insert.inboxId);
      } else {
        repo.recordProcessingEvent({
          eventKind: "learning_plane.resolution_submitted_duplicate",
          relatedInboxId: insert.inboxId,
          correlationId: notification.event.correlationId,
          detail: {
            eventId: notification.event.eventId,
            deliveryId: notification.deliveryId
          }
        });
      }

      res.status(200).json({
        received: true,
        inboxId: insert.inboxId,
        duplicate: !insert.created
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
