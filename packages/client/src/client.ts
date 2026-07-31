import {
  AnalysisRequestResponseSchema,
  AnalysisRunResponseSchema,
  CreateAnalysisRequestSchema,
  CreateProjectSchema,
  CreateRevisionRequestSchema,
  EvidencePackageInputSchema,
  FindingReviewRequestSchema,
  HealthResponseSchema,
  ProjectResponseSchema,
  ReadinessResponseSchema,
  RevisionResponseSchema,
  RunReviewRequestSchema,
  type AnalysisRequestResponse,
  type AnalysisRunResponse,
  type CreateAnalysisRequest,
  type CreateProject,
  type CreateRevisionRequest,
  type EvidencePackageInput,
  type FindingReviewRequest,
  type HealthResponse,
  type ProjectResponse,
  type ReadinessResponse,
  type RevisionResponse,
  type RunReviewRequest
} from "@maa/contracts";
import { MaaClientError, parseErrorBody } from "./errors.js";
import {
  httpJson,
  type MarketplaceAnalysisClientOptions,
  type RequestOptions
} from "./http.js";
import { pollUntil, type PollOptions } from "./poll.js";

function assertOk<T>(
  status: number,
  data: unknown,
  expected: number | number[],
  correlationId: string | null
): T {
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(status)) {
    const errBody = parseErrorBody(data);
    throw new MaaClientError({
      message:
        errBody?.error?.message ??
        `MAA request failed with HTTP ${status}`,
      status,
      body: errBody,
      correlationId: correlationId ?? errBody?.error?.correlationId ?? null
    });
  }
  return data as T;
}

/**
 * Typed HTTP client for Marketplace Analysis Agent.
 * Never reads or writes the MAA database — API only.
 *
 * Compatibility (N7 / service ≥ 0.17.0):
 * - Expects `x-maa-api-compat: 2026.07` on `/v1/*` responses.
 * - Do not send `propose_memory_update` (removed public op → use `/v1/memory-proposals`).
 * - See `MIN_SERVER_VERSION` from `@maa/client`.
 */
export class MarketplaceAnalysisClient {
  constructor(private readonly opts: MarketplaceAnalysisClientOptions) {}

  async health(requestOpts?: RequestOptions): Promise<HealthResponse> {
    const res = await httpJson<unknown>(this.opts, "GET", "/health", undefined, requestOpts);
    const data = assertOk<unknown>(res.status, res.data, 200, res.correlationId);
    return HealthResponseSchema.parse(data);
  }

  async ready(requestOpts?: RequestOptions): Promise<ReadinessResponse> {
    const res = await httpJson<unknown>(this.opts, "GET", "/ready", undefined, requestOpts);
    const data = assertOk<unknown>(res.status, res.data, 200, res.correlationId);
    return ReadinessResponseSchema.parse(data);
  }

  async createProject(
    input: CreateProject,
    requestOpts?: RequestOptions
  ): Promise<ProjectResponse> {
    const body = CreateProjectSchema.parse(input);
    const res = await httpJson<unknown>(
      this.opts,
      "POST",
      "/v1/projects",
      body,
      requestOpts
    );
    const data = assertOk<unknown>(res.status, res.data, [200, 201], res.correlationId);
    return ProjectResponseSchema.parse(data);
  }

  async registerEvidencePackage(
    input: EvidencePackageInput,
    requestOpts?: RequestOptions
  ): Promise<{ packageId: string; itemCount: number; contentHash?: string }> {
    const body = EvidencePackageInputSchema.parse(input);
    const res = await httpJson<{
      packageId: string;
      itemCount: number;
      contentHash?: string;
    }>(this.opts, "POST", "/v1/evidence-packages", body, requestOpts);
    return assertOk(res.status, res.data, 201, res.correlationId);
  }

