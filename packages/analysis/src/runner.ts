import { createHash } from "node:crypto";
import type { ArtifactStore } from "@maa/artifacts";
import {
  AnalysisOutputSchema,
  AppError,
  IdPrefix,
  newId,
  type AnalysisArea,
  type AnalysisOutput,
  type EvidenceItem,
  type ProductContext,
  type QualityReport,
  type ReadinessReport
} from "@maa/contracts";
import type {
  AnalysisOutputsRepository,
  ArtifactsRepository,
  FindingsRepository,
  ModelCallsRepository
} from "@maa/database";
import type { ModelProvider } from "@maa/model-router";
import { runQualityGates } from "@maa/quality";
import { coerceAnalysisCandidate } from "./coerce";
import { planAnalysis } from "./planner";
import {
  SYSTEM_RULES_V1,
  buildAnalysisPromptPayload,
  buildRepairPrompt
} from "./prompt";

export interface AnalysisRunnerDeps {
  provider: ModelProvider;
  model: string;
  artifacts: ArtifactsRepository;
  artifactStore: ArtifactStore;
  findings: FindingsRepository;
  outputs: AnalysisOutputsRepository;
  modelCalls: ModelCallsRepository;
  maxRepairAttempts?: number;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  costCapUsd?: number;
}

export interface RunAnalysisInput {
  runId: string;
  requestId: string;
  correlationId?: string;
  operation: string;
  productContext: ProductContext;
  requestedAreas: AnalysisArea[];
  readiness?: ReadinessReport;
  evidenceItems: EvidenceItem[];
  baselineEvidenceItems?: EvidenceItem[];
  compareEvidenceItems?: EvidenceItem[];
  approvedMemory?: import("@maa/contracts").MemoryPromptItem[];
  failureCorrections?: import("@maa/contracts").MemoryPromptItem[];
  proceduralRules?: import("@maa/contracts").ProceduralRulePromptItem[];
  externalKnowledgeSection?: string;
  fixtureKey?: string;
  promptVersion?: string;
}

