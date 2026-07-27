import { ErrorResponseSchema, type ErrorResponse } from "@maa/contracts";

export class MaaClientError extends Error {
  readonly status: number;
  readonly body: ErrorResponse | null;
  readonly correlationId: string | null;
  readonly code: string | null;

  constructor(opts: {
    message: string;
    status: number;
    body?: ErrorResponse | null;
    correlationId?: string | null;
  }) {
    super(opts.message);
    this.name = "MaaClientError";
    this.status = opts.status;
    this.body = opts.body ?? null;
    this.code = opts.body?.error?.code ?? null;
    this.correlationId =
      opts.correlationId ?? opts.body?.error?.correlationId ?? null;
  }
}

export function parseErrorBody(raw: unknown): ErrorResponse | null {
  const parsed = ErrorResponseSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
