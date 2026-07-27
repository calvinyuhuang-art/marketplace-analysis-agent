import type { NextFunction, Request, Response } from "express";
import { AppError, isAppError } from "@maa/contracts";
import type { Container } from "../composition/container";
import { getIds } from "./context";

/** 404 handler that renders the canonical error contract. */
export function notFoundHandler() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    next(
      new AppError({
        code: "NOT_FOUND",
        message: `No route for ${req.method} ${req.path}`
      })
    );
  };
}

/**
 * Terminal error middleware. Converts any thrown error into the single error
 * contract, logs it, and never leaks internal details for unexpected errors.
 */
export function errorHandler(container: Container) {
  return (err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    const ids = getIds(res);
    const appError = isAppError(err) ? err : translateError(err);

    const level = appError.httpStatus >= 500 ? "error" : "warn";
    container.loggers.application[level](
      {
        eventType: "request_error",
        requestId: ids.requestId,
        correlationId: ids.correlationId,
        code: appError.code,
        httpStatus: appError.httpStatus,
        err: isAppError(err) ? { message: err.message } : err
      },
      "request failed"
    );
    container.metrics.increment("errors_total");

    if (res.headersSent) return;
    res.status(appError.httpStatus).json(appError.toResponse(ids));
  };
}

/** Map known framework errors (e.g. body-parser) to the canonical contract. */
function translateError(err: unknown): AppError {
  if (err && typeof err === "object" && "type" in err) {
    const type = (err as { type?: string }).type;
    if (type === "entity.too.large") {
      return new AppError({
        code: "PAYLOAD_TOO_LARGE",
        message: "Request body exceeds the configured size limit."
      });
    }
    if (type === "entity.parse.failed") {
      return new AppError({ code: "VALIDATION_ERROR", message: "Request body is not valid JSON." });
    }
  }
  return new AppError({
    code: "INTERNAL_ERROR",
    message: "An unexpected error occurred.",
    cause: err
  });
}
