const API_BASE = (import.meta.env.VITE_MAA_API_BASE as string | undefined) ?? "http://127.0.0.1:4320";
const API_KEY = (import.meta.env.VITE_MAA_API_KEY as string | undefined)?.trim() ?? "";

function authHeaders(): Record<string, string> {
  if (!API_KEY) return {};
  return { Authorization: `Bearer ${API_KEY}` };
}

export interface HealthResponse {
  status: string;
  service: string;
  version: string;
  uptimeSeconds: number;
  time: string;
}

export interface ReadinessCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface ReadinessResponse {
  ready: boolean;
  checks: ReadinessCheck[];
  time: string;
}

export interface CapabilitySummary {
  id: string;
  version: string;
  platform: string;
  marketplace: string;
  category: string;
  productType: string;
  supportedOperations: string[];
  supportedAnalysisAreas: string[];
}

export interface ModelProfileSummary {
  id: string;
  provider: string;
  model: string;
  enabled: boolean;
  description?: string;
}

export interface AnalysisRequestResponse {
  requestId: string;
  runId: string;
  projectId: string;
  status: string;
  currentPhase: string | null;
  operation: string;
  correlationId: string | null;
  statusUrl: string;
  createdAt: string;
}

export interface AnalysisRunResponse {
  runId: string;
  requestId: string;
  projectId: string;
  status: string;
  currentPhase: string | null;
  attemptNumber: number;
  priorRunId?: string | null;
  affectedAreas?: string[] | null;
  executionId: string | null;
  correlationId: string | null;
  provider?: string | null;
  model?: string | null;
  startedAt: string | null;
  heartbeatAt: string | null;
  completedAt: string | null;
  cancelRequestedAt: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  tokenInput?: number;
  tokenOutput?: number;
  costUsd?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Finding {
  findingId: string;
  statement: string;
  analysisArea: string;
  classification: string;
  evidenceRefs: string[];
  confidence: number;
  validationStatus: string;
  downstreamImplications: string[];
  runId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface QualityReport {
  passed: boolean;
  score: number;
  issues: Array<{ code: string; severity: string; gate: string; message: string }>;
  evaluatedAt: string;
}

export interface AnalysisOutputResponse {
  outputId: string;
  runId: string;
  outputType: string;
  schemaVersion: string;
  artifactId: string | null;
  contentHash: string;
  qualityScore: number | null;
  qualityPassed: boolean;
  output?: {
    summary: string;
    findings: Finding[];
  };
  summary?: string;
  quality?: QualityReport;
}

export type FindingReviewAction =
  | "accept"
  | "reject"
  | "request_revision"
  | "mark_contested";

export type FindingReviewReasonCode =
  | "unsupported_conclusion"
  | "incorrect_evidence_interpretation"
  | "missing_analysis"
  | "wrong_scope"
  | "stale_memory_or_evidence"
  | "contradiction_ignored"
  | "confidence_miscalibrated"
  | "other";

export interface FindingReviewResponse {
  reviewId: string;
  findingId: string;
  runId: string;
  action: FindingReviewAction;
  reasonCode: string | null;
  notes: string | null;
  reviewerId: string;
  validationStatus: string;
  createdAt: string;
}

export interface RunEvent {
  eventId: string;
  eventType: string;
  phase: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  detail: unknown;
  createdAt: string;
}

export interface AreaReadiness {
  area: string;
  status: string;
  score: number;
  warnings: string[];
  gaps: { field: string; description: string; severity: string }[];
  allowedOutputLevel: string;
}

export interface ReadinessReport {
  overallStatus: string;
  readyAreas: string[];
  blockedAreas: string[];
  areas: AreaReadiness[];
  warnings: string[];
}

export interface CollectionRequest {
  collectionRequestId: string;
  reason: string;
  priority: string;
  requiredEvidence: string[];
  analysisAreasBlocked: string[];
  completionRule: Record<string, unknown>;
}

export interface EvidencePackageSummary {
  packageId: string;
  itemCount: number;
  platform: string;
  marketplace: string;
  status: string;
  createdAt: string;
  coverageSummary: Record<string, unknown>;
}

export interface CreateAnalysisBody {
  client: string;
  projectId: string;
  operation: string;
  capability: {
    platform: string;
    marketplace: string;
    category: string;
    productType: string;
  };
  productContext: {
    name: string;
    description?: string;
    salesGoal: string;
    constraints: string[];
  };
  requestedAnalysis: string[];
  question?: string;
  evidencePackageIds: string[];
  idempotencyKey?: string;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: "application/json", ...authHeaders() }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Request to ${path} failed with ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

async function postJson<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authHeaders(),
      ...headers
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = data as { error?: { message?: string; code?: string } };
    throw new Error(err.error?.message ?? `POST ${path} failed with ${res.status}`);
  }
  return data as T;
}

