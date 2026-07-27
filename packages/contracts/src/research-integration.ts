import { z } from "zod";
import { AnalysisArea, RunStatus } from "./enums";
import { EvidencePackageInputSchema } from "./evidence";
import {
  CapabilityRefSchema,
  ProductContextSchema,
  CreateAnalysisRequestSchema
} from "./analysis";

/**
 * Evidence artifact exchange contract for Research Team ↔ MAA.
 * Packages are opaque JSON artifacts; MAA never calls MCEC.
 */
export const EvidenceArtifactEnvelopeSchema = z.object({
  schemaVersion: z.literal("maa-evidence-artifact.v1"),
  artifactId: z.string().min(1),
  producedBy: z.string().min(1).default("research-team"),
  producedAt: z.string().datetime(),
  correlationId: z.string().optional(),
  /** Opaque work-order / task id in Research Team (not a MAA DB key). */
  externalWorkOrderId: z.string().optional(),
  package: EvidencePackageInputSchema
});
export type EvidenceArtifactEnvelope = z.infer<typeof EvidenceArtifactEnvelopeSchema>;

/**
 * Research Team task states derived from MAA run status.
 * Adapter maps only; it never writes MAA SQLite.
 */
export const ResearchTaskState = z.enum([
  "queued",
  "running",
  "needs_orchestrator_decision",
  "ready_for_review",
  "accepted_artifact",
  "failed",
  "cancelled"
]);
export type ResearchTaskState = z.infer<typeof ResearchTaskState>;

export const ResearchTaskViewSchema = z.object({
  externalWorkOrderId: z.string().optional(),
  maaRequestId: z.string(),
  maaRunId: z.string(),
  projectId: z.string(),
  correlationId: z.string().nullable(),
  taskState: ResearchTaskState,
  maaStatus: RunStatus,
  currentPhase: z.string().nullable().optional(),
  readinessOverall: z.string().optional(),
  collectionRequestCount: z.number().int().nonnegative().default(0),
  findingCount: z.number().int().nonnegative().default(0),
  /** When ready_for_review / accepted — pointer to analysis output artifact id if present. */
  analysisArtifactId: z.string().optional(),
  failureCode: z.string().nullable().optional(),
  failureMessage: z.string().nullable().optional(),
  updatedAt: z.string().datetime()
});
export type ResearchTaskView = z.infer<typeof ResearchTaskViewSchema>;

export const ResearchAnalysisBriefSchema = z.object({
  client: z.string().default("research-team"),
  projectId: z.string().min(1),
  externalWorkOrderId: z.string().optional(),
  operation: CreateAnalysisRequestSchema.shape.operation,
  capability: CapabilityRefSchema,
  productContext: ProductContextSchema,
  requestedAnalysis: z.array(AnalysisArea).min(1),
  evidencePackageIds: z.array(z.string().min(1)).min(1),
  idempotencyKey: z.string().min(1).optional(),
  costCapUsd: z.number().nonnegative().optional(),
  question: z.string().optional()
});
export type ResearchAnalysisBrief = z.infer<typeof ResearchAnalysisBriefSchema>;

/** Map durable MAA run status → Research Team task state (pure, no side effects). */
export function mapRunStatusToResearchTaskState(
  status: z.infer<typeof RunStatus>,
  opts?: { hasCollectionRequests?: boolean }
): ResearchTaskState {
  switch (status) {
    case "accepted":
      return "queued";
    case "planning":
    case "recalling_memory":
    case "evaluating_evidence":
    case "analyzing":
    case "reviewing_output":
    case "proposing_memory":
    case "needs_revision":
      return "running";
    case "awaiting_evidence":
    case "evidence_insufficient":
    case "blocked":
      return "needs_orchestrator_decision";
    case "partial":
      return opts?.hasCollectionRequests
        ? "needs_orchestrator_decision"
        : "ready_for_review";
    case "completed":
      return "ready_for_review";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "running";
  }
}
