import type { NextFunction, Request, Response } from "express";
import { IdPrefix, newId } from "@maa/contracts";

/**
 * Assigns every incoming request a request ID and a correlation ID (reusing an
 * inbound x-correlation-id when present) and echoes both back as response
 * headers so callers can trace work across services.
 */
export function correlationMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const inbound = req.header("x-correlation-id");
    const correlationId =
      inbound && inbound.trim().length > 0 ? inbound.trim() : newId(IdPrefix.correlation);
    const requestId = newId(IdPrefix.request);

    res.locals.correlationId = correlationId;
    res.locals.requestId = requestId;
    res.setHeader("x-correlation-id", correlationId);
    res.setHeader("x-request-id", requestId);
    next();
  };
}
