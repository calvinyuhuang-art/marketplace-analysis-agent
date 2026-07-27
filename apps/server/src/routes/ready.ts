import { accessSync, constants } from "node:fs";
import { Router } from "express";
import type { ReadinessCheck, ReadinessResponse } from "@maa/contracts";
import type { Container } from "../composition/container";

export function readyRoutes(container: Container): Router {
  const router = Router();

  router.get("/ready", (_req, res) => {
    const checks: ReadinessCheck[] = [];

    const dbOk = container.database.healthy();
    checks.push({ name: "database", ok: dbOk, detail: dbOk ? undefined : "query failed" });

    let artifactOk = true;
    let artifactDetail: string | undefined;
    try {
      accessSync(container.artifactStore.rootPath, constants.W_OK);
    } catch {
      artifactOk = false;
      artifactDetail = "artifact root not writable";
    }
    checks.push({ name: "artifact_root", ok: artifactOk, detail: artifactDetail });

    let logOk = true;
    let logDetail: string | undefined;
    try {
      accessSync(container.config.logRoot, constants.W_OK);
    } catch {
      logOk = false;
      logDetail = "log root not writable";
    }
    checks.push({ name: "log_root", ok: logOk, detail: logDetail });

    const ready = checks.every((c) => c.ok);
    const body: ReadinessResponse = {
      ready,
      checks,
      time: new Date().toISOString()
    };
    res.status(ready ? 200 : 503).json(body);
  });

  return router;
}
