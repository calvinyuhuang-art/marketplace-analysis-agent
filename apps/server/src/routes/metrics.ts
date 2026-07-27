import { Router } from "express";
import { isApiAuthEnabled, type MetricsResponse } from "@maa/contracts";
import type { Container } from "../composition/container";

export function metricsRoutes(container: Container): Router {
  const router = Router();

  router.get("/metrics", (_req, res) => {
    const mem = process.memoryUsage();
    const body: MetricsResponse = {
      service: container.serviceName,
      version: container.serviceVersion,
      uptimeSeconds: (Date.now() - container.startedAt) / 1000,
      process: {
        pid: process.pid,
        nodeVersion: process.version,
        rssBytes: mem.rss,
        heapUsedBytes: mem.heapUsed
      },
      counters: container.metrics.snapshot(),
      latencyMs: container.latency.snapshot(),
      configProfile: container.config.raw.MAA_CONFIG_PROFILE,
      authRequired: isApiAuthEnabled(container.config.raw),
      time: new Date().toISOString()
    };
    res.status(200).json(body);
  });

  return router;
}
