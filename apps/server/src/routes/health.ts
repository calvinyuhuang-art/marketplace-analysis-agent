import { Router } from "express";
import type { HealthResponse } from "@maa/contracts";
import type { Container } from "../composition/container";

export function healthRoutes(container: Container): Router {
  const router = Router();

  router.get("/health", (_req, res) => {
    const body: HealthResponse = {
      status: "ok",
      service: container.serviceName,
      version: container.serviceVersion,
      uptimeSeconds: (Date.now() - container.startedAt) / 1000,
      time: new Date().toISOString()
    };
    res.status(200).json(body);
  });

  return router;
}