  /**
   * Submit analysis request. Expects HTTP 202 Accepted.
   */
  async createAnalysis(
    input: CreateAnalysisRequest,
    requestOpts?: RequestOptions
  ): Promise<AnalysisRequestResponse> {
    const body = CreateAnalysisRequestSchema.parse(input);
    const res = await httpJson<unknown>(this.opts, "POST", "/v1/analysis-requests", body, {
      ...requestOpts,
      idempotencyKey: requestOpts?.idempotencyKey ?? body.idempotencyKey
    });
    const data = assertOk<unknown>(res.status, res.data, 202, res.correlationId);
    return AnalysisRequestResponseSchema.parse(data);
  }

  async getAnalysisRequest(
    requestId: string,
    requestOpts?: RequestOptions
  ): Promise<AnalysisRequestResponse> {
    const res = await httpJson<unknown>(
      this.opts,
      "GET",
      `/v1/analysis-requests/${encodeURIComponent(requestId)}`,
      undefined,
      requestOpts
    );
    const data = assertOk<unknown>(res.status, res.data, 200, res.correlationId);
    return AnalysisRequestResponseSchema.parse(data);
  }

  async getRun(
    runId: string,
    requestOpts?: RequestOptions
  ): Promise<AnalysisRunResponse> {
    const res = await httpJson<unknown>(
      this.opts,
      "GET",
      `/v1/analysis-runs/${encodeURIComponent(runId)}`,
      undefined,
      requestOpts
    );
    const data = assertOk<unknown>(res.status, res.data, 200, res.correlationId);
    return AnalysisRunResponseSchema.parse(data);
  }

  async getReadiness(runId: string, requestOpts?: RequestOptions): Promise<unknown> {
    const res = await httpJson<unknown>(
      this.opts,
      "GET",
      `/v1/analysis-runs/${encodeURIComponent(runId)}/readiness`,
      undefined,
      requestOpts
    );
    return assertOk(res.status, res.data, 200, res.correlationId);
  }

  async getCollectionRequests(
    runId: string,
    requestOpts?: RequestOptions
  ): Promise<{ collectionRequests: unknown[] }> {
    const res = await httpJson<{ collectionRequests: unknown[] }>(
      this.opts,
      "GET",
      `/v1/analysis-runs/${encodeURIComponent(runId)}/collection-requests`,
      undefined,
      requestOpts
    );
    return assertOk(res.status, res.data, 200, res.correlationId);
  }

  async getFindings(
    runId: string,
    requestOpts?: RequestOptions
  ): Promise<{ findings: unknown[] }> {
    const res = await httpJson<{ findings: unknown[] }>(
      this.opts,
      "GET",
      `/v1/analysis-runs/${encodeURIComponent(runId)}/findings`,
      undefined,
      requestOpts
    );
    return assertOk(res.status, res.data, 200, res.correlationId);
  }

  async getOutput(runId: string, requestOpts?: RequestOptions): Promise<unknown> {
    const res = await httpJson<unknown>(
      this.opts,
      "GET",
      `/v1/analysis-runs/${encodeURIComponent(runId)}/output`,
      undefined,
      requestOpts
    );
    return assertOk(res.status, res.data, 200, res.correlationId);
  }

  async reviewFinding(
    findingId: string,
    input: FindingReviewRequest,
    requestOpts?: RequestOptions
  ): Promise<unknown> {
    const body = FindingReviewRequestSchema.parse(input);
    const res = await httpJson<unknown>(
      this.opts,
      "POST",
      `/v1/findings/${encodeURIComponent(findingId)}/review`,
      body,
      requestOpts
    );
    return assertOk(res.status, res.data, [200, 201], res.correlationId);
  }

  async reviewRun(
    runId: string,
    input: RunReviewRequest,
    requestOpts?: RequestOptions
  ): Promise<unknown> {
    const body = RunReviewRequestSchema.parse(input);
    const res = await httpJson<unknown>(
      this.opts,
      "POST",
      `/v1/analysis-runs/${encodeURIComponent(runId)}/review`,
      body,
      requestOpts
    );
    return assertOk(res.status, res.data, [200, 201], res.correlationId);
  }

