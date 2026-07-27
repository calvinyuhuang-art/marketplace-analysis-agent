import type { AnalysisArea, ErrorClass } from "@maa/contracts";
import { errorClassFromReason } from "@maa/contracts";
import { CUSTOMER_EVIDENCE_REGRESSION_TEST_ID } from "./constants";

export interface LessonExtractionInput {
  findingStatement: string;
  analysisArea: string;
  reasonCode?: string;
  notes?: string;
  projectId: string;
  platform?: string;
  marketplace?: string;
  category?: string;
  productType?: string;
}

export interface LessonExtraction {
  errorClass: ErrorClass;
  title: string;
  unsafeBehaviorPattern: string;
  context: string;
  rootCause: string;
  correction: string;
  actionTaken: string;
  observedOutcome: string;
  reviewerJudgment: string;
  proposedRootCause: string;
  correctiveAction: string;
  ruleTitle: string;
  ruleStatement: string;
  requireDirectCustomerEvidence: boolean;
  analysisAreas: AnalysisArea[];
  regressionTestIds: string[];
  causeConfidence: number;
  severity: "low" | "medium" | "high";
}

/**
 * Deterministic lesson/Error Book/rule proposal from a rejected finding.
 * Does not treat acceptance as causal truth — only explicit rejection feedback.
 */
export function extractLessonFromRejection(input: LessonExtractionInput): LessonExtraction {
  const errorClass = errorClassFromReason(
    input.reasonCode as Parameters<typeof errorClassFromReason>[0],
    input.analysisArea
  );
  const area = input.analysisArea as AnalysisArea;
  const isCustomerUnsupported =
    errorClass === "unsupported_customer_claim" ||
    (input.analysisArea === "customer_evidence" &&
      input.reasonCode === "unsupported_conclusion");

  if (isCustomerUnsupported) {
    return {
      errorClass: "unsupported_customer_claim",
      title: "Unsupported customer preference claim",
      unsafeBehaviorPattern:
        "Asserting buyer preferences or sentiment without direct review/Q&A evidence.",
      context: `Rejected finding in ${input.analysisArea}: ${input.findingStatement.slice(0, 240)}`,
      rootCause:
        "Model or analysis treated listing copy or inference as observed customer preference.",
      correction:
        "Require direct buyer language (reviews/Q&A). If absent, emit a collection request and skip preference claims.",
      actionTaken: "Produced a customer_evidence finding without sufficient direct buyer language.",
      observedOutcome: "Reviewer rejected the finding as unsupported.",
      reviewerJudgment: input.notes?.trim() || "unsupported_conclusion",
      proposedRootCause:
        "Customer preference claims were inferred without citing direct review evidence.",
      correctiveAction:
        "Block preference claims without review evidence; return a structured collection request instead.",
      ruleTitle: "Direct customer evidence required for preference claims",
      ruleStatement:
        "For customer_evidence analysis: do not assert buyer preferences, likes, or complaints unless supported by direct review or Q&A evidenceRefs. When such evidence is missing, emit a collection request and leave preference claims as unknowns — never invent them.",
      requireDirectCustomerEvidence: true,
      analysisAreas: ["customer_evidence"],
      regressionTestIds: [CUSTOMER_EVIDENCE_REGRESSION_TEST_ID],
      causeConfidence: 0.75,
      severity: "high"
    };
  }

  return {
    errorClass,
    title: `Rejected finding: ${input.reasonCode ?? "other"}`,
    unsafeBehaviorPattern: input.findingStatement.slice(0, 280),
    context: `Area ${input.analysisArea}; project ${input.projectId}`,
    rootCause: input.notes?.trim() || `Reviewer rejected with reason ${input.reasonCode ?? "other"}.`,
    correction: "Re-analyze with stronger evidence grounding and explicit classification.",
    actionTaken: `Emitted finding in ${input.analysisArea}.`,
    observedOutcome: "Reviewer rejected the finding.",
    reviewerJudgment: input.notes?.trim() || input.reasonCode || "rejected",
    proposedRootCause: input.notes?.trim() || "Finding did not meet reviewer evidence standards.",
    correctiveAction: "Tighten evidence grounding and avoid over-claiming.",
    ruleTitle: `Avoid repeating: ${input.reasonCode ?? "rejected pattern"}`,
    ruleStatement: `Do not repeat the rejected pattern in ${input.analysisArea}: ${input.findingStatement.slice(0, 200)}. Prefer collection requests or unknowns when evidence is insufficient.`,
    requireDirectCustomerEvidence: false,
    analysisAreas: area ? [area] : [],
    regressionTestIds: [],
    causeConfidence: 0.55,
    severity: "medium"
  };
}
