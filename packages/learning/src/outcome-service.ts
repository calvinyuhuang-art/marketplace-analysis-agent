import type { ArtifactStore } from "@maa/artifacts";
import type { ReassessmentJudgment } from "@maa/agent-memory-contracts";
import {
  AppError,
  IdPrefix,
  newId,
  type IngestOutcomeRequest,
  type OutcomeEventResponse,
  type OutcomeJudgmentResponse,
  type OutcomeReassessmentResponse
} from "@maa/contracts";
import type {
  AgentExperiencesRepository,
  AnalysisRunsRepository,
  ArtifactsRepository,
  FindingsRepository,
  LessonCandidatesRepository,
  OutcomeEventsRepository,
  OutcomeReassessmentsRepository
} from "@maa/database";
import type { ExperienceService } from "./experience-service";

export type OutcomeServiceDeps = {
  outcomes: OutcomeEventsRepository;
  reassessments: OutcomeReassessmentsRepository;
  experiences: AgentExperiencesRepository;
  runs: AnalysisRunsRepository;
  findings: FindingsRepository;
  lessons: LessonCandidatesRepository;
  artifacts: ArtifactsRepository;
  artifactStore: ArtifactStore;
  experienceService: ExperienceService;
};

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseJsonArray(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return undefined;
}

/**
 * Responsibility filter — never blame MAA for traffic/execution gaps.
 */
export function judgeOutcomeMetrics(
  metrics: Record<string, unknown>
): { judgment: ReassessmentJudgment; rationale: string } {
  if (
    metrics.executionBlocked === true ||
    metrics.listingPublished === false ||
    metrics.campaignLaunched === false ||
    metrics.executionFailure === true
  ) {
    return {
      judgment: "outside_maa_responsibility",
      rationale:
        "Execution/publishing failure detected; outcome is outside MAA analysis responsibility."
    };
  }

  if (metrics.causalAttributionImpossible === true) {
    return {
      judgment: "causal_attribution_impossible",
      rationale: "Upstream marked causal attribution as impossible for this measurement window."
    };
  }

  const traffic =
    asNumber(metrics.traffic) ??
    asNumber(metrics.sessions) ??
    asNumber(metrics.impressions) ??
    asNumber(metrics.pageViews);
  const sales = asNumber(metrics.sales) ?? asNumber(metrics.unitsSold);

  if (
    metrics.noTraffic === true ||
    metrics.noSales === true ||
    traffic === 0 ||
    (sales === 0 && (traffic === undefined || traffic === 0))
  ) {
    return {
      judgment: "inconclusive_traffic_or_execution",
      rationale:
        "No measurable traffic/sales in the window — inconclusive for analysis quality (not an analysis failure)."
    };
  }

  if (metrics.overconfident === true || metrics.overconfidence === true) {
    return {
      judgment: "overconfident",
      rationale: "Outcome metrics indicate the prior analysis was overconfident."
    };
  }

  if (metrics.contradictsAnalysis === true || metrics.contradicted === true) {
    return {
      judgment: "contradicted",
      rationale: "Outcome metrics contradict MAA-owned conclusions in linked findings."
    };
  }

  if (metrics.supportsAnalysis === true || metrics.supported === true) {
    return {
      judgment: "supported",
      rationale: "Outcome metrics support the prior MAA-owned conclusions."
    };
  }

  if (metrics.limitationDisclosedOk === true) {
    return {
      judgment: "limitation_disclosed_ok",
      rationale: "Limitations were disclosed and remain acceptable given the outcome."
    };
  }

  return {
    judgment: "inconclusive_traffic_or_execution",
    rationale:
      "Insufficient outcome signal to confirm or refute MAA conclusions; treated as inconclusive."
  };
}

/**
 * Real-world outcome ingest + deterministic reassessment (N5).
 * Does not rewrite historical analysis artifacts.
 */
export class OutcomeService {
  constructor(private readonly deps: OutcomeServiceDeps) {}

  ingest(input: IngestOutcomeRequest): OutcomeEventResponse {
    const now = new Date().toISOString();
    const outcomeId = newId(IdPrefix.outcome);
    this.deps.outcomes.insert({
      outcomeId,
      projectId: input.projectId,
      eventType: input.eventType,
      measurementWindowJson: JSON.stringify(input.measurementWindow ?? {}),
      metricsJson: JSON.stringify(input.metrics ?? {}),
      source: input.source,
      confidence: input.confidence ?? null,
      linkedArtifactIdsJson: JSON.stringify(input.linkedArtifactIds ?? []),
      linkedFindingIdsJson: JSON.stringify(input.linkedFindingIds ?? []),
      linkedExperienceId: input.linkedExperienceId ?? null,
      linkedRunId: input.linkedRunId ?? null,
      occurredAt: input.occurredAt,
      receivedAt: now,
      createdAt: now
    });
    return this.toOutcome(this.deps.outcomes.getById(outcomeId)!);
  }

