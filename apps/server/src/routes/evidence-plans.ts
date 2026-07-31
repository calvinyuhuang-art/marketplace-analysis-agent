import { Router } from "express";
import {
  AppError,
  CreateEvidencePlanSchema,
  RegisterCollectorSnapshotSchema,
  ReviewEvidencePlanRequestSchema
} from "@maa/contracts";
import type { Container } from "../composition/container";
import { getIds } from "../middleware/context";

export function evidencePlanRoutes(container: Container): Router {
  const router = Router();

  router.post("/v1/collector-capability-snapshots", (req, res, next) => {
    try {
      const parsed = RegisterCollectorSnapshotSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "Invalid collector capability snapshot.",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message
          }))
        });
      }
      const created = container.evidencePlanService.registerSnapshot(parsed.data);
      container.metrics.increment("collector_snapshots_total");
      container.auditLog.append({
        actorType: "client",
        actorId: parsed.data.collector,
        action: "collector_snapshot.registered",
        targetType: "artifact",
        targetId: created.artifactId,
        after: { contentHash: created.contentHash }
      });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  router.post("/v1/evidence-plans", (req, res, next) => {
    try {
      const parsed = CreateEvidencePlanSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "Invalid evidence plan payload.",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message
          }))
        });
      }
      const created = container.evidencePlanService.createPlan(parsed.data);
      container.metrics.increment("evidence_plans_total");
      container.auditLog.append({
        actorType: "client",
        actorId: parsed.data.client,
        action: "evidence_plan.created",
        targetType: "evidence_plan",
        targetId: created.planId,
        after: {
          planVersion: created.planVersion,
          snapshotArtifactId: created.collectorCapabilitySnapshotArtifactId
        }
      });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/evidence-plans/:planId", (req, res, next) => {
    try {
      const versionRaw = req.query.version;
      const planVersion =
        typeof versionRaw === "string" && versionRaw.length > 0
          ? Number.parseInt(versionRaw, 10)
          : undefined;
      if (planVersion !== undefined && Number.isNaN(planVersion)) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "version must be an integer."
        });
      }
      const plan = container.evidencePlanService.getPlan(req.params.planId!, planVersion);
      res.status(200).json(plan);
    } catch (err) {
      next(err);
    }
  });

  router.post("/v1/evidence-plans/:planId/review", (req, res, next) => {
    try {
      const parsed = ReviewEvidencePlanRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "Invalid evidence plan review request.",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message
          }))
        });
      }

      const plan = container.evidencePlanService.getPlan(req.params.planId!);
      const project = container.repos.projects.getById(plan.projectId);
      const productContext = project
        ? (JSON.parse(project.productContextJson) as {
            name: string;
            description?: string;
            salesGoal: string;
            constraints: string[];
          })
        : {
            name: plan.projectId,
            salesGoal: "Evidence plan review",
            constraints: [] as string[]
          };

      const ids = getIds(res);
      const created = container.analysisService.createAnalysisRequest(
        {
          client: parsed.data.client,
          projectId: plan.projectId,
          operation: "review_evidence_plan",
          capability: plan.capability,
          productContext,
          requestedAnalysis: plan.requestedAnalysis,
          evidencePackageIds: [],
          evidencePlanId: plan.planId,
          evidencePlanVersion: plan.planVersion,
          idempotencyKey: parsed.data.idempotencyKey
        },
        { correlationId: ids.correlationId, idempotencyKey: parsed.data.idempotencyKey }
      );

      // Wait briefly for worker to finish plan review (deterministic, fast).
      // Tests also poll; return 202 with run ids for async clients.
      const existingReview = container.repos.evidencePlanReviews.getByRunId(created.runId);
      if (existingReview) {
        res.status(200).json({
          reviewId: existingReview.reviewId,
          planId: existingReview.planId,
          planVersion: existingReview.planVersion,
          runId: created.runId,
          requestId: created.requestId,
          decision: existingReview.decision,
          report: JSON.parse(existingReview.reportJson),
          reportArtifactId: existingReview.reportArtifactId,
          statusUrl: `/v1/analysis-runs/${created.runId}`,
          createdAt: existingReview.createdAt
        });
        return;
      }

      res.status(202).json({
        reviewId: null,
        planId: plan.planId,
        planVersion: plan.planVersion,
        runId: created.runId,
        requestId: created.requestId,
        decision: null,
        report: null,
        statusUrl: `/v1/analysis-runs/${created.runId}`,
        createdAt: created.createdAt,
        message: "Plan review run accepted; poll run status then GET plan reviews."
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/evidence-plans/:planId/reviews", (req, res, next) => {
    try {
      const plan = container.evidencePlanService.getPlan(req.params.planId!);
      const reviews = container.repos.evidencePlanReviews
        .listByPlan(plan.planId, plan.planVersion)
        .map((r) => ({
          reviewId: r.reviewId,
          planId: r.planId,
          planVersion: r.planVersion,
          runId: r.runId,
          decision: r.decision,
          report: JSON.parse(r.reportJson),
          reportArtifactId: r.reportArtifactId,
          collectorCapabilitySnapshotArtifactId: r.collectorCapabilitySnapshotArtifactId,
          collectorCapabilitySnapshotHash: r.collectorCapabilitySnapshotHash,
          createdAt: r.createdAt
        }));
      res.status(200).json({ planId: plan.planId, planVersion: plan.planVersion, reviews });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
