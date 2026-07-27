import type { NextFunction, Request, Response } from "express";
import type { Container } from "../composition/container";
import { getIds } from "./context";

/** Emits one JSONL access record per request and updates request counters. */
export function accessLogMiddleware(container: Container) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = process.hrtime.bigint();

    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      const { requestId, correlationId } = getIds(res);
      const statusClass = `${Math.floor(res.statusCode / 100)}xx`;

      container.metrics.increment("http_requests_total");
      container.metrics.increment(`http_responses_${statusClass}`);

      container.loggers.access.info({
        eventType: "http_access",
        requestId,
        correlationId,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 1000) / 1000
      });
    });

    next();
  };
}
