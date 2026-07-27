import { describe, expect, it } from "vitest";
import { AppError, ConfigSchema, ErrorResponseSchema, OperationType } from "./index";

describe("ConfigSchema", () => {
  it("applies defaults for an empty environment", () => {
    const cfg = ConfigSchema.parse({});
    expect(cfg.MAA_PORT).toBe(4320);
    expect(cfg.MAA_DEFAULT_MODEL_PROFILE).toBe("mock-only");
    expect(cfg.MAA_DEEPSEEK_ENABLED).toBe(false);
  });

  it("coerces numeric and boolean strings from process.env", () => {
    const cfg = ConfigSchema.parse({ MAA_PORT: "5000", MAA_DEEPSEEK_ENABLED: "true" });
    expect(cfg.MAA_PORT).toBe(5000);
    expect(cfg.MAA_DEEPSEEK_ENABLED).toBe(true);
  });
});

describe("AppError", () => {
  it("maps codes to default HTTP status and renders the error contract", () => {
    const err = new AppError({ code: "UNSUPPORTED_CAPABILITY", message: "nope" });
    expect(err.httpStatus).toBe(422);
    const body = err.toResponse({ requestId: "req_1", correlationId: "corr_1" });
    expect(() => ErrorResponseSchema.parse(body)).not.toThrow();
    expect(body.error.code).toBe("UNSUPPORTED_CAPABILITY");
    expect(body.error.retryable).toBe(false);
  });
});

describe("OperationType", () => {
  it("rejects operations outside the allowlist", () => {
    expect(OperationType.safeParse("write_marketing_copy").success).toBe(false);
    expect(OperationType.safeParse("full_marketplace_analysis").success).toBe(true);
  });
});
