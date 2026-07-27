import { Router } from "express";
import { AppError, EvidencePackageInputSchema } from "@maa/contracts";
import { evaluateReadiness } from "@maa/capability-amazon-kdp";
import type { AnalysisArea } from "@maa/contracts";
import type { Container } from "../composition/container";

export function evidenceRoutes(container: Container): Router {
  const router = Router();

  router.post("/v1/evidence-packages", (req, res, next) => {
    try {
      const parsed = EvidencePackageInputSchema.safeParse(req.body);
      if (!parsed.success) {
        const provenanceIssue = parsed.error.issues.find((i) =>
          i.path.includes("provenance")
        );
        throw new AppError({
          code: provenanceIssue ? "EVIDENCE_PROVENANCE_INVALID" : "VALIDATION_ERROR",
          message: provenanceIssue
            ? "Evidence item provenance is missing required fields."
            : "Invalid evidence package payload.",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message
          }))
        });
      }
      const created = container.evidenceService.register(parsed.data);
      container.metrics.increment("evidence_packages_total");
      container.auditLog.append({
        actorType: "client",
        actorId: parsed.data.sourceClient,
        action: "evidence_package.registered",
        targetType: "evidence_package",
        targetId: created.packageId,
        after: { itemCount: created.itemCount, contentHash: created.contentHash }
      });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/evidence-packages", (_req, res, next) => {
    try {
      res.status(200).json({ packages: container.evidenceService.listPackages() });
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/evidence-packages/:packageId", (req, res, next) => {
    try {
      const pkg = container.evidenceService.getPackage(req.params.packageId!);
      res.status(200).json(pkg);
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/evidence-packages/:packageId/items", (req, res, next) => {
    try {
      const items = container.evidenceService.getItems(req.params.packageId!);
      res.status(200).json({ items });
    } catch (err) {
      next(err);
    }
  });

  router.post("/v1/evidence-packages/:packageId/validate", (req, res, next) => {
    try {
      const pkg = container.evidenceService.getPackage(req.params.packageId!);
      const items = container.evidenceService.getItems(req.params.packageId!);
      res.status(200).json({
        packageId: pkg.packageId,
        valid: true,
        itemCount: items.length,
        coverageSummary: pkg.coverageSummary
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/v1/evidence-packages/:packageId/readiness", (req, res, next) => {
    try {
      const pkg = container.evidenceService.getPackage(req.params.packageId!);
      const items = container.evidenceService.getItems(req.params.packageId!);
      const areasParam = typeof req.query.areas === "string" ? req.query.areas : "";
      const requestedAreas = (
        areasParam
          ? areasParam.split(",").map((s) => s.trim()).filter(Boolean)
          : [
              "market_structure",
              "competitor_set",
              "customer_evidence",
              "pricing",
              "positioning",
              "keywords_categories",
              "risk_ip_policy"
            ]
      ) as AnalysisArea[];

      const report = evaluateReadiness({
        items,
        requestedAreas,
        packageIds: [pkg.packageId],
        platform: pkg.platform,
        marketplace: pkg.marketplace
      });
      res.status(200).json(report);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
