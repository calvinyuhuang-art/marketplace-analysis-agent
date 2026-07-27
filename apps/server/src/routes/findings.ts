import { Router } from "express";
import {
  AppError,
  FindingReviewRequestSchema,
  IdPrefix,
  newId,
  type FindingReviewAction
} from "@maa/contracts";
import { upsertMemoryFromFindingReview } from "@maa/memory";
import type { Container } from "../composition/container";

const ACTION_TO_STATUS: Record<FindingReviewAction, string> = {
  accept: "reviewer_accepted",
  reject: "reviewer_rejected",
  request_revision: "contested",
  mark_contested: "contested"
};

export function findingsRoutes(container: Container): Router {
  const router = Router();

  router.get("/v1/analysis-runs/:runId/findings", (req, res, next) => {
    try {
      const run = container.analysisService.getRun(req.params.runId!);
      const rows = container.repos.findings.listByRun(run.runId);
      res.status(200).json({
        findings: rows.map((row) => ({
          ...(JSON.parse(row.payloadJson) as Record<string, unknown>),
          runId: row.runId,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          validationStatus: row.validationStatus
        }))
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/analysis-runs/:runId/output", (req, res, next) => {
    try {
      const run = container.analysisService.getRun(req.params.runId!);
      const row = container.repos.outputs.getLatestByRun(run.runId);
      if (!row) {
        throw new AppError({
          code: "NOT_FOUND",
          message: `No analysis output for run '${run.runId}' yet.`
        });
      }
      const payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
      res.status(200).json({
        outputId: row.outputId,
        runId: row.runId,
        outputType: row.outputType,
        schemaVersion: row.schemaVersion,
        artifactId: row.artifactId,
        contentHash: row.contentHash,
        qualityScore: row.qualityScore,
        qualityPassed: row.qualityPassed,
        ...payload
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/analysis-runs/:runId/model-calls", (req, res, next) => {
    try {
      const run = container.analysisService.getRun(req.params.runId!);
      const calls = container.repos.modelCalls.listByRun(run.runId);
      res.status(200).json({
        modelCalls: calls.map((c) => ({
          modelCallId: c.modelCallId,
          provider: c.provider,
          model: c.model,
          purpose: c.purpose,
          fixtureKey: c.fixtureKey,
          promptVersion: c.promptVersion,
          schemaVersion: c.schemaVersion,
          status: c.status,
          inputArtifactId: c.inputArtifactId,
          outputArtifactId: c.outputArtifactId,
          tokenInput: c.tokenInput,
          tokenOutput: c.tokenOutput,
          costUsd: c.costUsd,
          latencyMs: c.latencyMs,
          validationErrors: c.validationErrorsJson
            ? (JSON.parse(c.validationErrorsJson) as string[])
            : null,
          repairAttempt: c.repairAttempt,
          createdAt: c.createdAt,
          completedAt: c.completedAt
        }))
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/v1/findings/:findingId/review", (req, res, next) => {
    try {
      const finding = container.repos.findings.getById(req.params.findingId!);
      if (!finding) {
        throw new AppError({
          code: "NOT_FOUND",
          message: `Finding '${req.params.findingId}' was not found.`
        });
      }

      const parsed = FindingReviewRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "Invalid finding review payload.",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message
          }))
        });
      }

      const now = new Date().toISOString();
      const reviewId = newId(IdPrefix.review);
      const validationStatus = ACTION_TO_STATUS[parsed.data.action];

      container.repos.findingReviews.insert({
        reviewId,
        findingId: finding.findingId,
        runId: finding.runId,
        action: parsed.data.action,
        reasonCode: parsed.data.reasonCode ?? null,
        notes: parsed.data.notes ?? null,
        reviewerId: parsed.data.reviewerId,
        createdAt: now
      });
      container.repos.findings.updateValidation(finding.findingId, validationStatus, now);

      const run = container.repos.runs.getById(finding.runId);
      const analysisRequest = run ? container.repos.requests.getById(run.requestId) : undefined;
      const learningEventId = container.revisionService.recordFindingLearningEvent({
        projectId: analysisRequest?.projectId ?? "unknown",
        findingId: finding.findingId,
        runId: finding.runId,
        action: parsed.data.action,
        reasonCode: parsed.data.reasonCode,
        notes: parsed.data.notes
      });

      let learning: unknown = null;
      if (
        analysisRequest &&
        parsed.data.action === "reject"
      ) {
        const project = container.repos.projects.getById(analysisRequest.projectId);
        const payload = JSON.parse(finding.payloadJson) as {
          statement?: string;
          analysisArea?: string;
        };
        learning = container.learningService.recordFindingRejection({
          projectId: analysisRequest.projectId,
          runId: finding.runId,
          findingId: finding.findingId,
          findingStatement: payload.statement ?? finding.statement,
          analysisArea: payload.analysisArea ?? finding.analysisArea,
          reasonCode: parsed.data.reasonCode,
          notes: parsed.data.notes,
          learningEventId,
          platform: project?.platform,
          marketplace: project?.marketplace,
          category: project?.category,
          productType: project?.productType
        });
      }

      if (
        analysisRequest &&
        (parsed.data.action === "accept" || parsed.data.action === "reject")
      ) {
        const project = container.repos.projects.getById(analysisRequest.projectId);
        upsertMemoryFromFindingReview(
          {
            db: container.database.db,
            items: container.repos.memoryItems,
            scopes: container.repos.memoryScopes,
            links: container.repos.memoryLinks
          },
          {
            finding: container.repos.findings.getById(finding.findingId)!,
            projectId: analysisRequest.projectId,
            platform: project?.platform,
            marketplace: project?.marketplace,
            category: project?.category,
            productType: project?.productType,
            productName: project?.name,
            action: parsed.data.action,
            learningEventId
          }
        );
      }

      container.auditLog.append({
        actorType: "reviewer",
        actorId: parsed.data.reviewerId,
        action: "finding.reviewed",
        targetType: "finding",
        targetId: finding.findingId,
        after: {
          action: parsed.data.action,
          reasonCode: parsed.data.reasonCode ?? null,
          validationStatus,
          learningEventId
        },
        runId: finding.runId
      });

      const updated = container.repos.findings.getById(finding.findingId)!;
      res.status(200).json({
        reviewId,
        findingId: finding.findingId,
        runId: finding.runId,
        action: parsed.data.action,
        reasonCode: parsed.data.reasonCode ?? null,
        notes: parsed.data.notes ?? null,
        reviewerId: parsed.data.reviewerId,
        validationStatus: updated.validationStatus,
        learningEventId,
        learning,
        createdAt: now
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