  async revise(
    runId: string,
    input: CreateRevisionRequest,
    requestOpts?: RequestOptions
  ): Promise<RevisionResponse> {
    const body = CreateRevisionRequestSchema.parse(input);
    const res = await httpJson<unknown>(
      this.opts,
      "POST",
      `/v1/analysis-runs/${encodeURIComponent(runId)}/revise`,
      body,
      {
        ...requestOpts,
        idempotencyKey: requestOpts?.idempotencyKey ?? body.idempotencyKey
      }
    );
    const data = assertOk<unknown>(res.status, res.data, 202, res.correlationId);
    return RevisionResponseSchema.parse(data);
  }

  async cancelRun(runId: string, requestOpts?: RequestOptions): Promise<unknown> {
    const res = await httpJson<unknown>(
      this.opts,
      "POST",
      `/v1/analysis-runs/${encodeURIComponent(runId)}/cancel`,
      {},
      requestOpts
    );
    return assertOk(res.status, res.data, [200, 202], res.correlationId);
  }

  async getRunExperience(
    runId: string,
    requestOpts?: RequestOptions
  ): Promise<Record<string, unknown>> {
    const res = await httpJson<Record<string, unknown>>(
      this.opts,
      "GET",
      `/v1/analysis-runs/${encodeURIComponent(runId)}/experience`,
      undefined,
      requestOpts
    );
    return assertOk(res.status, res.data, 200, res.correlationId);
  }

  async listExperienceEvaluations(
    experienceId: string,
    requestOpts?: RequestOptions
  ): Promise<{ experienceId: string; evaluations: unknown[] }> {
    const res = await httpJson<{ experienceId: string; evaluations: unknown[] }>(
      this.opts,
      "GET",
      `/v1/experiences/${encodeURIComponent(experienceId)}/evaluations`,
      undefined,
      requestOpts
    );
    return assertOk(res.status, res.data, 200, res.correlationId);
  }

  async registerCollectorSnapshot(
    input: Record<string, unknown>,
    requestOpts?: RequestOptions
  ): Promise<{ artifactId: string; contentHash: string }> {
    const res = await httpJson<{ artifactId: string; contentHash: string }>(
      this.opts,
      "POST",
      "/v1/collector-capability-snapshots",
      input,
      requestOpts
    );
    return assertOk(res.status, res.data, 201, res.correlationId);
  }

  async createEvidencePlan(
    input: Record<string, unknown>,
    requestOpts?: RequestOptions
  ): Promise<Record<string, unknown>> {
    const res = await httpJson<Record<string, unknown>>(
      this.opts,
      "POST",
      "/v1/evidence-plans",
      input,
      requestOpts
    );
    return assertOk(res.status, res.data, 201, res.correlationId);
  }

  async getEvidencePlan(
    planId: string,
    requestOpts?: RequestOptions & { version?: number }
  ): Promise<Record<string, unknown>> {
    const q =
      requestOpts?.version !== undefined ? `?version=${requestOpts.version}` : "";
    const res = await httpJson<Record<string, unknown>>(
      this.opts,
      "GET",
      `/v1/evidence-plans/${encodeURIComponent(planId)}${q}`,
      undefined,
      requestOpts
    );
    return assertOk(res.status, res.data, 200, res.correlationId);
  }

  async reviewEvidencePlan(
    planId: string,
    input: Record<string, unknown> = {},
    requestOpts?: RequestOptions
  ): Promise<Record<string, unknown>> {
    const res = await httpJson<Record<string, unknown>>(
      this.opts,
      "POST",
      `/v1/evidence-plans/${encodeURIComponent(planId)}/review`,
      input,
      requestOpts
    );
    return assertOk(res.status, res.data, [200, 202], res.correlationId);
  }

  async getCapabilities(
    requestOpts?: RequestOptions
  ): Promise<{ capabilities: unknown[] }> {
    const res = await httpJson<{ capabilities: unknown[] }>(
      this.opts,
      "GET",
      "/v1/capabilities",
      undefined,
      requestOpts
    );
    return assertOk(res.status, res.data, 200, res.correlationId);
  }

