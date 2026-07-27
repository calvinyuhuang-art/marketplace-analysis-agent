import { Router } from "express";
import {
  AppError,
  CreateRevisionRequestSchema,
  RunReviewRequestSchema
} from "@maa/contracts";
import type { Container } from "../composition/container";
import { getIds } from "../middleware/context";

export function revisionRoutes(container: Container): Router {
  const router = Router();

  router.post("/v1/analysis-runs/:runId/revise", (req, res, next) => {
    try {
      const parsed = CreateRevisionRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "Invalid revision request payload.",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message
          }))
        });
      }
      const ids = getIds(res);
      const result = container.revisionService.createRevision(req.params.runId!, parsed.data, {
        correlationId: ids.correlationId
      });
      container.metrics.increment("analysis_revisions_total");
      res.status(202).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post("/v1/analysis-runs/:runId/review", (req, res, next) => {
    try {
      const parsed = RunReviewRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "Invalid run review payload.",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message
          }))
        });
      }
      const result = container.revisionService.reviewRun(req.params.runId!, parsed.data);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/analysis-runs/:runId/revision-diff", (req, res, next) => {
    try {
      container.analysisService.getRun(req.params.runId!);
      const found = container.repos.revisionDiffs.getByRevisionRun(req.params.runId!);
      if (!found) {
        throw new AppError({
          code: "NOT_FOUND",
          message: `No revision diff for run '${req.params.runId}'.`
        });
      }
      res.status(200).json({
        diffId: found.diffId,
        artifactId: found.artifactId,
        ...(JSON.parse(found.payloadJson) as Record<string, unknown>)
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/analysis-runs/:runId/learning-events", (req, res, next) => {
    try {
      container.analysisService.getRun(req.params.runId!);
      const events = container.repos.learningEvents.listByRun(req.params.runId!);
      res.status(200).json({
        learningEvents: events.map((e) => ({
          learningEventId: e.learningEventId,
          projectId: e.projectId,
          eventType: e.eventType,
          reasonCode: e.reasonCode,
          notes: e.notes,
          sourceRunId: e.sourceRunId,
          sourceFindingId: e.sourceFindingId,
          revisionRunId: e.revisionRunId,
          payload: JSON.parse(e.payloadJson),
          promotionStatus: e.promotionStatus,
          createdAt: e.createdAt
        }))
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/analysis-runs/:runId/reviews", (req, res, next) => {
    try {
      container.analysisService.getRun(req.params.runId!);
      const findingReviews = container.repos.findings
        .listByRun(req.params.runId!)
        .flatMap((f) =>
          container.repos.findingReviews.listByFinding(f.findingId).map((r) => ({
            kind: "finding" as const,
            ...r,
            findingId: f.findingId,
            statement: f.statement,
            analysisArea: f.analysisArea
          }))
        );
      const runReviews = container.repos.runReviews.listByRun(req.params.runId!).map((r) => ({
        kind: "run" as const,
        ...r
      }));
      const timeline = [...findingReviews, ...runReviews].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt)
      );
      res.status(200).json({ reviews: timeline });
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/projects/:projectId/learning-events", (req, res, next) => {
    try {
      container.analysisService.getProject(req.params.projectId!);
      const events = container.repos.learningEvents.listByProject(req.params.projectId!);
      res.status(200).json({
        learningEvents: events.map((e) => ({
          learningEventId: e.learningEventId,
          projectId: e.projectId,
          eventType: e.eventType,
          reasonCode: e.reasonCode,
          notes: e.notes,
          sourceRunId: e.sourceRunId,
          sourceFindingId: e.sourceFindingId,
          revisionRunId: e.revisionRunId,
          payload: JSON.parse(e.payloadJson),
          promotionStatus: e.promotionStatus,
          createdAt: e.createdAt
        }))
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
