import { Router } from "express";
import type { Container } from "../composition/container";
import { analysisRoutes } from "./analysis";
import { capabilityRoutes } from "./capabilities";
import { evidenceRoutes } from "./evidence";
import { evidencePlanRoutes } from "./evidence-plans";
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
import { workflowFeedbackRoutes } from "./workflow-feedback";
import { typedProceduralRoutes } from "./typed-procedural";
import { outcomeRoutes } from "./outcomes";
import { learningPlaneIntegrationRoutes } from "../integrations/learning-plane/routes";
import { learningPlaneCallbackRoutes } from "../integrations/learning-plane/callbackRoute";

export function buildRoutes(container: Container): Router {
  const router = Router();
  router.use(healthRoutes(container));
  router.use(readyRoutes(container));
  router.use(metricsRoutes(container));
  router.use(capabilityRoutes(container));
  router.use(projectRoutes(container));
  router.use(evidenceRoutes(container));
  router.use(evidencePlanRoutes(container));
  router.use(analysisRoutes(container));
  router.use(findingsRoutes(container));
  router.use(revisionRoutes(container));
  router.use(memoryRoutes(container));
  router.use(learningRoutes(container));
  router.use(governanceRoutes(container));
  router.use(wikiRoutes(container));
  router.use(workflowFeedbackRoutes(container));
  router.use(typedProceduralRoutes(container));
  router.use(outcomeRoutes(container));
  router.use(adminRoutes(container));
  router.use(learningPlaneIntegrationRoutes(container));
  if (container.learningPlane?.config.enabled) {
    router.use(
      learningPlaneCallbackRoutes({
        config: container.learningPlane.config,
        repo: container.learningPlane.repo,
        secrets: container.learningPlane.secrets,
        reconciliation: container.learningPlane.reconciliation
      })
    );
  }
  return router;
}
