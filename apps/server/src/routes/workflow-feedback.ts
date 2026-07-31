import { Router } from "express";
import { AppError, ResolveWorkflowFeedbackSchema } from "@maa/contracts";
import type { Container } from "../composition/container";

export function workflowFeedbackRoutes(container: Container): Router {
  const router = Router();

  router.get("/v1/workflow-feedback/:feedbackId", (req, res, next) => {
    try {
      const body = container.workflowFeedbackService.getById(req.params.feedbackId!);
      res.status(200).json(body);
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/analysis-runs/:runId/workflow-feedback", (req, res, next) => {
    try {
      container.analysisService.getRun(req.params.runId!);
      const events = container.workflowFeedbackService.listByRun(req.params.runId!);
      res.status(200).json({ events });
    } catch (err) {
      next(err);
    }
  });

  router.post("/v1/workflow-feedback/:feedbackId/resolve", (req, res, next) => {
    try {
      const parsed = ResolveWorkflowFeedbackSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "Invalid workflow feedback resolve payload.",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message
          }))
        });
      }
      if (parsed.data.supplementalEvidencePackageIds.length > 0) {
        container.evidenceService.assertPackagesExist(
          parsed.data.supplementalEvidencePackageIds
        );
      }
      const body = container.workflowFeedbackService.resolve(
        req.params.feedbackId!,
        parsed.data
      );
      container.metrics.increment("workflow_feedback_resolutions_total");
      container.auditLog.append({
        actorType: "client",
        actorId: parsed.data.actorId,
        action: "workflow_feedback.resolved_request",
        targetType: "workflow_feedback",
        targetId: body.workflowFeedbackId,
        after: {
          status: body.status,
          resolutionAction: body.resolutionAction
        }
      });
      res.status(200).json(body);
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/gap-fingerprints/:fingerprintId", (req, res, next) => {
    try {
      const body = container.workflowFeedbackService.getFingerprint(
        req.params.fingerprintId!
      );
      res.status(200).json(body);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
