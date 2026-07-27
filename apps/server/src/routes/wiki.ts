import { Router } from "express";
import {
  AppError,
  WikiLintRequestSchema,
  WikiProposalReviewRequestSchema
} from "@maa/contracts";
import type { Container } from "../composition/container";

export function wikiRoutes(container: Container): Router {
  const router = Router();

  router.post("/v1/wiki/seed", (_req, res, next) => {
    try {
      const pages = container.wikiService.ensureHierarchy("operator");
      res.status(200).json({ pages });
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/wiki/pages", (_req, res, next) => {
    try {
      container.wikiService.ensureHierarchy();
      res.status(200).json({ pages: container.wikiService.listPages() });
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/wiki/pages/:pageId", (req, res, next) => {
    try {
      const detail = container.wikiService.getPage(req.params.pageId!);
      res.status(200).json(detail);
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/wiki/pages/:pageId/versions", (req, res, next) => {
    try {
      res.status(200).json({
        versions: container.wikiService.listVersions(req.params.pageId!)
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/wiki/proposals", (req, res, next) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const pageId = typeof req.query.pageId === "string" ? req.query.pageId : undefined;
      res.status(200).json({
        proposals: container.wikiService.listProposals({ status, pageId })
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/v1/wiki/proposals/:proposalId/approve", (req, res, next) => {
    try {
      const parsed = WikiProposalReviewRequestSchema.safeParse({
        ...req.body,
        action: "approve"
      });
      if (!parsed.success) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "Invalid wiki proposal approval.",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message
          }))
        });
      }
      const proposal = container.wikiService.reviewProposal({
        proposalId: req.params.proposalId!,
        action: "approve",
        reviewerId: parsed.data.reviewerId,
        notes: parsed.data.notes
      });
      res.status(200).json(proposal);
    } catch (err) {
      if (err instanceof AppError) return next(err);
      next(
        new AppError({
          code: "VALIDATION_ERROR",
          message: err instanceof Error ? err.message : String(err)
        })
      );
    }
  });

  router.post("/v1/wiki/proposals/:proposalId/reject", (req, res, next) => {
    try {
      const parsed = WikiProposalReviewRequestSchema.safeParse({
        ...req.body,
        action: "reject"
      });
      if (!parsed.success) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "Invalid wiki proposal rejection.",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message
          }))
        });
      }
      const proposal = container.wikiService.reviewProposal({
        proposalId: req.params.proposalId!,
        action: "reject",
        reviewerId: parsed.data.reviewerId,
        notes: parsed.data.notes
      });
      res.status(200).json(proposal);
    } catch (err) {
      next(err);
    }
  });

  router.post("/v1/wiki/lint", (req, res, next) => {
    try {
      const parsed = WikiLintRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "Invalid lint request."
        });
      }
      const issues = container.wikiService.lint(parsed.data.pageId);
      res.status(200).json({ issues });
    } catch (err) {
      next(err);
    }
  });

  router.post("/v1/wiki/rebuild", (_req, res, next) => {
    try {
      const proposals = container.wikiService.rebuildFromMemory("operator");
      res.status(200).json({ proposals });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