export const api = {
  base: API_BASE,
  health: () => getJson<HealthResponse>("/health"),
  ready: () => getJson<ReadinessResponse>("/ready"),
  learningPlaneStatus: () =>
    getJson<LearningPlaneStatus>("/v1/integrations/learning-plane/status"),
  capabilities: () => getJson<{ capabilities: CapabilitySummary[] }>("/v1/capabilities"),
  modelProfiles: () => getJson<{ profiles: ModelProfileSummary[] }>("/v1/model-profiles"),
  createAnalysis: (body: CreateAnalysisBody, idempotencyKey?: string) =>
    postJson<AnalysisRequestResponse>(
      "/v1/analysis-requests",
      body,
      idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}
    ),
  getRun: (runId: string) => getJson<AnalysisRunResponse>(`/v1/analysis-runs/${runId}`),
  getRunExperience: (runId: string) =>
    getJson<{
      experienceId: string;
      runId: string;
      status: string;
      attempt: number;
      operation: string;
      tokenInput: number;
      tokenOutput: number;
      costUsd: number;
      summary?: string;
      completedAt?: string | null;
    }>(`/v1/analysis-runs/${runId}/experience`),
  listExperienceEvaluations: (experienceId: string) =>
    getJson<{
      experienceId: string;
      evaluations: Array<{
        evaluationId: string;
        evaluatorType: string;
        decision: string;
        sourceSystem: string;
        sourceRecordId: string;
        createdAt: string;
      }>;
    }>(`/v1/experiences/${experienceId}/evaluations`),
  listRuns: () => getJson<{ runs: AnalysisRunResponse[] }>("/v1/runs"),
  listEvents: (runId: string) => getJson<{ events: RunEvent[] }>(`/v1/runs/${runId}/events`),
  getReadiness: (runId: string) => getJson<ReadinessReport>(`/v1/analysis-runs/${runId}/readiness`),
  getCollectionRequests: (runId: string) =>
    getJson<{ collectionRequests: CollectionRequest[] }>(
      `/v1/analysis-runs/${runId}/collection-requests`
    ),
  listEvidencePackages: () =>
    getJson<{ packages: EvidencePackageSummary[] }>("/v1/evidence-packages"),
  getEvidencePackage: (packageId: string) =>
    getJson<EvidencePackageSummary>(`/v1/evidence-packages/${packageId}`),
  cancelRun: (runId: string) =>
    postJson<{ runId: string; status: string; cancelRequestedAt: string; message: string }>(
      `/v1/analysis-runs/${runId}/cancel`,
      { client: "operator-console" }
    ),
  getFindings: (runId: string) =>
    getJson<{ findings: Finding[] }>(`/v1/analysis-runs/${runId}/findings`),
  getOutput: (runId: string) =>
    getJson<AnalysisOutputResponse>(`/v1/analysis-runs/${runId}/output`),
  reviewFinding: (
    findingId: string,
    body: {
      action: FindingReviewAction;
      reasonCode?: FindingReviewReasonCode;
      notes?: string;
      reviewerId?: string;
    }
  ) => postJson<FindingReviewResponse>(`/v1/findings/${findingId}/review`, body),
  reviseRun: (
    runId: string,
    body: {
      reasonCode: FindingReviewReasonCode;
      notes?: string;
      reviewerId?: string;
      affectedAreas?: string[];
      findingIds?: string[];
      supplementalEvidencePackageIds?: string[];
    }
  ) =>
    postJson<{
      priorRunId: string;
      requestId: string;
      runId: string;
      attemptNumber: number;
      affectedAreas: string[];
      evidencePackageIds: string[];
      learningEventId: string;
      statusUrl: string;
    }>(`/v1/analysis-runs/${runId}/revise`, body),
  getRevisionDiff: (runId: string) =>
    getJson<{
      priorRunId: string;
      revisionRunId: string;
      affectedAreas: string[];
      entries: Array<{
        analysisArea: string;
        change: string;
        priorFindingId?: string;
        newFindingId?: string;
        priorStatement?: string;
        newStatement?: string;
      }>;
    }>(`/v1/analysis-runs/${runId}/revision-diff`),
  getLearningEvents: (runId: string) =>
    getJson<{
      learningEvents: Array<{
        learningEventId: string;
        eventType: string;
        reasonCode: string | null;
        notes: string | null;
        createdAt: string;
      }>;
    }>(`/v1/analysis-runs/${runId}/learning-events`),
  getReviewTimeline: (runId: string) =>
    getJson<{
      reviews: Array<{
        kind: string;
        action: string;
        reasonCode: string | null;
        notes: string | null;
        reviewerId: string;
        createdAt: string;
        findingId?: string;
        statement?: string;
      }>;
    }>(`/v1/analysis-runs/${runId}/reviews`),
  getProjectMemory: (projectId: string) =>
    getJson<{ memory: MemoryItem[] }>(`/v1/projects/${projectId}/memory`),
  getMemoryRetrieval: (runId: string) =>
    getJson<{
      retrievalEvents: Array<{
        retrievalEventId: string;
        query: string;
        selectedMemoryIds: string[];
        candidates: Array<{ memoryId: string; selected: boolean; omitReason?: string }>;
        createdAt: string;
      }>;
    }>(`/v1/analysis-runs/${runId}/memory-retrieval`),
  getContextAssembly: (runId: string) =>
    getJson<{
      assemblyId: string;
      selectedMemoryIds: string[];
      omitted: Array<{ memoryId: string; reason: string }>;
      sections: Array<{ name: string; memoryIds: string[]; content?: unknown }>;
    }>(`/v1/analysis-runs/${runId}/context-assembly`),
  getErrorBook: (projectId?: string) =>
    getJson<{ entries: ErrorBookEntry[] }>(
      projectId ? `/v1/error-book?projectId=${encodeURIComponent(projectId)}` : "/v1/error-book"
    ),
  getLessons: (projectId: string) =>
    getJson<{ lessons: LessonCandidate[] }>(`/v1/projects/${projectId}/lessons`),
  reviewLesson: (
    lessonId: string,
    body: { action: "approve" | "reject" | "defer"; reviewerId?: string; activateProceduralRule?: boolean }
  ) =>
    postJson<LessonCandidate>(`/v1/lessons/${lessonId}/review`, {
      reviewerId: "operator",
      activateProceduralRule: true,
      ...body
    }),
  getProceduralRules: (projectId?: string, status?: string) => {
    const q = new URLSearchParams();
    if (projectId) q.set("projectId", projectId);
    if (status) q.set("status", status);
    const suffix = q.toString() ? `?${q}` : "";
    return getJson<{ rules: ProceduralRule[] }>(`/v1/procedural-rules${suffix}`);
  },
  reviewProceduralRule: (
    ruleId: string,
    body: { action: "approve" | "reject" | "retire"; reviewerId?: string }
  ) =>
    postJson<ProceduralRule>(`/v1/procedural-rules/${ruleId}/review`, {
      reviewerId: "operator",
      ...body
    }),
  listOutcomes: (projectId: string) =>
    getJson<{ outcomes: OutcomeEvent[] }>(
      `/v1/projects/${encodeURIComponent(projectId)}/outcomes`
    ),
  getOutcome: (outcomeId: string) =>
    getJson<OutcomeEvent & { reassessments: OutcomeReassessment[] }>(
      `/v1/outcomes/${encodeURIComponent(outcomeId)}`
    ),
  reassessOutcome: (
    outcomeId: string,
    body?: { client?: string; actorId?: string; idempotencyKey?: string }
  ) =>
    postJson<{ runId: string; requestId: string; statusUrl: string }>(
      `/v1/outcomes/${encodeURIComponent(outcomeId)}/reassess`,
      { client: "console", ...body }
    ),
  getMemoryProposals: (projectId?: string, status?: string) => {
    const q = new URLSearchParams();
    if (projectId) q.set("projectId", projectId);
    if (status) q.set("status", status);
    const suffix = q.toString() ? `?${q}` : "";
    return getJson<{ proposals: MemoryProposal[] }>(`/v1/memory-proposals${suffix}`);
  },
  reviewMemoryProposal: (
    proposalId: string,
    body: { action: "approve" | "reject" | "supersede" | "withdraw"; reviewerId?: string }
  ) =>
    postJson<MemoryProposal>(`/v1/memory-proposals/${proposalId}/review`, {
      reviewerId: "operator",
      ...body
    }),
  createMemoryProposal: (body: Record<string, unknown>) =>
    postJson<MemoryProposal>("/v1/memory-proposals", body),
  getReusableMemory: (filter?: {
    platform?: string;
    marketplace?: string;
    category?: string;
    productType?: string;
  }) => {
    const q = new URLSearchParams();
    if (filter?.platform) q.set("platform", filter.platform);
    if (filter?.marketplace) q.set("marketplace", filter.marketplace);
    if (filter?.category) q.set("category", filter.category);
    if (filter?.productType) q.set("productType", filter.productType);
    const suffix = q.toString() ? `?${q}` : "";
    return getJson<{ memory: ReusableMemoryItem[] }>(`/v1/reusable-memory${suffix}`);
  },
  getWikiPages: () => getJson<{ pages: WikiPage[] }>("/v1/wiki/pages"),
  getWikiPage: (pageId: string) =>
    getJson<{ page: WikiPage; version?: WikiVersion; sourceMemoryIds: string[] }>(
      `/v1/wiki/pages/${pageId}`
    ),
  getWikiVersions: (pageId: string) =>
    getJson<{ versions: WikiVersion[] }>(`/v1/wiki/pages/${pageId}/versions`),
  getWikiProposals: (status?: string) =>
    getJson<{ proposals: WikiProposal[] }>(
      status ? `/v1/wiki/proposals?status=${encodeURIComponent(status)}` : "/v1/wiki/proposals"
    ),
  approveWikiProposal: (proposalId: string, reviewerId = "operator") =>
    postJson<WikiProposal>(`/v1/wiki/proposals/${proposalId}/approve`, { reviewerId }),
  lintWiki: (pageId?: string) =>
    postJson<{ issues: Array<{ code: string; message: string; severity: string }> }>(
      "/v1/wiki/lint",
      pageId ? { pageId } : {}
    )
};

