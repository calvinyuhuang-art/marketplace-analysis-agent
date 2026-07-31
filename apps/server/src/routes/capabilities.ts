import { Router } from "express";
import type { CapabilitiesResponse, ModelProfilesResponse } from "@maa/contracts";
import type { Container } from "../composition/container";

/**
 * N7: `propose_memory_update` is removed from public OperationType and capability
 * packs. The allow-deprecated header is retained for forward-compat filtering of
 * any future hide-stage ops, but cannot restore a removed operation.
 */
const DEPRECATED_OPS_HEADER = "x-maa-allow-deprecated";

export function capabilityRoutes(container: Container): Router {
  const router = Router();

  router.get("/v1/capabilities", (req, res) => {
    // Header parsed for forward-compat; removed ops are never re-advertised.
    void (req.header(DEPRECATED_OPS_HEADER) ?? "");
    const body: CapabilitiesResponse = {
      capabilities: container.capabilities.map((cap) => ({
        ...cap,
        supportedOperations: [...cap.supportedOperations]
      }))
    };
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
