import { Router } from "express";
import { AppError } from "@maa/contracts";
import { z } from "zod";
import type { PublishedKnowledgeBridgeService } from "./publishedKnowledgeBridgeService.js";

export function publishedKnowledgeRoutes(deps: {
  service: PublishedKnowledgeBridgeService | null;
}): Router {
  const router = Router();

  function requireService(): PublishedKnowledgeBridgeService {
    if (!deps.service) {
      throw new AppError({
        code: "UNSUPPORTED_OPERATION",
        message: "Published-knowledge bridge is not available."
      });
    }
    return deps.service;
  }

  router.get("/v1/integrations/learning-plane/published-knowledge/status", (_req, res, next) => {
    try {
      const service = requireService();
      res.json(service.getStatus());
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/v1/integrations/learning-plane/published-knowledge/proposals",
    (req, res, next) => {
      try {
        const service = requireService();
        const body = z
          .object({
            memoryId: z.string().min(1),
            scope: z.enum(["agent_group", "agent_private"]).optional(),
            targetAgentHint: z.string().optional(),
            version: z.string().optional(),
            idempotencyKey: z.string().optional()
          })
          .parse(req.body ?? {});
        const result = service.proposeFromMemory(body);
        res.status(result.idempotentReplay ? 200 : 201).json(result);
      } catch (error) {
        next(error);
      }
    }
  );

  router.get(
    "/v1/integrations/learning-plane/published-knowledge/proposals",
    (_req, res, next) => {
      try {
        const service = requireService();
        res.json({ proposals: service.listProposals() });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/v1/integrations/learning-plane/published-knowledge/proposals/:id/reconcile",
    async (req, res, next) => {
      try {
        const service = requireService();
        res.json(await service.reconcileProposal(req.params.id!));
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/v1/integrations/learning-plane/published-knowledge/discover",
    async (req, res, next) => {
      try {
        const service = requireService();
        res.json(await service.discover((req.body ?? {}) as Record<string, unknown>));
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/v1/integrations/learning-plane/published-knowledge/local-references",
    async (req, res, next) => {
      try {
        const service = requireService();
        const body = z
          .object({
            publishedKnowledgeId: z.string().min(1),
            origin: z.enum(["manual", "operator", "uat"]).optional()
          })
          .parse(req.body ?? {});
        const result = await service.fetchAndCreateLocalReference(body);
        res.status(result.idempotentReplay ? 200 : 201).json(result);
      } catch (error) {
        next(error);
      }
    }
  );

  router.get(
    "/v1/integrations/learning-plane/published-knowledge/local-references",
    (_req, res, next) => {
      try {
        const service = requireService();
        res.json({
          references: service.listLocalReferences(),
          notice: "Local references are not adoption and not MAA-owned memory."
        });
      } catch (error) {
        next(error);
      }
    }
  );

  router.delete(
    "/v1/integrations/learning-plane/published-knowledge/local-references/:localReferenceId",
    (req, res, next) => {
      try {
        const service = requireService();
        const body = z
          .object({ reason: z.string().max(500).optional() })
          .parse(req.body ?? {});
        res.json(
          service.deleteLocalReference(req.params.localReferenceId!, body.reason)
        );
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/v1/integrations/learning-plane/published-knowledge/local-references/:id/review",
    async (req, res, next) => {
      try {
        const service = requireService();
        const body = z
          .object({ makeEligible: z.boolean() })
          .parse(req.body ?? {});
        res.json(
          await service.reviewLocalReference({
            localReferenceId: req.params.id!,
            makeEligible: body.makeEligible
          })
        );
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/v1/integrations/learning-plane/published-knowledge/local-references/:id/influence",
    (req, res, next) => {
      try {
        const service = requireService();
        const body = z
          .object({
            runId: z.string().optional(),
            influenceCategory: z.string().min(1).max(64),
            boundedRationale: z.string().max(1024).optional(),
            localCandidateOrProposalRef: z.string().max(256).optional()
          })
          .parse(req.body ?? {});
        res.status(201).json(
          service.recordInfluence({
            localReferenceId: req.params.id!,
            ...body
          })
        );
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/v1/integrations/learning-plane/published-knowledge/challenges",
    (req, res, next) => {
      try {
        const service = requireService();
        const body = z
          .object({
            publishedKnowledgeId: z.string().min(1),
            localReferenceId: z.string().optional(),
            challengeType: z.string().min(1),
            reason: z.string().min(1).max(4000),
            idempotencyKey: z.string().optional()
          })
          .parse(req.body ?? {});
        const result = service.submitChallenge(body);
        res.status(result.idempotentReplay ? 200 : 201).json(result);
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/v1/integrations/learning-plane/published-knowledge/local-references/:id/lifecycle",
    (req, res, next) => {
      try {
        const service = requireService();
        const body = z
          .object({
            catalogState: z.string().min(1),
            freshnessState: z.string().optional()
          })
          .parse(req.body ?? {});
        res.json(
          service.applyLifecycleToReference({
            localReferenceId: req.params.id!,
            ...body
          })
        );
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
