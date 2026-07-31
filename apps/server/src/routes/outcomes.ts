import { Router } from "express";
import {
  AppError,
  IngestOutcomeRequestSchema,
  ReassessOutcomeRequestSchema
} from "@maa/contracts";
import type { Container } from "../composition/container";
import { getIds } from "../middleware/context";

export function outcomeRoutes(container: Container): Router {
  const router = Router();

  router.post("/v1/outcomes", (req, res, next) => {
    try {
      const parsed = IngestOutcomeRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "Invalid outcome ingest payload.",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message
          }))
        });
      }
      const outcome = container.outcomeService.ingest(parsed.data);
      container.auditLog.append({
        actorType: "client",
        actorId: parsed.data.source,
        action: "outcome.ingested",
        targetType: "outcome_event",
        targetId: outcome.outcomeId,
        after: { projectId: outcome.projectId, eventType: outcome.eventType }
      });
      res.status(201).json(outcome);
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/outcomes/:outcomeId", (req, res, next) => {
    try {
      const outcome = container.outcomeService.getOutcome(req.params.outcomeId!);
      const reassessments = container.outcomeService.listReassessments(outcome.outcomeId);
      res.status(200).json({ ...outcome, reassessments });
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/projects/:projectId/outcomes", (req, res, next) => {
    try {
      res.status(200).json({
        outcomes: container.outcomeService.listByProject(req.params.projectId!)
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/v1/outcomes/:outcomeId/reassess", (req, res, next) => {
    try {
      const outcome = container.outcomeService.getOutcome(req.params.outcomeId!);
      const parsed = ReassessOutcomeRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "Invalid outcome reassess payload.",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message
          }))
        });
      }

      const project = container.repos.projects.getById(outcome.projectId);
      const productContext = project
        ? (JSON.parse(project.productContextJson) as {
            name: string;
            description?: string;
            salesGoal: string;
            constraints: string[];
          })
        : {
            name: outcome.projectId,
            salesGoal: "Outcome reassessment",
            constraints: [] as string[]
          };

      const capability = parsed.data.capability ?? {
        platform: project?.platform ?? "amazon",
        marketplace: project?.marketplace ?? "US",
        category: project?.category ?? "books",
        productType: project?.productType ?? "adult_coloring_book"
      };

      const ids = getIds(res);
      const created = container.analysisService.createAnalysisRequest(
        {
          client: parsed.data.client,
          projectId: outcome.projectId,
          operation: "reassess_with_outcome",
          capability,
          productContext,
          requestedAnalysis: ["opportunity_summary"],
          evidencePackageIds: [],
          outcomeId: outcome.outcomeId,
          idempotencyKey: parsed.data.idempotencyKey
        },
        { correlationId: ids.correlationId, idempotencyKey: parsed.data.idempotencyKey }
      );

      const existing = container.outcomeService.getReassessmentByRunId(created.runId);
      if (existing) {
        res.status(200).json({
          ...existing,
          requestId: created.requestId,
          statusUrl: `/v1/analysis-runs/${created.runId}`
        });
        return;
      }

      res.status(202).json({
        reassessmentId: null,
        outcomeId: outcome.outcomeId,
        runId: created.runId,
        requestId: created.requestId,
        judgments: null,
        reportArtifactId: null,
        statusUrl: `/v1/analysis-runs/${created.runId}`,
        createdAt: created.createdAt,
        message: "Outcome reassessment run accepted; poll run status then GET outcome."
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
