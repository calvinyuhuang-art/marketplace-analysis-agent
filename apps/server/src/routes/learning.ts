import { Router } from "express";
import {
  AppError,
  LessonReviewRequestSchema,
  MemoryEvaluationRequestSchema,
  OutcomeReviewRequestSchema,
  ProceduralRuleReviewRequestSchema
} from "@maa/contracts";
import type { Container } from "../composition/container";

export function learningRoutes(container: Container): Router {
  const router = Router();

  router.get("/v1/error-book", (req, res, next) => {
    try {
      const projectId =
        typeof req.query.projectId === "string" ? req.query.projectId : undefined;
      const errorClass =
        typeof req.query.errorClass === "string" ? req.query.errorClass : undefined;
      res.status(200).json({
        entries: container.learningService.listErrorBook({ projectId, errorClass })
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/error-book/:entryId", (req, res, next) => {
    try {
      const entry = container.repos.errorBook.getById(req.params.entryId!);
      if (!entry) {
        throw new AppError({
          code: "NOT_FOUND",
          message: `Error Book entry '${req.params.entryId}' was not found.`
        });
      }
      const listed = container.learningService
        .listErrorBook({})
        .find((e) => e.errorBookEntryId === entry.errorBookEntryId);
      res.status(200).json(listed);
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/projects/:projectId/lessons", (req, res, next) => {
    try {
      res.status(200).json({
        lessons: container.learningService.listLessons(req.params.projectId!)
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/v1/lessons/:lessonId/review", (req, res, next) => {
    try {
      const parsed = LessonReviewRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "Invalid lesson review payload.",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message
          }))
        });
      }
      const lesson = container.learningService.reviewLesson({
        lessonCandidateId: req.params.lessonId!,
        action: parsed.data.action,
        reviewerId: parsed.data.reviewerId,
        activateProceduralRule: parsed.data.activateProceduralRule
      });
      container.auditLog.append({
        actorType: "reviewer",
        actorId: parsed.data.reviewerId,
        action: "lesson.reviewed",
        targetType: "lesson_candidate",
        targetId: lesson.lessonCandidateId,
        after: { action: parsed.data.action, status: lesson.status }
      });
      res.status(200).json(lesson);
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/procedural-rules", (req, res, next) => {
    try {
      const projectId =
        typeof req.query.projectId === "string" ? req.query.projectId : undefined;
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      res.status(200).json({
        rules: container.learningService.listProceduralRules({ projectId, status })
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/v1/procedural-rules/:ruleId/review", (req, res, next) => {
    try {
      const parsed = ProceduralRuleReviewRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "Invalid procedural rule review payload.",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message
          }))
        });
      }
      const rule = container.learningService.reviewProceduralRule({
        proceduralRuleId: req.params.ruleId!,
        action: parsed.data.action,
        reviewerId: parsed.data.reviewerId
      });
      container.auditLog.append({
        actorType: "reviewer",
        actorId: parsed.data.reviewerId,
        action: "procedural_rule.reviewed",
        targetType: "procedural_rule",
        targetId: rule.proceduralRuleId,
        after: { action: parsed.data.action, status: rule.status, authority: rule.authority }
      });
      res.status(200).json(rule);
    } catch (err) {
      next(err);
    }
  });

  router.post("/v1/analysis-runs/:runId/outcome-review", (req, res, next) => {
    try {
      const run = container.analysisService.getRun(req.params.runId!);
      const request = container.repos.requests.getById(run.requestId);
      const parsed = OutcomeReviewRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "Invalid outcome review payload.",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message
          }))
        });
      }
      const review = container.learningService.recordOutcomeReview({
        projectId: request?.projectId ?? "unknown",
        runId: run.runId,
        judgment: parsed.data.judgment,
        notes: parsed.data.notes,
        reviewerId: parsed.data.reviewerId,
        proposeLesson: parsed.data.proposeLesson
      });
      res.status(201).json(review);
    } catch (err) {
      next(err);
    }
  });

  router.post("/v1/memory-evaluations", (req, res, next) => {
    try {
      const parsed = MemoryEvaluationRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "Invalid memory evaluation payload.",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message
          }))
        });
      }
      const mem = container.repos.memoryItems.getById(parsed.data.memoryId);
      if (!mem) {
        throw new AppError({
          code: "NOT_FOUND",
          message: `Memory '${parsed.data.memoryId}' was not found.`
        });
      }
      const projectId =
        container.repos.memoryScopes
          .listForMemory(mem.memoryId)
          .find((s) => s.dimension === "project")?.value ?? "unknown";
      const evaluation = container.learningService.recordMemoryEvaluation({
        memoryId: parsed.data.memoryId,
        projectId,
        runId: parsed.data.runId,
        judgment: parsed.data.judgment,
        notes: parsed.data.notes,
        reviewerId: parsed.data.reviewerId
      });
      res.status(201).json(evaluation);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
