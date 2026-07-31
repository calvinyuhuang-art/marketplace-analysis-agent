import { Router } from "express";
import {
  AppError,
  ProposeTypedProceduralVersionRequestSchema,
  TypedProceduralActorRequestSchema,
  TypedProceduralRuleType as RuleTypeSchema
} from "@maa/contracts";
import type { Container } from "../composition/container";

export function typedProceduralRoutes(container: Container): Router {
  const router = Router();

  router.get("/v1/typed-procedural-rules", (_req, res, next) => {
    try {
      res.status(200).json({ rules: container.typedProceduralService.listRules() });
    } catch (err) {
      next(err);
    }
  });

  router.post("/v1/typed-procedural-rules/:ruleType/versions", (req, res, next) => {
    try {
      const ruleTypeParsed = RuleTypeSchema.safeParse(req.params.ruleType);
      if (!ruleTypeParsed.success) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: `Invalid ruleType '${req.params.ruleType}'.`
        });
      }
      const parsed = ProposeTypedProceduralVersionRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "Invalid typed procedural version proposal.",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message
          }))
        });
      }
      const version = container.typedProceduralService.proposeVersion({
        ruleType: ruleTypeParsed.data,
        params: parsed.data.params,
        createdBy: parsed.data.createdBy
      });
      container.auditLog.append({
        actorType: "operator",
        actorId: parsed.data.createdBy,
        action: "typed_procedural.version_proposed",
        targetType: "typed_procedural_version",
        targetId: version.versionId,
        after: { ruleType: version.ruleType, versionNumber: version.versionNumber }
      });
      res.status(201).json(version);
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/typed-procedural-versions/:versionId", (req, res, next) => {
    try {
      res.status(200).json(
        container.typedProceduralService.getVersion(req.params.versionId!)
      );
    } catch (err) {
      next(err);
    }
  });

  router.post("/v1/typed-procedural-versions/:versionId/replay", (req, res, next) => {
    try {
      const version = container.typedProceduralService.replayVersion(req.params.versionId!);
      container.auditLog.append({
        actorType: "system",
        actorId: "typed-procedural",
        action: "typed_procedural.version_replayed",
        targetType: "typed_procedural_version",
        targetId: version.versionId,
        after: { replayReportArtifactId: version.replayReportArtifactId }
      });
      res.status(200).json(version);
    } catch (err) {
      next(err);
    }
  });

  router.post("/v1/typed-procedural-versions/:versionId/approve", (req, res, next) => {
    try {
      const parsed = TypedProceduralActorRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "Invalid typed procedural approve payload.",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message
          }))
        });
      }
      container.learningPlane?.governanceBridge?.assertLocalApproveAllowed(
        req.params.versionId!
      );
      const version = container.typedProceduralService.approveVersion({
        versionId: req.params.versionId!,
        actorId: parsed.data.actorId
      });
      container.auditLog.append({
        actorType: "operator",
        actorId: parsed.data.actorId,
        action: "typed_procedural.version_approved",
        targetType: "typed_procedural_version",
        targetId: version.versionId
      });
      res.status(200).json(version);
    } catch (err) {
      next(err);
    }
  });

  router.post("/v1/typed-procedural-versions/:versionId/activate", (req, res, next) => {
    try {
      const parsed = TypedProceduralActorRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "Invalid typed procedural activate payload.",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message
          }))
        });
      }
      container.learningPlane?.governanceBridge?.assertActivationAllowed(
        req.params.versionId!
      );
      const activation = container.typedProceduralService.activateVersion({
        versionId: req.params.versionId!,
        actorId: parsed.data.actorId,
        reason: parsed.data.reason
      });
      container.learningPlane?.governanceBridge?.captureActivationReceipt({
        versionId: activation.versionId,
        activationId: activation.activationId,
        result: "activated"
      });
      container.auditLog.append({
        actorType: "operator",
        actorId: parsed.data.actorId,
        action: "typed_procedural.version_activated",
        targetType: "typed_procedural_version",
        targetId: activation.versionId,
        after: { activationId: activation.activationId, action: activation.action }
      });
      res.status(200).json(activation);
    } catch (err) {
      next(err);
    }
  });

  router.post("/v1/typed-procedural-versions/:versionId/rollback", (req, res, next) => {
    try {
      const parsed = TypedProceduralActorRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "Invalid typed procedural rollback payload.",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message
          }))
        });
      }
      const activation = container.typedProceduralService.rollbackToVersion({
        versionId: req.params.versionId!,
        actorId: parsed.data.actorId,
        reason: parsed.data.reason
      });
      container.learningPlane?.governanceBridge?.captureRollbackReceipt({
        versionId: activation.versionId,
        activationId: activation.activationId,
        result: "rolled_back"
      });
      container.auditLog.append({
        actorType: "operator",
        actorId: parsed.data.actorId,
        action: "typed_procedural.version_rolled_back",
        targetType: "typed_procedural_version",
        targetId: activation.versionId,
        after: {
          activationId: activation.activationId,
          replacesActivationId: activation.replacesActivationId
        }
      });
      res.status(200).json(activation);
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/v1/typed-procedural-versions/:versionId/share-to-learning-plane",
    (req, res, next) => {
      try {
        if (!container.learningPlane?.governanceBridge) {
          throw new AppError({
            code: "UNSUPPORTED_OPERATION",
            message: "Learning Plane governance bridge is unavailable."
          });
        }
        const result =
          container.learningPlane.governanceBridge.shareVersionToLearningPlane(
            req.params.versionId!
          );
        container.auditLog.append({
          actorType: "operator",
          actorId: "maa-operator",
          action: "typed_procedural.shared_to_learning_plane",
          targetType: "typed_procedural_version",
          targetId: req.params.versionId!,
          after: {
            outboxId: result.outboxId,
            governanceOrigin: result.link.governance_origin,
            approvalDoesNotActivate: true
          }
        });
        res.status(202).json({
          versionId: req.params.versionId,
          governanceOrigin: result.link.governance_origin,
          submissionStatus: result.link.submission_status,
          outboxId: result.outboxId,
          idempotentReplay: result.idempotentReplay,
          approvalDoesNotActivate: true
        });
      } catch (err) {
        next(err);
      }
    }
  );

  router.get(
    "/v1/typed-procedural-versions/:versionId/bridge-status",
    (req, res, next) => {
      try {
        if (!container.learningPlane?.governanceBridge) {
          res.status(200).json({
            versionId: req.params.versionId,
            governanceOrigin: "local_only",
            bridgeAvailable: false
          });
          return;
        }
        res.status(200).json({
          ...container.learningPlane.governanceBridge.getBridgeStatus(
            req.params.versionId!
          ),
          bridgeAvailable: true
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