export interface RunAnalysisResult {
  output: AnalysisOutput;
  quality: QualityReport;
  outputArtifactId: string;
  tokenInput: number;
  tokenOutput: number;
  costUsd: number;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Executes structured analysis with schema validation, optional repair, and
 * deterministic quality gates. Full prompts/responses are stored as artifacts.
 */
export async function runStructuredAnalysis(
  deps: AnalysisRunnerDeps,
  input: RunAnalysisInput
): Promise<RunAnalysisResult> {
  const plan = planAnalysis({
    requestedAreas: input.requestedAreas,
    readiness: input.readiness,
    operation: input.operation,
    fixtureKey: input.fixtureKey
  });

  if (plan.areasToAnalyze.length === 0) {
    const empty: AnalysisOutput = {
      schemaVersion: plan.schemaVersion,
      summary: "No ready analysis areas; skipped model analysis.",
      readyAreasAnalyzed: [],
      blockedAreasSkipped: plan.areasToSkip,
      findings: [],
      assumptions: [],
      unknowns: plan.areasToSkip.map(
        (a) => `Area '${a}' blocked by evidence readiness.`
      ),
      contradictions: [],
      nextActions: ["Fulfill collection requests, then revise."],
      limitations: ["No analysis areas were ready."]
    };
    return persistAccepted(deps, input, empty, {
      passed: true,
      score: 1,
      issues: [],
      evaluatedAt: new Date().toISOString()
    }, 0, 0, 0);
  }

  const promptPayload = buildAnalysisPromptPayload({
    operation: input.operation,
    productContext: input.productContext,
    requestedAreas: input.requestedAreas,
    plan,
    readiness: input.readiness,
    evidenceItems: input.evidenceItems,
    baselineEvidenceItems: input.baselineEvidenceItems,
    compareEvidenceItems: input.compareEvidenceItems,
    approvedMemory: input.approvedMemory,
    failureCorrections: input.failureCorrections,
    proceduralRules: input.proceduralRules,
    externalKnowledgeSection: input.externalKnowledgeSection
  });

  const inputArtifact = deps.artifactStore.writeJson(
    { system: SYSTEM_RULES_V1, payload: promptPayload },
    { subdir: "model-inputs", accessClass: "sensitive" }
  );
  deps.artifacts.insert({
    artifactId: inputArtifact.artifactId,
    relativePath: inputArtifact.relativePath,
    contentHash: inputArtifact.contentHash,
    mimeType: inputArtifact.mimeType,
    sizeBytes: inputArtifact.sizeBytes,
    redactionStatus: inputArtifact.redactionStatus,
    accessClass: inputArtifact.accessClass,
    relatedRequestId: input.requestId,
    relatedRunId: input.runId,
    createdAt: inputArtifact.createdAt
  });

  const maxRepairs = deps.maxRepairAttempts ?? 1;
  let repairAttempt = 0;
  let lastRaw = "";
  let tokenInput = 0;
  let tokenOutput = 0;
  let costUsd = 0;
  let parsed: AnalysisOutput | undefined;
  let lastErrors: string[] = [];

  while (repairAttempt <= maxRepairs) {
    const isRepair = repairAttempt > 0;
    const system = isRepair
      ? buildRepairPrompt(lastRaw, lastErrors).system
      : SYSTEM_RULES_V1;
    const payload = isRepair
      ? buildRepairPrompt(lastRaw, lastErrors).payload
      : promptPayload;

    const startedAt = new Date().toISOString();
    const modelCallId = newId(IdPrefix.modelCall);
    const result = await deps.provider.generateStructured({
      model: deps.model,
      systemInstructions: system,
      promptPayload: payload,
      schemaVersion: plan.schemaVersion,
      temperature: deps.temperature ?? 0,
      maxOutputTokens: deps.maxOutputTokens ?? 4000,
      timeoutMs: deps.timeoutMs ?? 60_000,
      correlationId: input.correlationId,
      fixtureKey: isRepair ? "analysis.v1.repair" : plan.fixtureKey
    });

    tokenInput += result.usage.inputTokens;
    tokenOutput += result.usage.outputTokens;
    costUsd += result.usage.costUsd;
    lastRaw = result.rawResponse;

    if (deps.costCapUsd !== undefined && costUsd > deps.costCapUsd) {
      throw new AppError({
        code: "INTERNAL_ERROR",
        message: `Analysis exceeded cost cap of $${deps.costCapUsd}.`,
        httpStatus: 402
      });
    }

    const outputArtifact = deps.artifactStore.write(
      result.rawResponse,
      { extension: ".json", mimeType: "application/json", subdir: "model-outputs", accessClass: "sensitive" }
    );
    deps.artifacts.insert({
      artifactId: outputArtifact.artifactId,
      relativePath: outputArtifact.relativePath,
      contentHash: outputArtifact.contentHash,
      mimeType: outputArtifact.mimeType,
      sizeBytes: outputArtifact.sizeBytes,
      redactionStatus: outputArtifact.redactionStatus,
      accessClass: outputArtifact.accessClass,
      relatedRequestId: input.requestId,
      relatedRunId: input.runId,
      relatedModelCallId: modelCallId,
      createdAt: outputArtifact.createdAt
    });

    let candidate: unknown = result.data;
    if (candidate === undefined) {
      try {
        candidate = JSON.parse(result.rawResponse);
      } catch {
        candidate = null;
      }
    }

    const validated = AnalysisOutputSchema.safeParse(
      coerceAnalysisCandidate(candidate)
    );
    deps.modelCalls.insert({
      modelCallId,
      runId: input.runId,
      requestId: input.requestId,
      correlationId: input.correlationId ?? null,
      provider: deps.provider.providerId,
      model: deps.model,
      purpose: isRepair ? "analysis_repair" : "analysis",
      fixtureKey: plan.fixtureKey,
      promptVersion: input.promptVersion ?? plan.promptVersion,
      schemaVersion: plan.schemaVersion,
      status: validated.success ? "ok" : "invalid",
      inputArtifactId: inputArtifact.artifactId,
      outputArtifactId: outputArtifact.artifactId,
      tokenInput: result.usage.inputTokens,
      tokenOutput: result.usage.outputTokens,
      costUsd: result.usage.costUsd,
      latencyMs: result.latencyMs,
      validationErrorsJson: validated.success
        ? null
        : JSON.stringify(validated.error.issues.map((i) => i.message)),
      repairAttempt,
      createdAt: startedAt,
      completedAt: new Date().toISOString()
    });

    if (validated.success) {
      parsed = validated.data;
      break;
    }

    lastErrors = validated.error.issues.map(
      (i) => `${i.path.join(".") || "(root)"}: ${i.message}`
    );
    repairAttempt += 1;
  }

  if (!parsed) {
    throw new AppError({
      code: "MODEL_OUTPUT_INVALID",
      message: "Model output failed schema validation after repair attempts.",
      details: lastErrors.map((message) => ({ message }))
    });
  }

  const quality = runQualityGates({
    output: parsed,
    evidenceItems: input.evidenceItems,
    readiness: input.readiness,
    requestedAreas: input.requestedAreas
  });

  if (!quality.passed) {
    // Persist failed quality output for inspection, but do not accept findings.
    const failedArtifact = deps.artifactStore.writeJson(
      { output: parsed, quality },
      { subdir: "analysis-rejected", accessClass: "internal" }
    );
    deps.artifacts.insert({
      artifactId: failedArtifact.artifactId,
      relativePath: failedArtifact.relativePath,
      contentHash: failedArtifact.contentHash,
      mimeType: failedArtifact.mimeType,
      sizeBytes: failedArtifact.sizeBytes,
      redactionStatus: failedArtifact.redactionStatus,
      accessClass: failedArtifact.accessClass,
      relatedRunId: input.runId,
      relatedRequestId: input.requestId,
      createdAt: failedArtifact.createdAt
    });
    deps.outputs.insert({
      outputId: newId(IdPrefix.output),
      runId: input.runId,
      outputType: "analysis_rejected",
      schemaVersion: parsed.schemaVersion,
      artifactId: failedArtifact.artifactId,
      contentHash: failedArtifact.contentHash,
      qualityScore: quality.score,
      qualityPassed: false,
      payloadJson: JSON.stringify({ output: parsed, quality }),
      createdAt: new Date().toISOString()
    });

    throw new AppError({
      code: "MODEL_OUTPUT_INVALID",
      message: "Analysis failed deterministic quality gates.",
      details: quality.issues
        .filter((i) => i.severity === "error")
        .map((i) => ({ message: `${i.code}: ${i.message}` })),
      httpStatus: 422
    });
  }

  // Mark findings system_validated on pass.
  parsed = {
    ...parsed,
    findings: parsed.findings.map((f) => ({
      ...f,
      validationStatus: "system_validated" as const
    }))
  };

  return persistAccepted(
    deps,
    input,
    parsed,
    quality,
    tokenInput,
    tokenOutput,
    costUsd
  );
}

function persistAccepted(
  deps: AnalysisRunnerDeps,
  input: RunAnalysisInput,
  output: AnalysisOutput,
  quality: QualityReport,
  tokenInput: number,
  tokenOutput: number,
  costUsd: number
): RunAnalysisResult {
  const now = new Date().toISOString();
  const artifact = deps.artifactStore.writeJson(output, {
    subdir: "analysis-outputs",
    accessClass: "internal"
  });
  deps.artifacts.insert({
    artifactId: artifact.artifactId,
    relativePath: artifact.relativePath,
    contentHash: artifact.contentHash,
    mimeType: artifact.mimeType,
    sizeBytes: artifact.sizeBytes,
    redactionStatus: artifact.redactionStatus,
    accessClass: artifact.accessClass,
    relatedRunId: input.runId,
    relatedRequestId: input.requestId,
    createdAt: artifact.createdAt
  });

  const outputId = newId(IdPrefix.output);
  deps.outputs.insert({
    outputId,
    runId: input.runId,
    outputType: "analysis",
    schemaVersion: output.schemaVersion,
    artifactId: artifact.artifactId,
    contentHash: sha256(JSON.stringify(output)),
    qualityScore: quality.score,
    qualityPassed: quality.passed,
    payloadJson: JSON.stringify({ output, quality }),
    createdAt: now
  });

  for (const finding of output.findings) {
    deps.findings.insert({
      findingId: finding.findingId,
      runId: input.runId,
      analysisArea: finding.analysisArea,
      classification: finding.classification,
      statement: finding.statement,
      confidence: finding.confidence,
      validationStatus: finding.validationStatus,
      scopeKey: finding.scope.projectId ?? finding.analysisArea,
      freshnessStatus: finding.freshness.status,
      payloadJson: JSON.stringify(finding),
      supersedesFindingId: null,
      supersededByFindingId: null,
      createdAt: now,
      updatedAt: now
    });
  }

  return {
    output,
    quality,
    outputArtifactId: artifact.artifactId,
    tokenInput,
    tokenOutput,
    costUsd
  };
}
