import { Router } from "express";
import {
  AppError,
  CreateAnalysisRequestSchema,
  OperationType
} from "@maa/contracts";
import type { Container } from "../composition/container";
import { getIds } from "../middleware/context";

function rejectFreeChat(body: unknown): void {
  if (!body || typeof body !== "object") return;
  const record = body as Record<string, unknown>;
  const hasChatFields =
    typeof record.message === "string" ||
    typeof record.prompt === "string" ||
    typeof record.chat === "string";
  const operation = record.operation;
  if (hasChatFields && (operation === undefined || typeof operation !== "string")) {
    throw new AppError({
      code: "UNSUPPORTED_CAPABILITY",
      message:
        "The requested operation is outside the supported marketplace-analysis capabilities."
    });
  }
  if (typeof operation === "string") {
    const parsed = OperationType.safeParse(operation);
    if (!parsed.success) {
      throw new AppError({
        code: "UNSUPPORTED_CAPABILITY",
        message:
          "The requested operation is outside the supported marketplace-analysis capabilities.",
        details: [{ path: "operation", message: `Unsupported operation '${operation}'` }]
      });
    }
  }
}

export function analysisRoutes(container: Container): Router {
  const router = Router();

  router.post("/v1/analysis-requests", (req, res, next) => {
    try {
      // Guardrail: reject free-chat / unknown operations before Zod details
      // and before any model provider is touched.
      rejectFreeChat(req.body);

      const parsed = CreateAnalysisRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "Invalid analysis request payload.",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message
          }))
        });
      }

      const ids = getIds(res);
      const headerKey = req.header("idempotency-key") ?? undefined;
      const result = container.analysisService.createAnalysisRequest(parsed.data, {
        correlationId: ids.correlationId,
        idempotencyKey: headerKey ?? parsed.data.idempotencyKey
      });

      container.metrics.increment("analysis_requests_total");
      if (result.reused) {
        container.metrics.increment("analysis_requests_idempotent_reuse");
      }

      res.status(202).json({
        requestId: result.requestId,
        runId: result.runId,
        projectId: result.projectId,
        status: result.status,
        currentPhase: result.currentPhase,
        operation: result.operation,
        correlationId: result.correlationId,
        statusUrl: result.statusUrl,
        createdAt: result.createdAt
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/analysis-requests/:requestId", (req, res, next) => {
    try {
      const body = container.analysisService.getRequest(req.params.requestId!);
      res.status(200).json(body);
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/analysis-runs/:runId", (req, res, next) => {
    try {
      const body = container.analysisService.getRun(req.params.runId!);
      res.status(200).json(body);
    } catch (err) {
      next(err);
    }
  });

  router.post("/v1/analysis-runs/:runId/cancel", (req, res, next) => {
    try {
      const body = container.analysisService.cancelRun(req.params.runId!, {
        type: "client",
        id: typeof req.body?.client === "string" ? req.body.client : "api-client"
      });
      res.status(200).json(body);
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/runs/:runId/events", (req, res, next) => {
    try {
      const events = container.analysisService.listEvents(req.params.runId!);
      res.status(200).json({ events });
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/runs/:runId/audit", (req, res, next) => {
    try {
      const run = container.analysisService.getRun(req.params.runId!);
      const all = container.repos.audit.list(500);
      const events = all.filter((e) => e.runId === run.runId);
      res.status(200).json({ events });
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/analysis-runs/:runId/readiness", (req, res, next) => {
    try {
      const run = container.analysisService.getRun(req.params.runId!);
      const row = container.repos.runReadiness.get(run.runId);
      if (!row) {
        throw new AppError({
          code: "NOT_FOUND",
          message: `No readiness report for run '${run.runId}' yet.`
        });
      }
      res.status(200).json(JSON.parse(row.reportJson));
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/analysis-runs/:runId/collection-requests", (req, res, next) => {
    try {
      const run = container.analysisService.getRun(req.params.runId!);
      const rows = container.repos.collectionRequests.listByRun(run.runId);
      res.status(200).json({
        collectionRequests: rows.map((r) => JSON.parse(r.payloadJson))
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/runs", (_req, res, next) => {
    try {
      res.status(200).json({ runs: container.analysisService.listRecentRuns(50) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
