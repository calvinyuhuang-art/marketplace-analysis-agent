import { Router } from "express";
import {
  AppError,
  CreateMemoryProposalSchema,
  MemoryProposalReviewRequestSchema
} from "@maa/contracts";
import type { Container } from "../composition/container";

export function governanceRoutes(container: Container): Router {
  const router = Router();

  router.get("/v1/memory-proposals", (req, res, next) => {
    try {
      const projectId =
        typeof req.query.projectId === "string" ? req.query.projectId : undefined;
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      res.status(200).json({
        proposals: container.memoryGovernor.listProposals({ projectId, status })
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/memory-proposals/:proposalId", (req, res, next) => {
    try {
      const proposal = container.memoryGovernor.getProposal(req.params.proposalId!);
      if (!proposal) {
        throw new AppError({
          code: "NOT_FOUND",
          message: `Proposal '${req.params.proposalId}' was not found.`
        });
      }
      res.status(200).json(proposal);
    } catch (err) {
      next(err);
    }
  });

  router.post("/v1/memory-proposals", (req, res, next) => {
    try {
      const parsed = CreateMemoryProposalSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "Invalid memory proposal payload.",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message
          }))
        });
      }
      try {
        const proposal = container.memoryGovernor.createProposal(parsed.data);
        container.auditLog.append({
          actorType: "reviewer",
          actorId: parsed.data.proposedBy,
          action: "memory_proposal.created",
          targetType: "memory_proposal",
          targetId: proposal.proposalId,
          after: {
            status: proposal.status,
            conflictCount: proposal.conflicts.length,
            projectId: proposal.projectId
          }
        });
        res.status(201).json(proposal);
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: err instanceof Error ? err.message : String(err)
        });
      }
    } catch (err) {
      next(err);
    }
  });

  router.post("/v1/memory-proposals/:proposalId/review", (req, res, next) => {
    try {
      const parsed = MemoryProposalReviewRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "Invalid proposal review payload.",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message
          }))
        });
      }
      const proposal = container.memoryGovernor.reviewProposal(
        req.params.proposalId!,
        parsed.data
      );
      container.auditLog.append({
        actorType: "reviewer",
        actorId: parsed.data.reviewerId,
        action: "memory_proposal.reviewed",
        targetType: "memory_proposal",
        targetId: proposal.proposalId,
        after: {
          action: parsed.data.action,
          status: proposal.status,
          resultingMemoryId: proposal.resultingMemoryId ?? null
        }
      });
      res.status(200).json(proposal);
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/reusable-memory", (req, res, next) => {
    try {
      const platform =
        typeof req.query.platform === "string" ? req.query.platform : undefined;
      const marketplace =
        typeof req.query.marketplace === "string" ? req.query.marketplace : undefined;
      const category =
        typeof req.query.category === "string" ? req.query.category : undefined;
      const productType =
        typeof req.query.productType === "string" ? req.query.productType : undefined;
      const rows = container.repos.memoryItems.listReusableApprovedForScope({
        platform,
        marketplace,
        category,
        productType
      });
      res.status(200).json({
        memory: rows.map((row) => {
          const scopes = container.repos.memoryScopes.listForMemory(row.memoryId);
          const links = container.repos.memoryLinks.listForMemory(row.memoryId);
          return {
            memoryId: row.memoryId,
            memoryType: row.memoryType,
            authorityStatus: row.authorityStatus,
            title: row.title,
            statement: row.statement,
            confidence: row.confidence,
            supportCount: row.supportCount,
            contradictionCount: row.contradictionCount,
            validUntil: row.validUntil,
            scopes,
            evidenceIds: links
              .filter((l) => l.targetType === "evidence")
              .map((l) => l.targetId)
          };
        })
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
