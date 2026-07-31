import { IdPrefix, newId } from "@maa/contracts";
import type {
  AgentExperience,
  AgentEvaluation,
  CaptureExperienceInput,
  CompleteExperienceInput,
  EvaluationSourceSystem,
  EvaluatorType,
  RecordEvaluationInput
} from "@maa/agent-memory-contracts";
import type {
  AgentEvaluationsRepository,
  AgentExperiencesRepository
} from "@maa/database";

export type ExperienceServiceDeps = {
  experiences: AgentExperiencesRepository;
  evaluations: AgentEvaluationsRepository;
};

function parseJsonArray(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Canonical experience/evaluation capture.
 * Dual-write is one-directional: legacy → evaluations only (never reverse).
 */
export class ExperienceService {
  constructor(private readonly deps: ExperienceServiceDeps) {}

  /** Idempotent on run_id — returns existing if already captured. */
  captureStarted(input: CaptureExperienceInput): AgentExperience {
    const existing = this.deps.experiences.getByRunId(input.runId);
    if (existing) return this.toExperience(existing);

    const now = new Date().toISOString();
    const experienceId = newId(IdPrefix.experience);
    this.deps.experiences.insert({
      experienceId,
      projectId: input.projectId,
      requestId: input.requestId,
      runId: input.runId,
      attempt: input.attempt ?? 1,
      correlationId: input.correlationId ?? null,
      operation: input.operation,
      capabilityKey: input.capabilityKey ?? null,
      capabilityVersion: input.capabilityVersion ?? null,
      status: "started",
      evidencePackageIdsJson: JSON.stringify(input.evidencePackageIds ?? []),
      contextAssemblyId: null,
      inputArtifactIdsJson: JSON.stringify(input.inputArtifactIds ?? []),
      outputArtifactId: null,
      tokenInput: 0,
      tokenOutput: 0,
      costUsd: 0,
      summary: input.summary ?? null,
      provenanceIncomplete: 0,
      startedAt: now,
      completedAt: null,
      createdAt: now,
      updatedAt: now
    });
    return this.toExperience(this.deps.experiences.getByRunId(input.runId)!);
  }

  complete(input: CompleteExperienceInput): AgentExperience | null {
    const now = new Date().toISOString();
    this.deps.experiences.complete({
      runId: input.runId,
      status: input.status,
      contextAssemblyId: input.contextAssemblyId,
      outputArtifactId: input.outputArtifactId,
      tokenInput: input.tokenInput,
      tokenOutput: input.tokenOutput,
      costUsd: input.costUsd,
      summary: input.summary,
      completedAt: now,
      updatedAt: now
    });
    const row = this.deps.experiences.getByRunId(input.runId);
    return row ? this.toExperience(row) : null;
  }

  getByRunId(runId: string): AgentExperience | null {
    const row = this.deps.experiences.getByRunId(runId);
    return row ? this.toExperience(row) : null;
  }

  getById(experienceId: string): AgentExperience | null {
    const row = this.deps.experiences.getById(experienceId);
    return row ? this.toExperience(row) : null;
  }

  recordEvaluation(input: RecordEvaluationInput): AgentEvaluation | null {
    const evaluationId = newId(IdPrefix.evaluation);
    const now = new Date().toISOString();
    const inserted = this.deps.evaluations.insertIgnoreDuplicate({
      evaluationId,
      experienceId: input.experienceId,
      evaluatorType: input.evaluatorType,
      rubricVersion: input.rubricVersion ?? "v1",
      decision: input.decision,
      scoresJson: JSON.stringify(input.scores ?? {}),
      confidence: input.confidence ?? null,
      feedbackArtifactId: input.feedbackArtifactId ?? null,
      sourceSystem: input.sourceSystem,
      sourceRecordId: input.sourceRecordId,
      createdAt: now
    });
    if (!inserted) {
      const existing = this.deps.evaluations
        .listByExperience(input.experienceId)
        .find(
          (e) =>
            e.evaluatorType === input.evaluatorType &&
            e.rubricVersion === (input.rubricVersion ?? "v1") &&
            e.sourceSystem === input.sourceSystem &&
            e.sourceRecordId === input.sourceRecordId
        );
      return existing ? this.toEvaluation(existing) : null;
    }
    return this.toEvaluation(this.deps.evaluations.listByExperience(input.experienceId).at(-1)!);
  }

  /**
   * One-way dual-write from a legacy decision record.
   * Never creates learning_events.
   */
  recordFromLegacy(input: {
    runId: string;
    evaluatorType: EvaluatorType;
    decision: string;
    sourceSystem: EvaluationSourceSystem;
    sourceRecordId: string;
    rubricVersion?: string;
    scores?: Record<string, unknown>;
    confidence?: number;
  }): AgentEvaluation | null {
    const experience = this.deps.experiences.getByRunId(input.runId);
    if (!experience) return null;
    return this.recordEvaluation({
      experienceId: experience.experienceId,
      evaluatorType: input.evaluatorType,
      rubricVersion: input.rubricVersion ?? "v1",
      decision: input.decision,
      scores: input.scores ?? {},
      confidence: input.confidence,
      sourceSystem: input.sourceSystem,
      sourceRecordId: input.sourceRecordId
    });
  }

  listEvaluations(experienceId: string): AgentEvaluation[] {
    return this.deps.evaluations.listByExperience(experienceId).map((e) => this.toEvaluation(e));
  }

  private toExperience(row: ReturnType<AgentExperiencesRepository["getByRunId"]> & object): AgentExperience {
    const r = row!;
    return {
      experienceId: r.experienceId,
      projectId: r.projectId,
      requestId: r.requestId,
      runId: r.runId,
      attempt: r.attempt,
      correlationId: r.correlationId,
      operation: r.operation,
      capabilityKey: r.capabilityKey,
      capabilityVersion: r.capabilityVersion,
      status: r.status as AgentExperience["status"],
      evidencePackageIds: parseJsonArray(r.evidencePackageIdsJson),
      contextAssemblyId: r.contextAssemblyId,
      inputArtifactIds: parseJsonArray(r.inputArtifactIdsJson),
      outputArtifactId: r.outputArtifactId,
      tokenInput: r.tokenInput,
      tokenOutput: r.tokenOutput,
      costUsd: r.costUsd,
      summary: r.summary ?? undefined,
      provenanceIncomplete: r.provenanceIncomplete === 1,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    };
  }

  private toEvaluation(row: {
    evaluationId: string;
    experienceId: string;
    evaluatorType: string;
    rubricVersion: string;
    decision: string;
    scoresJson: string;
    confidence: number | null;
    feedbackArtifactId: string | null;
    sourceSystem: string;
    sourceRecordId: string;
    createdAt: string;
  }): AgentEvaluation {
    let scores: Record<string, unknown> = {};
    try {
      scores = JSON.parse(row.scoresJson) as Record<string, unknown>;
    } catch {
      scores = {};
    }
    return {
      evaluationId: row.evaluationId,
      experienceId: row.experienceId,
      evaluatorType: row.evaluatorType as AgentEvaluation["evaluatorType"],
      rubricVersion: row.rubricVersion,
      decision: row.decision,
      scores,
      confidence: row.confidence ?? undefined,
      feedbackArtifactId: row.feedbackArtifactId,
      sourceSystem: row.sourceSystem as AgentEvaluation["sourceSystem"],
      sourceRecordId: row.sourceRecordId,
      createdAt: row.createdAt
    };
  }
}