  getOutcome(outcomeId: string): OutcomeEventResponse {
    const row = this.deps.outcomes.getById(outcomeId);
    if (!row) {
      throw new AppError({
        code: "NOT_FOUND",
        message: `Outcome '${outcomeId}' was not found.`
      });
    }
    return this.toOutcome(row);
  }

  listByProject(projectId: string): OutcomeEventResponse[] {
    return this.deps.outcomes.listByProject(projectId).map((r) => this.toOutcome(r));
  }

  listReassessments(outcomeId: string): OutcomeReassessmentResponse[] {
    this.getOutcome(outcomeId);
    return this.deps.reassessments
      .listByOutcome(outcomeId)
      .map((r) => this.toReassessment(r));
  }

  getReassessmentByRunId(runId: string): OutcomeReassessmentResponse | null {
    const row = this.deps.reassessments.getByRunId(runId);
    return row ? this.toReassessment(row) : null;
  }

  /**
   * Deterministic reassessment for a reassess_with_outcome run.
   * Idempotent on run_id.
   */
  reassessForRun(input: {
    outcomeId: string;
    runId: string;
    experienceId?: string;
  }): OutcomeReassessmentResponse {
    const existing = this.deps.reassessments.getByRunId(input.runId);
    if (existing) return this.toReassessment(existing);

    const outcome = this.deps.outcomes.getById(input.outcomeId);
    if (!outcome) {
      throw new AppError({
        code: "NOT_FOUND",
        message: `Outcome '${input.outcomeId}' was not found.`
      });
    }

    const metrics = parseJsonObject(outcome.metricsJson);
    const base = judgeOutcomeMetrics(metrics);
    const findingIds = parseJsonArray(outcome.linkedFindingIdsJson);
    const judgments: OutcomeJudgmentResponse[] =
      findingIds.length > 0
        ? findingIds.map((findingId) => ({
            findingId,
            judgment: base.judgment,
            rationale: `${base.rationale} (finding ${findingId})`
          }))
        : [{ judgment: base.judgment, rationale: base.rationale }];

    const experienceId =
      input.experienceId ??
      outcome.linkedExperienceId ??
      (outcome.linkedRunId
        ? this.deps.experiences.getByRunId(outcome.linkedRunId)?.experienceId
        : undefined) ??
      this.deps.experiences.getByRunId(input.runId)?.experienceId ??
      null;

    const priorRunId = outcome.linkedRunId;
    const priorRun = priorRunId ? this.deps.runs.getById(priorRunId) : undefined;
    const priorOutputArtifactId = priorRun?.outputArtifactId ?? null;

    const lessonCandidateIds: string[] = [];
    if (
      (base.judgment === "contradicted" || base.judgment === "overconfident") &&
      experienceId
    ) {
      const lessonId = newId(IdPrefix.lesson);
      const now = new Date().toISOString();
      this.deps.lessons.insert({
        lessonCandidateId: lessonId,
        projectId: outcome.projectId,
        learningEventId: null,
        sourceRunId: priorRunId ?? input.runId,
        sourceFindingId: findingIds[0] ?? null,
        actionTaken: "outcome_reassessment",
        observedOutcome: JSON.stringify(metrics),
        reviewerJudgment: base.judgment,
        proposedRootCause: base.rationale,
        correctiveAction:
          "Review MAA-owned claims against outcome metrics; do not rewrite historical artifacts.",
        scopeJson: JSON.stringify({ projectId: outcome.projectId, outcomeId: outcome.outcomeId }),
        analysisAreasJson: JSON.stringify(["opportunity_summary"]),
        causeConfidence: 0.4,
        supportCount: 1,
        status: "proposed",
        errorBookEntryId: null,
        proceduralRuleId: null,
        createdAt: now,
        updatedAt: now
      });
      lessonCandidateIds.push(lessonId);
    }

    const report = {
      schemaVersion: "maa.outcome_reassessment.v1",
      outcomeId: outcome.outcomeId,
      runId: input.runId,
      experienceId: experienceId ?? undefined,
      judgments,
      priorOutputArtifactId: priorOutputArtifactId ?? undefined,
      historyMutable: false,
      createdAt: new Date().toISOString()
    };
    const artifactMeta = this.deps.artifactStore.writeJson(report, {
      subdir: "outcome-reassessments",
      accessClass: "internal"
    });
    this.deps.artifacts.insert({
      artifactId: artifactMeta.artifactId,
      relativePath: artifactMeta.relativePath,
      contentHash: artifactMeta.contentHash,
      mimeType: artifactMeta.mimeType,
      sizeBytes: artifactMeta.sizeBytes,
      redactionStatus: artifactMeta.redactionStatus,
      accessClass: artifactMeta.accessClass,
      relatedRequestId: null,
      relatedRunId: input.runId,
      createdAt: artifactMeta.createdAt
    });

    const reassessmentId = newId(IdPrefix.outcomeReassessment);
    const createdAt = new Date().toISOString();
    this.deps.reassessments.insert({
      reassessmentId,
      outcomeId: outcome.outcomeId,
      experienceId,
      runId: input.runId,
      judgmentsJson: JSON.stringify(judgments),
      reportArtifactId: artifactMeta.artifactId,
      lessonCandidateIdsJson: JSON.stringify(lessonCandidateIds),
      createdAt
    });

    if (experienceId) {
      this.deps.experienceService.recordEvaluation({
        experienceId,
        evaluatorType: "outcome",
        rubricVersion: "outcome-reassess.v1",
        decision: base.judgment,
        scores: {
          judgments,
          outcomeId: outcome.outcomeId,
          reassessmentId,
          priorOutputArtifactId
        },
        confidence: outcome.confidence ?? undefined,
        feedbackArtifactId: artifactMeta.artifactId,
        sourceSystem: "maa.outcome_reassess",
        sourceRecordId: reassessmentId
      });
    }

    return this.toReassessment(this.deps.reassessments.getById(reassessmentId)!);
  }

