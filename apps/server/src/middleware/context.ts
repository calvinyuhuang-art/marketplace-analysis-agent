import type { Response } from "express";

export interface RequestIds {
  requestId: string;
  correlationId: string;
}

export function getIds(res: Response): RequestIds {
  return {
    requestId: (res.locals.requestId as string) ?? "unknown",
    correlationId: (res.locals.correlationId as string) ?? "unknown"
  };
}
