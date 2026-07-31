import { z } from "zod";

export const ExperienceStatus = z.enum([
  "started",
  "completed",
  "failed",
  "cancelled"
]);
export type ExperienceStatus = z.infer<typeof ExperienceStatus>;

export const AgentExperienceSchema = z.object({
  experienceId: z.string().min(1),
  projectId: z.string().min(1),
  requestId: z.string().min(1),
  runId: z.string().min(1),
  attempt: z.number().int().positive(),
  correlationId: z.string().nullable().optional(),
  operation: z.string().min(1),
  capabilityKey: z.string().nullable().optional(),
  capabilityVersion: z.string().nullable().optional(),
  status: ExperienceStatus,
  evidencePackageIds: z.array(z.string()).default([]),
  contextAssemblyId: z.string().nullable().optional(),
  inputArtifactIds: z.array(z.string()).default([]),
  outputArtifactId: z.string().nullable().optional(),
  tokenInput: z.number().nonnegative().default(0),
  tokenOutput: z.number().nonnegative().default(0),
  costUsd: z.number().nonnegative().default(0),
  summary: z.string().optional(),
  provenanceIncomplete: z.boolean().default(false),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type AgentExperience = z.infer<typeof AgentExperienceSchema>;

export const CaptureExperienceInputSchema = z.object({
  projectId: z.string().min(1),
  requestId: z.string().min(1),
  runId: z.string().min(1),
  attempt: z.number().int().positive().default(1),
  correlationId: z.string().nullable().optional(),
  operation: z.string().min(1),
  capabilityKey: z.string().nullable().optional(),
  capabilityVersion: z.string().nullable().optional(),
  evidencePackageIds: z.array(z.string()).default([]),
  inputArtifactIds: z.array(z.string()).default([]),
  summary: z.string().optional()
});
export type CaptureExperienceInput = z.infer<typeof CaptureExperienceInputSchema>;

export const CompleteExperienceInputSchema = z.object({
  runId: z.string().min(1),
  status: z.enum(["completed", "failed", "cancelled"]),
  contextAssemblyId: z.string().nullable().optional(),
  outputArtifactId: z.string().nullable().optional(),
  tokenInput: z.number().nonnegative().optional(),
  tokenOutput: z.number().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  summary: z.string().optional()
});
export type CompleteExperienceInput = z.infer<typeof CompleteExperienceInputSchema>;
