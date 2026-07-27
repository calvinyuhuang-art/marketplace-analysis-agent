import { Router } from "express";
import type { Container } from "../composition/container";
import { analysisRoutes } from "./analysis";
import { capabilityRoutes } from "./capabilities";
import { evidenceRoutes } from "./evidence";
import { findingsRoutes } from "./findings";
import { healthRoutes } from "./health";
import { memoryRoutes } from "./memory";
import { metricsRoutes } from "./metrics";
import { projectRoutes } from "./projects";
import { readyRoutes } from "./ready";
import { revisionRoutes } from "./revision";
import { learningRoutes } from "./learning";
import { governanceRoutes } from "./governance";
import { wikiRoutes } from "./wiki";
import { adminRoutes } from "./admin";

export function buildRoutes(container: Container): Router {
  const router = Router();
  router.use(healthRoutes(container));
  router.use(readyRoutes(container));
  router.use(metricsRoutes(container));
  router.use(capabilityRoutes(container));
  router.use(projectRoutes(container));
  router.use(evidenceRoutes(container));
  router.use(analysisRoutes(container));
  router.use(findingsRoutes(container));
  router.use(revisionRoutes(container));
  router.use(memoryRoutes(container));
  router.use(learningRoutes(container));
  router.use(governanceRoutes(container));
  router.use(wikiRoutes(container));
  router.use(adminRoutes(container));
  return router;
}
