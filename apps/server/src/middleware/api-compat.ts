import type { NextFunction, Request, Response } from "express";
import { API_COMPAT_LABEL } from "@maa/contracts";

/** Sets `x-maa-api-compat` on all `/v1/*` responses. */
export function apiCompatMiddleware() {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader("x-maa-api-compat", API_COMPAT_LABEL);
    next();
  };
}
