import { z } from "zod";
import { AnalysisArea, OperationType, RunStatus } from "./enums";

/**
 * Capability coordinates on a request. These identify which capability pack
 * should apply. They are NOT product defaults — the concrete product, goal,
 * and research direction always come from productContext / upstream.
 */
export const CapabilityRefSchema = z.object({
  platform: z.string().min(1),
  marketplace: z.string().min(1),
  category: z.string().min(1),
  productType: z.string().min(1),
  requestedVersion: z.string().optional()
});
export type CapabilityRef = z.infer<typeof CapabilityRefSchema>;

export const ProductContextSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  salesGoal: z.string().min(1),
  constraints: z.array(z.string()).default([])
});
export type ProductContext = z.infer<typeof ProductContextSchema>;

export const CreateProjectSchema = z.object({
  projectId: z.string().min(1).optional(),
  externalProjectId: z.string().optional(),
  name: z.string().min(1),
  capability: CapabilityRefSchema,
  productContext: ProductContextSchema
});
export type CreateProject = z.infer<typeof CreateProjectSchema>;

export const CreateAnalysisRequestSchema = z
  .object({
    client: z.string().min(1),
    clientRequestId: z.string().optional(),
    projectId: z.string().min(1),
    externalWorkOrderId: z.string().optional(),
    operation: OperationType,
    capability: CapabilityRefSchema,
    productContext: ProductContextSchema,
    requestedAnalysis: z.array(AnalysisArea).min(1),
    question: z.string().optional(),
    /**
     * Opaque evidence package IDs. Existence/normalization is validated in M2;
     * M1 accepts them as references for durable request contracts.
     */
    evidencePackageIds: z.array(z.string().min(1)).min(1),
    modelProfileId: z.string().optional(),
    costCapUsd: z.number().nonnegative().optional(),
    tokenCap: z.number().int().positive().optional(),
    timeoutSeconds: z.number().int().positive().optional(),
    idempotencyKey: z.string().min(1).optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .superRefine((value, ctx) => {
    if (value.operation === "focused_analysis_question" && !value.question) {
      ctx.addIssue({
        code: "custom",
        path: ["question"],
        message: "question is required for focused_analysis_question"
      });
    }
  });
export type CreateAnalysisRequest = z.infer<typeof CreateAnalysisRequestSchema>;

export const ProjectResponseSchema = z.object({
  projectId: z.string(),
  externalProjectId: z.string().nullable(),
  name: z.string(),
  platform: z.string(),
  marketplace: z.string(),
  category: z.string(),
  productType: z.string(),
  productContext: ProductContextSchema,
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type ProjectResponse = z.infer<typeof ProjectResponseSchema>;

export const AnalysisRequestResponseSchema = z.object({
  requestId: z.string(),
  runId: z.string(),
  projectId: z.string(),
  status: RunStatus,
  currentPhase: z.string().nullable(),
  operation: OperationType,
  correlationId: z.string().nullable(),
  statusUrl: z.string(),
  createdAt: z.string()
});
export type AnalysisRequestResponse = z.infer<typeof AnalysisRequestResponseSchema>;

export const AnalysisRunResponseSchema = z.object({
  runId: z.string(),
  requestId: z.string(),
  projectId: z.string(),
  status: RunStatus,
  currentPhase: z.string().nullable(),
  attemptNumber: z.number().int(),
  priorRunId: z.string().nullable().optional(),
  affectedAreas: z.array(AnalysisArea).nullable().optional(),
  executionId: z.string().nullable(),
  correlationId: z.string().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  startedAt: z.string().nullable(),
  heartbeatAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  timeoutAt: z.string().nullable(),
  cancelRequestedAt: z.string().nullable(),
  failureCode: z.string().nullable(),
  failureMessage: z.string().nullable(),
  tokenInput: z.number(),
  tokenOutput: z.number(),
  costUsd: z.number(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type AnalysisRunResponse = z.infer<typeof AnalysisRunResponseSchema>;

export const RunEventResponseSchema = z.object({
  eventId: z.string(),
  runId: z.string().nullable(),
  requestId: z.string().nullable(),
  correlationId: z.string().nullable(),
  eventType: z.string(),
  phase: z.string().nullable(),
  fromStatus: z.string().nullable(),
  toStatus: z.string().nullable(),
  detail: z.unknown().nullable(),
  createdAt: z.string()
});
export type RunEventResponse = z.infer<typeof RunEventResponseSchema>;

export const CancelRunResponseSchema = z.object({
  runId: z.string(),
  status: RunStatus,
  cancelRequestedAt: z.string(),
  message: z.string()
});
export type CancelRunResponse = z.infer<typeof CancelRunResponseSchema>;
