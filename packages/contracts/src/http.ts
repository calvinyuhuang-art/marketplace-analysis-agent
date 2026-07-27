import { z } from "zod";
import { AnalysisArea, OperationType } from "./enums";

/** GET /health */
export const HealthResponseSchema = z.object({
  status: z.enum(["ok", "degraded", "down"]),
  service: z.string(),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  time: z.string().datetime()
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

const ReadinessCheckSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  detail: z.string().optional()
});
export type ReadinessCheck = z.infer<typeof ReadinessCheckSchema>;

/** GET /ready */
export const ReadinessResponseSchema = z.object({
  ready: z.boolean(),
  checks: z.array(ReadinessCheckSchema),
  time: z.string().datetime()
});
export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>;

/** GET /metrics (JSON in V1) */
export const MetricsResponseSchema = z.object({
  service: z.string(),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  process: z.object({
    pid: z.number().int(),
    nodeVersion: z.string(),
    rssBytes: z.number().nonnegative(),
    heapUsedBytes: z.number().nonnegative()
  }),
  counters: z.record(z.string(), z.number()),
  /** Request latency snapshot (ms) when timing middleware is enabled. */
  latencyMs: z
    .object({
      count: z.number().int().nonnegative(),
      avg: z.number().nonnegative(),
      p50: z.number().nonnegative(),
      p95: z.number().nonnegative(),
      max: z.number().nonnegative()
    })
    .optional(),
  configProfile: z.string().optional(),
  authRequired: z.boolean().optional(),
  time: z.string().datetime()
});
export type MetricsResponse = z.infer<typeof MetricsResponseSchema>;

/** GET /v1/capabilities */
export const CapabilitySummarySchema = z.object({
  id: z.string(),
  version: z.string(),
  platform: z.string(),
  marketplace: z.string(),
  category: z.string(),
  productType: z.string(),
  supportedOperations: z.array(OperationType),
  supportedAnalysisAreas: z.array(AnalysisArea)
});
export type CapabilitySummary = z.infer<typeof CapabilitySummarySchema>;

export const CapabilitiesResponseSchema = z.object({
  capabilities: z.array(CapabilitySummarySchema)
});
export type CapabilitiesResponse = z.infer<typeof CapabilitiesResponseSchema>;

/** GET /v1/model-profiles */
export const ModelProfileSummarySchema = z.object({
  id: z.string(),
  provider: z.string(),
  model: z.string(),
  enabled: z.boolean(),
  description: z.string().optional()
});
export type ModelProfileSummary = z.infer<typeof ModelProfileSummarySchema>;

export const ModelProfilesResponseSchema = z.object({
  profiles: z.array(ModelProfileSummarySchema)
});
export type ModelProfilesResponse = z.infer<typeof ModelProfilesResponseSchema>;
