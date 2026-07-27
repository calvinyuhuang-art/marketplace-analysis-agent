import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { AppError, isApiAuthEnabled } from "@maa/contracts";
import type { Container } from "../composition/container";

function extractApiKey(req: Request): string | undefined {
  const header = req.header("authorization");
  if (header) {
    const m = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (m?.[1]) return m[1].trim();
  }
  const xApiKey = req.header("x-api-key");
  if (xApiKey && xApiKey.trim().length > 0) return xApiKey.trim();
  return undefined;
}

function keysEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Paths that remain reachable without a local API key (probes only). */
export function isPublicPath(path: string): boolean {
  return path === "/health" || path === "/ready";
}

/**
 * Local API authentication. When auth is enabled (API key configured or
 * MAA_REQUIRE_API_KEY), all non-public routes require Bearer / x-api-key.
 */
export function localAuthMiddleware(container: Container) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const config = container.config.raw;
      const authEnabled = isApiAuthEnabled(config);
      const path = req.path;

      if (!authEnabled) {
        if (config.MAA_REQUIRE_API_KEY) {
          throw new AppError({
            code: "CONFIG_INVALID",
            message: "MAA_REQUIRE_API_KEY is set but MAA_API_KEY is empty.",
            httpStatus: 503
          });
        }
        next();
        return;
      }

      if (isPublicPath(path)) {
        next();
        return;
      }

      const expected = config.MAA_API_KEY.trim();
      if (!expected) {
        container.metrics.increment("auth_misconfigured_total");
        throw new AppError({
          code: "CONFIG_INVALID",
          message: "API authentication is required but MAA_API_KEY is not configured.",
          httpStatus: 503
        });
      }

      const provided = extractApiKey(req);
      if (!provided || !keysEqual(provided, expected)) {
        container.metrics.increment("auth_failures_total");
        throw new AppError({
          code: "UNAUTHORIZED",
          message: "Valid local API key required (Authorization: Bearer or x-api-key)."
        });
      }

      container.metrics.increment("auth_success_total");
      res.locals.authenticated = true;
      next();
    } catch (err) {
      next(err);
    }
  };
}
