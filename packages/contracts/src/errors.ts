import { z } from "zod";

/**
 * Stable, machine-readable error codes. Clients (including the Sales OS typed
 * client) may branch on these; do not repurpose an existing code's meaning.
 */
export const ErrorCode = z.enum([
  "VALIDATION_ERROR",
  "UNSUPPORTED_OPERATION",
  "UNSUPPORTED_CAPABILITY",
  "UNSUPPORTED_ANALYSIS_AREA",
  "NOT_FOUND",
  "METHOD_NOT_ALLOWED",
  "PAYLOAD_TOO_LARGE",
  "IDEMPOTENCY_CONFLICT",
  "RATE_LIMITED",
  "CONFIG_INVALID",
  "ARTIFACT_PATH_UNSAFE",
  "MODEL_OUTPUT_INVALID",
  "INVALID_STATE_TRANSITION",
  "RUN_NOT_CANCELLABLE",
  "EVIDENCE_PACKAGE_NOT_FOUND",
  "EVIDENCE_PROVENANCE_INVALID",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "INTERNAL_ERROR"
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorDetailSchema = z.object({
  path: z.string().optional(),
  message: z.string()
});
export type ErrorDetail = z.infer<typeof ErrorDetailSchema>;

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    requestId: z.string().optional(),
    correlationId: z.string().optional(),
    details: z.array(ErrorDetailSchema).default([]),
    retryable: z.boolean().default(false)
  })
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNSUPPORTED_OPERATION: 422,
  UNSUPPORTED_CAPABILITY: 422,
  UNSUPPORTED_ANALYSIS_AREA: 422,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  PAYLOAD_TOO_LARGE: 413,
  IDEMPOTENCY_CONFLICT: 409,
  RATE_LIMITED: 429,
  CONFIG_INVALID: 500,
  ARTIFACT_PATH_UNSAFE: 400,
  MODEL_OUTPUT_INVALID: 502,
  INVALID_STATE_TRANSITION: 409,
  RUN_NOT_CANCELLABLE: 409,
  EVIDENCE_PACKAGE_NOT_FOUND: 404,
  EVIDENCE_PROVENANCE_INVALID: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  INTERNAL_ERROR: 500
};

const DEFAULT_RETRYABLE: Partial<Record<ErrorCode, boolean>> = {
  RATE_LIMITED: true,
  INTERNAL_ERROR: false
};

export interface AppErrorOptions {
  code: ErrorCode;
  message: string;
  httpStatus?: number;
  details?: ErrorDetail[];
  retryable?: boolean;
  cause?: unknown;
}

/**
 * Canonical application error. Any thrown AppError is rendered through the
 * single error contract by the server error middleware.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details: ErrorDetail[];
  readonly retryable: boolean;

  constructor(options: AppErrorOptions) {
    super(options.message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = options.code;
    this.httpStatus = options.httpStatus ?? DEFAULT_STATUS[options.code];
    this.details = options.details ?? [];
    this.retryable = options.retryable ?? DEFAULT_RETRYABLE[options.code] ?? false;
  }

  toResponse(ids?: { requestId?: string; correlationId?: string }): ErrorResponse {
    return {
      error: {
        code: this.code,
        message: this.message,
        requestId: ids?.requestId,
        correlationId: ids?.correlationId,
        details: this.details,
        retryable: this.retryable
      }
    };
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
