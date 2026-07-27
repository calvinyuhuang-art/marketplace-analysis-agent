import { Router } from "express";
import { AppError } from "@maa/contracts";
import type { Container } from "../composition/container";

export function memoryRoutes(container: Container): Router {
  const router = Router();

  router.get("/v1/projects/:projectId/memory", (req, res, next) => {
    try {
      container.analysisService.getProject(req.params.projectId!);
      const items = container.memoryService.getProjectMemory(req.params.projectId!);
      res.status(200).json({ memory: items });
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/analysis-runs/:runId/memory-retrieval", (req, res, next) => {
    try {
      container.analysisService.getRun(req.params.runId!);
      const events = container.repos.memoryRetrievalEvents.listByRun(req.params.runId!);
      res.status(200).json({
        retrievalEvents: events.map((e) => ({
          retrievalEventId: e.retrievalEventId,
          runId: e.runId,
          projectId: e.projectId,
          query: e.query,
          filters: JSON.parse(e.filtersJson),
          candidates: JSON.parse(e.candidatesJson),
          selectedMemoryIds: JSON.parse(e.selectedJson),
          contextAssemblyId: e.contextAssemblyId,
          createdAt: e.createdAt
        }))
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/analysis-runs/:runId/context-assembly", (req, res, next) => {
    try {
      container.analysisService.getRun(req.params.runId!);
      const row = container.repos.contextAssemblies.getByRun(req.params.runId!);
      if (!row) {
        throw new AppError({
          code: "NOT_FOUND",
          message: `No context assembly for run '${req.params.runId}'.`
        });
      }
      res.status(200).json(JSON.parse(row.payloadJson));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