export interface MemoryItem {
  memoryId: string;
  memoryType: string;
  authorityStatus: string;
  title: string;
  statement: string;
  confidence: number;
  scopes: Array<{ dimension: string; value: string }>;
}

export interface ErrorBookEntry {
  errorBookEntryId: string;
  errorClass: string;
  title: string;
  unsafeBehaviorPattern: string;
  correction: string;
  occurrenceCount: number;
  recurrenceStatus: string;
  regressionTestIds: string[];
  linkedProceduralRuleIds: string[];
  projectId?: string;
}

export interface LessonCandidate {
  lessonCandidateId: string;
  projectId: string;
  status: string;
  proposedRootCause: string;
  correctiveAction: string;
  proceduralRuleId?: string;
  errorBookEntryId?: string;
}

export interface ProceduralRule {
  proceduralRuleId: string;
  title: string;
  statement: string;
  status: string;
  authority: string;
  requireDirectCustomerEvidence: boolean;
  regressionTestIds: string[];
}

export interface OutcomeEvent {
  outcomeId: string;
  projectId: string;
  eventType: string;
  metrics: Record<string, unknown>;
  source: string;
  linkedRunId?: string;
  linkedExperienceId?: string;
  occurredAt: string;
  reassessments?: OutcomeReassessment[];
}

