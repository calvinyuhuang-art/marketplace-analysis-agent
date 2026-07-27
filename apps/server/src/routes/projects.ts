import { Router } from "express";
import { AppError, CreateProjectSchema } from "@maa/contracts";
import type { Container } from "../composition/container";
import { getIds } from "../middleware/context";

export function projectRoutes(container: Container): Router {
  const router = Router();

  router.post("/v1/projects", (req, res, next) => {
    try {
      const parsed = CreateProjectSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "Invalid project payload.",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message
          }))
        });
      }
      const project = container.analysisService.createProject(parsed.data);
      res.status(201).json(project);
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/projects", (_req, res, next) => {
    try {
      res.status(200).json({ projects: container.analysisService.listProjects() });
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/projects/:projectId", (req, res, next) => {
    try {
      const project = container.analysisService.getProject(req.params.projectId!);
      res.status(200).json(project);
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/projects/:projectId/runs", (req, res, next) => {
    try {
      const runs = container.analysisService.listRunsForProject(req.params.projectId!);
      res.status(200).json({ runs });
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/projects/:projectId/state", (req, res, next) => {
    try {
      const project = container.analysisService.getProject(req.params.projectId!);
      const runs = container.analysisService.listRunsForProject(req.params.projectId!);
      const { correlationId } = getIds(res);
      res.status(200).json({
        project,
        recentRuns: runs.slice(0, 10),
        correlationId
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