  async getWorkflowFeedback(
    feedbackId: string,
    requestOpts?: RequestOptions
  ): Promise<Record<string, unknown>> {
    const res = await httpJson<Record<string, unknown>>(
      this.opts,
      "GET",
      `/v1/workflow-feedback/${encodeURIComponent(feedbackId)}`,
      undefined,
      requestOpts
    );
    return assertOk(res.status, res.data, 200, res.correlationId);
  }

  async listRunWorkflowFeedback(
    runId: string,
    requestOpts?: RequestOptions
  ): Promise<{ events: unknown[] }> {
    const res = await httpJson<{ events: unknown[] }>(
      this.opts,
      "GET",
      `/v1/analysis-runs/${encodeURIComponent(runId)}/workflow-feedback`,
      undefined,
      requestOpts
    );
    return assertOk(res.status, res.data, 200, res.correlationId);
  }

  async resolveWorkflowFeedback(
    feedbackId: string,
    input: Record<string, unknown>,
    requestOpts?: RequestOptions
  ): Promise<Record<string, unknown>> {
    const res = await httpJson<Record<string, unknown>>(
      this.opts,
      "POST",
      `/v1/workflow-feedback/${encodeURIComponent(feedbackId)}/resolve`,
      input,
      requestOpts
    );
    return assertOk(res.status, res.data, 200, res.correlationId);
  }

  async ingestOutcome(
    input: Record<string, unknown>,
    requestOpts?: RequestOptions
  ): Promise<Record<string, unknown>> {
    const res = await httpJson<Record<string, unknown>>(
      this.opts,
      "POST",
      "/v1/outcomes",
      input,
      requestOpts
    );
    return assertOk(res.status, res.data, 201, res.correlationId);
  }

  async getOutcome(
    outcomeId: string,
    requestOpts?: RequestOptions
  ): Promise<Record<string, unknown>> {
    const res = await httpJson<Record<string, unknown>>(
      this.opts,
      "GET",
      `/v1/outcomes/${encodeURIComponent(outcomeId)}`,
      undefined,
      requestOpts
    );
    return assertOk(res.status, res.data, 200, res.correlationId);
  }

  async reassessOutcome(
    outcomeId: string,
    input: Record<string, unknown> = {},
    requestOpts?: RequestOptions
  ): Promise<Record<string, unknown>> {
    const res = await httpJson<Record<string, unknown>>(
      this.opts,
      "POST",
      `/v1/outcomes/${encodeURIComponent(outcomeId)}/reassess`,
      input,
      requestOpts
    );
    return assertOk(res.status, res.data, [200, 202], res.correlationId);
  }

  /**
   * Helper for comparative_analysis — validates body via CreateAnalysisRequestSchema.
   */
  async createComparativeAnalysis(
    input: Omit<CreateAnalysisRequest, "operation"> & {
      baselineEvidencePackageIds: string[];
      evidencePackageIds: string[];
    },
    requestOpts?: RequestOptions
  ): Promise<AnalysisRequestResponse> {
    return this.createAnalysis(
      {
        ...input,
        operation: "comparative_analysis"
      },
      requestOpts
    );
  }

  /**
   * Poll run until terminal or predicate matches. Supports AbortSignal.
   */
  async pollRun(
    runId: string,
    pollOpts: PollOptions & {
      until?: (run: AnalysisRunResponse) => boolean;
      requestOpts?: RequestOptions;
    } = {}
  ): Promise<AnalysisRunResponse> {
    const terminal = new Set([
      "completed",
      "partial",
      "evidence_insufficient",
      "failed",
      "cancelled",
      "blocked"
    ]);
    return pollUntil(
      async () => {
        const run = await this.getRun(runId, pollOpts.requestOpts);
        const done = pollOpts.until
          ? pollOpts.until(run)
          : terminal.has(run.status) || run.status === "needs_revision";
        return { value: run, done };
      },
      {
        intervalMs: pollOpts.intervalMs ?? 200,
        timeoutMs: pollOpts.timeoutMs ?? 60_000,
        signal: pollOpts.signal ?? pollOpts.requestOpts?.signal
      }
    );
  }
}
