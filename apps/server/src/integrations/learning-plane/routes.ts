import { Router } from "express";
import { AppError } from "@maa/contracts";
import type { Container } from "../../composition/container";
import { z } from "zod";

const BootstrapBodySchema = z.object({
  operatorToken: z.string().min(8),
  learningPlaneBaseUrl: z.string().url().optional()
});

export function learningPlaneIntegrationRoutes(container: Container): Router {
  const router = Router();

  router.get("/v1/integrations/learning-plane/status", async (_req, res, next) => {
    try {
      if (!container.learningPlane) {
        res.status(200).json({
          implementationMilestone: "LP8-I3b",
          enabled: false,
          adapterState: "disabled",
          notes: ["Learning Plane adapter not wired"]
        });
        return;
      }
      res.status(200).json(await container.learningPlane.getStatus());
    } catch (error) {
      next(error);
    }
  });

  router.post("/v1/integrations/learning-plane/bootstrap", async (req, res, next) => {
    try {
      if (!container.learningPlane) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "Learning Plane adapter is unavailable."
        });
      }
      const body = BootstrapBodySchema.parse(req.body ?? {});
      const result = await container.learningPlane.bootstrap({
        operatorToken: body.operatorToken,
        learningPlaneBaseUrl: body.learningPlaneBaseUrl
      });
      res.status(200).json({
        status: "bootstrapped",
        agentId: result.agentId,
        credentialId: result.credentialId,
        callbackKeyId: result.callbackKeyId,
        capabilities: result.capabilities,
        secretsStored: true,
        operatorTokenRetained: false
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/v1/integrations/learning-plane/registration/reconcile", async (_req, res, next) => {
    try {
      if (!container.learningPlane) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "Learning Plane adapter is unavailable."
        });
      }
      const result = await container.learningPlane.reconcile();
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/v1/integrations/learning-plane/health/report", async (_req, res, next) => {
    try {
      if (!container.learningPlane) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "Learning Plane adapter is unavailable."
        });
      }
      const result = await container.learningPlane.reportHealth();
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/v1/integrations/learning-plane/outbox", (_req, res, next) => {
    try {
      if (!container.learningPlane?.repo.tablesPresent()) {
        res.status(200).json({ items: [] });
        return;
      }
      const items = container.learningPlane.repo.listRecentOutbox(50).map((row) => ({
        outboxId: row.outbox_id,
        eventType: row.event_type,
        status: row.status,
        workflowFeedbackId: row.workflow_feedback_id,
        resolutionId: row.resolution_id,
        evaluationId: row.evaluation_id,
        correlationId: row.correlation_id,
        causationEventId: row.causation_event_id,
        learningPlaneEventId: row.learning_plane_event_id,
        attemptCount: row.attempt_count,
        lastErrorCode: row.last_error_code,
        lastBoundedError: row.last_bounded_error,
        createdAt: row.created_at,
        publishedAt: row.published_at
      }));
      res.status(200).json({ items });
    } catch (error) {
      next(error);
    }
  });

  router.get("/v1/integrations/learning-plane/inbox", (_req, res, next) => {
    try {
      if (!container.learningPlane?.repo.tablesPresent()) {
        res.status(200).json({ items: [] });
        return;
      }
      const items = container.learningPlane.repo.listRecentInbox(50).map((row) => ({
        inboxId: row.inbox_id,
        eventId: row.event_id,
        deliveryId: row.delivery_id,
        eventType: row.event_type,
        processingStatus: row.processing_status,
        acknowledgementStatus: row.acknowledgement_status,
        workflowFeedbackId: row.workflow_feedback_id,
        resolutionId: row.resolution_id,
        correlationId: row.correlation_id,
        causationEventId: row.causation_event_id,
        lastErrorCode: row.last_error_code,
        lastBoundedError: row.last_bounded_error,
        receivedAt: row.received_at
      }));
      res.status(200).json({ items });
    } catch (error) {
      next(error);
    }
  });

  router.get("/v1/integrations/learning-plane/processing-events", (_req, res, next) => {
    try {
      if (!container.learningPlane?.repo.tablesPresent()) {
        res.status(200).json({ items: [] });
        return;
      }
      const items = container.learningPlane.repo.listRecentProcessingEvents(50).map((row) => ({
        processingEventId: row.processing_event_id,
        eventKind: row.event_kind,
        correlationId: row.correlation_id,
        detail: (() => {
          try {
            return JSON.parse(String(row.detail_json ?? "{}"));
          } catch {
            return {};
          }
        })(),
        createdAt: row.created_at
      }));
      res.status(200).json({ items });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
