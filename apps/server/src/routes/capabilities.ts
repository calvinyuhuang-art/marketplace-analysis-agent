import { Router } from "express";
import type { CapabilitiesResponse, ModelProfilesResponse } from "@maa/contracts";
import type { Container } from "../composition/container";

export function capabilityRoutes(container: Container): Router {
  const router = Router();

  router.get("/v1/capabilities", (_req, res) => {
    const body: CapabilitiesResponse = { capabilities: container.capabilities };
    res.status(200).json(body);
  });

  router.get("/v1/model-profiles", (_req, res) => {
    const profiles = container.repos.modelProfiles.list().map((p) => ({
      id: p.profileId,
      provider: p.provider,
      model: p.model,
      enabled: p.enabled,
      description: p.description ?? undefined
    }));
    const body: ModelProfilesResponse = { profiles };
    res.status(200).json(body);
  });

  return router;
}