export interface OutcomeReassessment {
  reassessmentId: string;
  outcomeId: string;
  runId?: string;
  judgments: Array<{ findingId?: string; judgment: string; rationale: string }>;
  reportArtifactId: string;
  createdAt: string;
}

export interface MemoryProposal {
  proposalId: string;
  title: string;
  statement: string;
  status: string;
  confidence: number;
  reason: string;
  scopes: Array<{ dimension: string; value: string }>;
  evidenceIds: string[];
  conflicts: Array<{
    memoryId: string;
    statement: string;
    relation: string;
    score: number;
  }>;
  resultingMemoryId?: string;
  projectId: string;
}

export interface ReusableMemoryItem {
  memoryId: string;
  title: string;
  statement: string;
  supportCount: number;
  contradictionCount: number;
  validUntil: string | null;
  scopes: Array<{ dimension: string; value: string }>;
}

export interface WikiPage {
  pageId: string;
  slug: string;
  title: string;
  path: string;
  status: string;
  currentVersionNo?: number;
}

export interface WikiVersion {
  versionId: string;
  pageId: string;
  versionNo: number;
  contentMarkdown: string;
  changeReason?: string;
  createdAt: string;
  sourceMemoryIds: string[];
}

export interface WikiProposal {
  proposalId: string;
  pageId: string;
  title: string;
  status: string;
  changeReason: string;
  proposedContentMarkdown: string;
}