  private toOutcome(row: OutcomeEventRowLike): OutcomeEventResponse {
    const window = parseJsonObject(row.measurementWindowJson);
    return {
      schemaVersion: "maa.outcome_event.v1",
      outcomeId: row.outcomeId,
      projectId: row.projectId,
      eventType: row.eventType,
      measurementWindow:
        window.start || window.end
          ? {
              start: typeof window.start === "string" ? window.start : undefined,
              end: typeof window.end === "string" ? window.end : undefined
            }
          : undefined,
      metrics: parseJsonObject(row.metricsJson),
      source: row.source,
      confidence: row.confidence ?? undefined,
      linkedArtifactIds: parseJsonArray(row.linkedArtifactIdsJson),
      linkedFindingIds: parseJsonArray(row.linkedFindingIdsJson),
      linkedExperienceId: row.linkedExperienceId ?? undefined,
      linkedRunId: row.linkedRunId ?? undefined,
      occurredAt: row.occurredAt,
      receivedAt: row.receivedAt,
      createdAt: row.createdAt
    };
  }

  private toReassessment(row: OutcomeReassessmentRowLike): OutcomeReassessmentResponse {
    let judgments: OutcomeJudgmentResponse[] = [];
    try {
      judgments = JSON.parse(row.judgmentsJson) as OutcomeJudgmentResponse[];
    } catch {
      judgments = [];
    }
    return {
      schemaVersion: "maa.outcome_reassessment.v1",
      reassessmentId: row.reassessmentId,
      outcomeId: row.outcomeId,
      experienceId: row.experienceId ?? undefined,
      runId: row.runId ?? undefined,
      judgments,
      reportArtifactId: row.reportArtifactId,
      lessonCandidateIds: parseJsonArray(row.lessonCandidateIdsJson),
      createdAt: row.createdAt
    };
  }
}

type OutcomeEventRowLike = {
  outcomeId: string;
  projectId: string;
  eventType: string;
  measurementWindowJson: string;
  metricsJson: string;
  source: string;
  confidence: number | null;
  linkedArtifactIdsJson: string;
  linkedFindingIdsJson: string;
  linkedExperienceId: string | null;
  linkedRunId: string | null;
  occurredAt: string;
  receivedAt: string;
  createdAt: string;
};

type OutcomeReassessmentRowLike = {
  reassessmentId: string;
  outcomeId: string;
  experienceId: string | null;
  runId: string | null;
  judgmentsJson: string;
  reportArtifactId: string;
  lessonCandidateIdsJson: string;
  createdAt: string;
};
