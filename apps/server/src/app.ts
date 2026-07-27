import cors from "cors";
import express, { type Express } from "express";
import type { Container } from "./composition/container";
import { accessLogMiddleware } from "./middleware/access-log";
import { localAuthMiddleware } from "./middleware/auth";
import { correlationMiddleware } from "./middleware/correlation";
import { errorHandler, notFoundHandler } from "./middleware/error";
import { requestMetricsMiddleware } from "./middleware/request-metrics";
import { buildRoutes } from "./routes/index";

/** Builds the Express application from a fully-wired container. */
export function createApp(container: Container): Express {
  const app = express();
  app.disable("x-powered-by");

  app.use(
    cors({
      origin: container.config.raw.MAA_CONSOLE_ORIGIN,
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "x-correlation-id",
        "Idempotency-Key",
        "Authorization",
        "x-api-key"
      ],
      exposedHeaders: ["x-correlation-id", "x-request-id"]
    })
  );

  app.use(correlationMiddleware());
  app.use(requestMetricsMiddleware(container));
  app.use(accessLogMiddleware(container));
  app.use(express.json({ limit: container.config.raw.MAA_MAX_REQUEST_BYTES }));
  app.use(localAuthMiddleware(container));

  app.use(buildRoutes(container));

  app.use(notFoundHandler());
  app.use(errorHandler(container));

  return app;
}