export interface LearningPlaneStatus {
  implementationMilestone: string;
  enabled: boolean;
  publishEnabled: boolean;
  receiveEnabled: boolean;
  publishMode: string;
  receiveMode: string;
  adapterState: string;
  agentId: string;
  declaredCapabilities: string[];
  registrationStatus: string;
  credentialId: string | null;
  callbackKeyId: string | null;
  callbackPath: string;
  learningPlaneBaseUrl: string;
  learningPlaneApiCompatibility: string | null;
  requiredLearningPlaneApiCompatibility: string;
  maaServiceVersion: string;
  maaApiCompatibility: string;
  maaDatabaseSchemaVersion: string;
  lastHealthReportAt: string | null;
  lastSuccessfulConnectionAt: string | null;
  lastSuccessfulPublishAt?: string | null;
  lastSuccessfulReceiveAt?: string | null;
  lastSuccessfulAcknowledgementAt?: string | null;
  lastErrorCode: string | null;
  boundedDiagnostic: string | null;
  outboxCounts: Record<string, number>;
  inboxCounts: Record<string, number>;
  acknowledgementCounts?: Record<string, number>;
  waitingForCausationCount?: number;
  awaitingLocalReconciliationCount?: number;
  semanticConflictCount?: number;
  oldestPendingAgeSeconds?: number | null;
  secretsPresent: boolean;
  packageIdentity?: {
    clientVersion: string;
    contractsVersion: string;
    apiCompat: string;
    envelopeVersion?: string;
    releasedWorkflowFeedbackPayloadVersions?: Record<string, string>;
    packageChecksum: {
      client: string | null;
      contracts: string | null;
    };
    buildCommitOrSourceRevision?: string | null;
  };
  notes: string[];
  bridgeFlags?: {
    governanceBridgeEnabled: boolean;
    governancePublishEnabled: boolean;
    governanceReceiveEnabled: boolean;
    validationReceiptEnabled: boolean;
    activationReceiptEnabled: boolean;
    replayBridgeEnabled: boolean;
    replayExecuteEnabled: boolean;
    replayReportEnabled: boolean;
    grandfatherRegisterEnabled: boolean;
  };
}
