import {
  IdPrefix,
  newId,
  type AnalysisArea,
  type ErrorBookEntry,
  type LessonCandidate,
  type OutcomeReview,
  type ProceduralRule,
  type ProceduralRulePromptItem,
  type MemoryEvaluation
} from "@maa/contracts";
import type {
  ErrorBookRepository,
  LearningEventsRepository,
  LessonCandidatesRepository,
  MemoryEvaluationsRepository,
  MemoryItemsRepository,
  OutcomeReviewsRepository,
  ProceduralRulesRepository
} from "@maa/database";
import { extractLessonFromRejection } from "./extract";

export interface LearningServiceDeps {
  outcomeReviews: OutcomeReviewsRepository;
  lessons: LessonCandidatesRepository;
  errorBook: ErrorBookRepository;
  proceduralRules: ProceduralRulesRepository;
  memoryEvaluations: MemoryEvaluationsRepository;
  learningEvents: LearningEventsRepository;
  memoryItems?: MemoryItemsRepository;
}

function parseAreas(json: string): AnalysisArea[] {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? (v as AnalysisArea[]) : [];
  } catch {
    return [];
  }
}

function parseStrings(json: string): string[] {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export class LearningService {
  constructor(private readonly deps: LearningServiceDeps) {}

  /**
   * On finding reject: create learning lesson candidate + Error Book + proposed procedural rule.
   * Acceptance alone never creates causal lessons.
   */
  recordFindingRejection(input: {
    projectId: string;
    runId: string;
    findingId: string;
    findingStatement: string;
    analysisArea: string;
    reasonCode?: string;
    notes?: string;
    learningEventId?: string;
    platform?: string;
    marketplace?: string;
    category?: string;
    productType?: string;
    capabilityVersion?: string;
  }): {
    lesson: LessonCandidate;
    errorBook: ErrorBookEntry;
    proceduralRule: ProceduralRule;
  } {
    const now = new Date().toISOString();
    const extracted = extractLessonFromRejection({
      findingStatement: input.findingStatement,
      analysisArea: input.analysisArea,
      reasonCode: input.reasonCode,
      notes: input.notes,
      projectId: input.projectId,
      platform: input.platform,
      marketplace: input.marketplace,
      category: input.category,
      productType: input.productType
    });

    let errorRow = this.deps.errorBook.findOpenByClassAndScope({
      errorClass: extracted.errorClass,
      projectId: input.projectId,
      platform: input.platform,
      category: input.category,
      productType: input.productType
    });

    let errorBookId: string;
    if (errorRow) {
      errorBookId = errorRow.errorBookEntryId;
      const learningIds = parseStrings(errorRow.linkedLearningEventIdsJson);
      if (input.learningEventId && !learningIds.includes(input.learningEventId)) {
        learningIds.push(input.learningEventId);
      }
      this.deps.errorBook.updateOccurrence(errorBookId, {
        occurrenceCount: errorRow.occurrenceCount + 1,
        lastOccurrenceAt: now,
        recurrenceStatus: "recurring",
        linkedLearningEventIdsJson: JSON.stringify(learningIds),
        updatedAt: now
      });
      errorRow = this.deps.errorBook.getById(errorBookId)!;
    } else {
      errorBookId = newId(IdPrefix.errorBook);
      this.deps.errorBook.insert({
        errorBookEntryId: errorBookId,
        errorClass: extracted.errorClass,
        title: extracted.title,
        unsafeBehaviorPattern: extracted.unsafeBehaviorPattern,
        context: extracted.context,
        rootCause: extracted.rootCause,
        correction: extracted.correction,
        severity: extracted.severity,
        occurrenceCount: 1,
        lastOccurrenceAt: now,
        recurrenceStatus: "first_seen",
        projectId: input.projectId,
        platform: input.platform ?? null,
        marketplace: input.marketplace ?? null,
        category: input.category ?? null,
        productType: input.productType ?? null,
        analysisAreasJson: JSON.stringify(extracted.analysisAreas),
        affectedCapabilityVersionsJson: JSON.stringify(
          input.capabilityVersion ? [input.capabilityVersion] : []
        ),
        regressionTestIdsJson: JSON.stringify(extracted.regressionTestIds),
        linkedLearningEventIdsJson: JSON.stringify(
          input.learningEventId ? [input.learningEventId] : []
        ),
        linkedProceduralRuleIdsJson: JSON.stringify([]),
        createdAt: now,
        updatedAt: now
      });
      errorRow = this.deps.errorBook.getById(errorBookId)!;
    }

    const ruleId = newId(IdPrefix.proceduralRule);
    this.deps.proceduralRules.insert({
      proceduralRuleId: ruleId,
      version: 1,
      title: extracted.ruleTitle,
      statement: extracted.ruleStatement,
      status: "proposed",
      authority: "procedural_proposed",
      analysisAreasJson: JSON.stringify(extracted.analysisAreas),
      platform: input.platform ?? null,
      marketplace: input.marketplace ?? null,
      category: input.category ?? null,
      productType: input.productType ?? null,
      projectId: input.projectId,
      errorBookEntryId: errorBookId,
      lessonCandidateId: null,
      learningEventIdsJson: JSON.stringify(
        input.learningEventId ? [input.learningEventId] : []
      ),
      regressionTestIdsJson: JSON.stringify(extracted.regressionTestIds),
      requireDirectCustomerEvidence: extracted.requireDirectCustomerEvidence ? 1 : 0,
      approvedBy: null,
      approvedAt: null,
      createdAt: now,
      updatedAt: now
    });
    this.deps.errorBook.linkProceduralRule(errorBookId, ruleId, now);

    const lessonId = newId(IdPrefix.lesson);
    this.deps.lessons.insert({
      lessonCandidateId: lessonId,
      projectId: input.projectId,
      learningEventId: input.learningEventId ?? null,
      sourceRunId: input.runId,
      sourceFindingId: input.findingId,
      actionTaken: extracted.actionTaken,
      observedOutcome: extracted.observedOutcome,
      reviewerJudgment: extracted.reviewerJudgment,
      proposedRootCause: extracted.proposedRootCause,
      correctiveAction: extracted.correctiveAction,
      scopeJson: JSON.stringify({
        platform: input.platform ?? "",
        marketplace: input.marketplace ?? "",
        category: input.category ?? "",
        productType: input.productType ?? "",
        project: input.projectId
      }),
      analysisAreasJson: JSON.stringify(extracted.analysisAreas),
      causeConfidence: extracted.causeConfidence,
      supportCount: errorRow.occurrenceCount,
      status: "proposed",
      errorBookEntryId: errorBookId,
      proceduralRuleId: ruleId,
      createdAt: now,
      updatedAt: now
    });
    this.deps.proceduralRules.setLessonCandidateId(ruleId, lessonId, now);

    if (input.learningEventId) {
      this.deps.learningEvents.updatePromotionStatus(input.learningEventId, "candidate");
    }

    return {
      lesson: this.toLesson(this.deps.lessons.getById(lessonId)!),
      errorBook: this.toErrorBook(this.deps.errorBook.getById(errorBookId)!),
      proceduralRule: this.toRule(this.deps.proceduralRules.getById(ruleId)!)
    };
  }

  reviewLesson(input: {
    lessonCandidateId: string;
    action: "approve" | "reject" | "defer";
    reviewerId: string;
    activateProceduralRule?: boolean;
  }): LessonCandidate {
    const lesson = this.deps.lessons.getById(input.lessonCandidateId);
    if (!lesson) {
      throw new Error(`Lesson '${input.lessonCandidateId}' not found`);
    }
    const now = new Date().toISOString();
    const status =
      input.action === "approve"
        ? "approved"
        : input.action === "reject"
          ? "rejected"
          : "deferred";
    this.deps.lessons.updateStatus(lesson.lessonCandidateId, status, now);

    if (
      input.action === "approve" &&
      (input.activateProceduralRule ?? true) &&
      lesson.proceduralRuleId
    ) {
      this.approveProceduralRule({
        proceduralRuleId: lesson.proceduralRuleId,
        reviewerId: input.reviewerId
      });
    }
    if (input.action === "reject" && lesson.proceduralRuleId) {
      this.deps.proceduralRules.updateStatus(lesson.proceduralRuleId, {
        status: "rejected",
        authority: "procedural_proposed",
        updatedAt: now
      });
    }

    return this.toLesson(this.deps.lessons.getById(input.lessonCandidateId)!);
  }

  approveProceduralRule(input: {
    proceduralRuleId: string;
    reviewerId: string;
  }): ProceduralRule {
    const rule = this.deps.proceduralRules.getById(input.proceduralRuleId);
    if (!rule) throw new Error(`Procedural rule '${input.proceduralRuleId}' not found`);
    const now = new Date().toISOString();
    this.deps.proceduralRules.updateStatus(input.proceduralRuleId, {
      status: "active",
      authority: "procedural_active",
      approvedBy: input.reviewerId,
      approvedAt: now,
      updatedAt: now
    });
    return this.toRule(this.deps.proceduralRules.getById(input.proceduralRuleId)!);
  }

  reviewProceduralRule(input: {
    proceduralRuleId: string;
    action: "approve" | "reject" | "retire";
    reviewerId: string;
  }): ProceduralRule {
    const now = new Date().toISOString();
    if (input.action === "approve") {
      return this.approveProceduralRule(input);
    }
    this.deps.proceduralRules.updateStatus(input.proceduralRuleId, {
      status: input.action === "retire" ? "retired" : "rejected",
      authority: "procedural_proposed",
      updatedAt: now
    });
    return this.toRule(this.deps.proceduralRules.getById(input.proceduralRuleId)!);
  }

  recordOutcomeReview(input: {
    projectId: string;
    runId: string;
    judgment: string;
    notes?: string;
    reviewerId: string;
    proposeLesson?: boolean;
  }): OutcomeReview {
    const now = new Date().toISOString();
    // Acceptance alone must NOT create causal lesson truth.
    if (input.proposeLesson) {
      // Explicit opt-in only — still creates a proposed lesson without Error Book auto-path.
      // Left intentionally minimal: operators use finding reject path for Error Book.
    }
    const id = newId(IdPrefix.outcomeReview);
    this.deps.outcomeReviews.insert({
      outcomeReviewId: id,
      projectId: input.projectId,
      runId: input.runId,
      judgment: input.judgment,
      notes: input.notes ?? null,
      reviewerId: input.reviewerId,
      lessonCandidateId: null,
      createdAt: now
    });
    return {
      outcomeReviewId: id,
      projectId: input.projectId,
      runId: input.runId,
      judgment: input.judgment as OutcomeReview["judgment"],
      notes: input.notes,
      reviewerId: input.reviewerId,
      createdAt: now
    };
  }

  recordMemoryEvaluation(input: {
    memoryId: string;
    projectId: string;
    runId?: string;
    judgment: string;
    notes?: string;
    reviewerId: string;
  }): MemoryEvaluation {
    const now = new Date().toISOString();
    const id = newId(IdPrefix.memoryEval);
    this.deps.memoryEvaluations.insert({
      evaluationId: id,
      memoryId: input.memoryId,
      projectId: input.projectId,
      runId: input.runId ?? null,
      judgment: input.judgment,
      notes: input.notes ?? null,
      reviewerId: input.reviewerId,
      createdAt: now
    });
    return {
      evaluationId: id,
      memoryId: input.memoryId,
      projectId: input.projectId,
      runId: input.runId,
      judgment: input.judgment as MemoryEvaluation["judgment"],
      notes: input.notes,
      reviewerId: input.reviewerId,
      createdAt: now
    };
  }

  listErrorBook(filter?: { projectId?: string; errorClass?: string }): ErrorBookEntry[] {
    return this.deps.errorBook.list(filter).map((r) => this.toErrorBook(r));
  }

  listLessons(projectId: string): LessonCandidate[] {
    return this.deps.lessons.listByProject(projectId).map((r) => this.toLesson(r));
  }

  listProceduralRules(filter?: {
    projectId?: string;
    status?: string;
  }): ProceduralRule[] {
    return this.deps.proceduralRules.list(filter).map((r) => this.toRule(r));
  }

  /** Active rules for context assembly — authority and scope enforced. */
  resolveActiveProceduralRules(input: {
    projectId?: string;
    platform?: string;
    marketplace?: string;
    category?: string;
    productType?: string;
    analysisAreas?: AnalysisArea[];
  }): ProceduralRulePromptItem[] {
    return this.deps.proceduralRules
      .listActiveForScope({
        projectId: input.projectId,
        platform: input.platform,
        marketplace: input.marketplace,
        category: input.category,
        productType: input.productType,
        analysisAreas: input.analysisAreas
      })
      .map((r) => ({
        proceduralRuleId: r.proceduralRuleId,
        title: r.title,
        statement: r.statement,
        analysisAreas: parseAreas(r.analysisAreasJson),
        requireDirectCustomerEvidence: r.requireDirectCustomerEvidence === 1
      }));
  }

  private toLesson(row: ReturnType<LessonCandidatesRepository["getById"]> & object): LessonCandidate {
    return {
      lessonCandidateId: row.lessonCandidateId,
      projectId: row.projectId,
      learningEventId: row.learningEventId ?? undefined,
      sourceRunId: row.sourceRunId ?? undefined,
      sourceFindingId: row.sourceFindingId ?? undefined,
      actionTaken: row.actionTaken,
      observedOutcome: row.observedOutcome,
      reviewerJudgment: row.reviewerJudgment,
      proposedRootCause: row.proposedRootCause,
      correctiveAction: row.correctiveAction,
      scope: this.deps.lessons.parseScope(row),
      analysisAreas: parseAreas(row.analysisAreasJson),
      causeConfidence: row.causeConfidence,
      supportCount: row.supportCount,
      status: row.status as LessonCandidate["status"],
      errorBookEntryId: row.errorBookEntryId ?? undefined,
      proceduralRuleId: row.proceduralRuleId ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  private toErrorBook(
    row: NonNullable<ReturnType<ErrorBookRepository["getById"]>>
  ): ErrorBookEntry {
    return {
      errorBookEntryId: row.errorBookEntryId,
      errorClass: row.errorClass as ErrorBookEntry["errorClass"],
      title: row.title,
      unsafeBehaviorPattern: row.unsafeBehaviorPattern,
      context: row.context,
      rootCause: row.rootCause,
      correction: row.correction,
      severity: row.severity as ErrorBookEntry["severity"],
      occurrenceCount: row.occurrenceCount,
      lastOccurrenceAt: row.lastOccurrenceAt,
      recurrenceStatus: row.recurrenceStatus as ErrorBookEntry["recurrenceStatus"],
      projectId: row.projectId ?? undefined,
      platform: row.platform ?? undefined,
      marketplace: row.marketplace ?? undefined,
      category: row.category ?? undefined,
      productType: row.productType ?? undefined,
      analysisAreas: parseAreas(row.analysisAreasJson),
      affectedCapabilityVersions: parseStrings(row.affectedCapabilityVersionsJson),
      regressionTestIds: parseStrings(row.regressionTestIdsJson),
      linkedLearningEventIds: parseStrings(row.linkedLearningEventIdsJson),
      linkedProceduralRuleIds: parseStrings(row.linkedProceduralRuleIdsJson),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  private toRule(
    row: NonNullable<ReturnType<ProceduralRulesRepository["getById"]>>
  ): ProceduralRule {
    return {
      proceduralRuleId: row.proceduralRuleId,
      version: row.version,
      title: row.title,
      statement: row.statement,
      status: row.status as ProceduralRule["status"],
      authority: row.authority as ProceduralRule["authority"],
      analysisAreas: parseAreas(row.analysisAreasJson),
      platform: row.platform ?? undefined,
      marketplace: row.marketplace ?? undefined,
      category: row.category ?? undefined,
      productType: row.productType ?? undefined,
      projectId: row.projectId ?? undefined,
      errorBookEntryId: row.errorBookEntryId ?? undefined,
      lessonCandidateId: row.lessonCandidateId ?? undefined,
      learningEventIds: parseStrings(row.learningEventIdsJson),
      regressionTestIds: parseStrings(row.regressionTestIdsJson),
      requireDirectCustomerEvidence: row.requireDirectCustomerEvidence === 1,
      approvedBy: row.approvedBy ?? undefined,
      approvedAt: row.approvedAt ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }
}
