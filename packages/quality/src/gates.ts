import {
  AnalysisOutputSchema,
  type AnalysisArea,
  type AnalysisOutput,
  type EvidenceItem,
  type QualityIssue,
  type QualityReport,
  type ReadinessReport
} from "@maa/contracts";

export interface QualityGateInput {
  output: unknown;
  evidenceItems: EvidenceItem[];
  readiness?: ReadinessReport;
  requestedAreas: AnalysisArea[];
}

function evidenceIds(items: EvidenceItem[]): Set<string> {
  return new Set(items.map((i) => i.evidenceId));
}

function reviewEvidenceIds(items: EvidenceItem[]): Set<string> {
  return new Set(
    items.filter((i) => i.sourceType === "review" || i.sourceType === "qa").map((i) => i.evidenceId)
  );
}

/**
 * Deterministic quality gates. These do not call the model. Unsupported claims
 * and unsafe reasoning patterns fail here before output is accepted.
 */
export function runQualityGates(input: QualityGateInput): QualityReport {
  const issues: QualityIssue[] = [];
  const now = new Date().toISOString();
  const allowedEvidence = evidenceIds(input.evidenceItems);
  const reviewIds = reviewEvidenceIds(input.evidenceItems);

  const parsed = AnalysisOutputSchema.safeParse(input.output);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({
        code: "SCHEMA_INVALID",
        severity: "error",
        gate: "structural",
        message: issue.message,
        path: issue.path.join(".")
      });
    }
    return { passed: false, score: 0, issues, evaluatedAt: now };
  }

  const output: AnalysisOutput = parsed.data;
  const readyAreas = new Set(
    input.readiness?.readyAreas ??
      input.requestedAreas.filter((a) => {
        const area = input.readiness?.areas.find((x) => x.area === a);
        return !area || area.allowedOutputLevel !== "none";
      })
  );
  const blockedAreas = new Set(input.readiness?.blockedAreas ?? []);

  // Structural: ready areas should be represented; blocked must not be complete.
  for (const area of readyAreas) {
    if (
      !output.readyAreasAnalyzed.includes(area) &&
      !output.findings.some((f) => f.analysisArea === area)
    ) {
      issues.push({
        code: "MISSING_READY_AREA",
        severity: "warning",
        gate: "structural",
        message: `Ready analysis area '${area}' has no findings or readyAreasAnalyzed entry.`
      });
    }
  }

  for (const finding of output.findings) {
    if (blockedAreas.has(finding.analysisArea) && finding.classification !== "unknown") {
      issues.push({
        code: "BLOCKED_AREA_CLAIM",
        severity: "error",
        gate: "structural",
        findingId: finding.findingId,
        message: `Finding claims in blocked area '${finding.analysisArea}'.`
      });
    }

    if (finding.confidence < 0 || finding.confidence > 1) {
      issues.push({
        code: "CONFIDENCE_OUT_OF_RANGE",
        severity: "error",
        gate: "structural",
        findingId: finding.findingId,
        message: "Confidence must be between 0 and 1."
      });
    }

    for (const ref of finding.evidenceRefs) {
      if (!allowedEvidence.has(ref)) {
        issues.push({
          code: "EVIDENCE_REF_UNRESOLVED",
          severity: "error",
          gate: "evidence",
          findingId: finding.findingId,
          message: `Evidence reference '${ref}' does not resolve to an allowed package item.`
        });
      }
    }

    if (
      (finding.classification === "observed_fact" ||
        finding.classification === "source_reported_claim") &&
      finding.evidenceRefs.length === 0
    ) {
      issues.push({
        code: "FACT_WITHOUT_EVIDENCE",
        severity: "error",
        gate: "evidence",
        findingId: finding.findingId,
        message: `${finding.classification} requires evidence references.`
      });
    }

    // Customer conclusions need direct customer evidence (not validated_memory).
    if (
      finding.analysisArea === "customer_evidence" &&
      finding.classification !== "unknown" &&
      finding.classification !== "assumption" &&
      finding.classification !== "validated_memory" &&
      !finding.tags.includes("explicitly_limited")
    ) {
      const hasReviewRef = finding.evidenceRefs.some((r) => reviewIds.has(r));
      if (!hasReviewRef) {
        issues.push({
          code: "CUSTOMER_CLAIM_WITHOUT_REVIEW_TEXT",
          severity: "error",
          gate: "evidence",
          findingId: finding.findingId,
          message:
            "Customer conclusions require direct review/Q&A evidence references (or explicit limitation)."
        });
      }
    }

    // Reasoning: rating-count-only customer preference.
    if (
      finding.analysisArea === "customer_evidence" &&
      finding.tags.includes("from_rating_count_only")
    ) {
      issues.push({
        code: "CUSTOMER_PREFERENCE_FROM_RATING_COUNT",
        severity: "error",
        gate: "reasoning",
        findingId: finding.findingId,
        message: "Customer preference inferred only from rating count is not allowed."
      });
    }

    // Reasoning: mixed-format price without segmentation.
    if (
      finding.analysisArea === "pricing" &&
      finding.tags.includes("mixed_format_unsegmented")
    ) {
      issues.push({
        code: "MIXED_FORMAT_PRICE_UNSEGMENTED",
        severity: "error",
        gate: "reasoning",
        findingId: finding.findingId,
        message:
          "Price comparison mixes incompatible formats without explicit segmentation."
      });
    }

    // Reasoning: search volume without source.
    if (finding.tags.includes("search_volume_estimate") && finding.evidenceRefs.length === 0) {
      issues.push({
        code: "SEARCH_VOLUME_WITHOUT_SOURCE",
        severity: "error",
        gate: "reasoning",
        findingId: finding.findingId,
        message: "Search volume estimate without source evidence."
      });
    }

    // Reasoning: legal advice from policy risk.
    if (finding.tags.includes("legal_conclusion")) {
      issues.push({
        code: "POLICY_AS_LEGAL_ADVICE",
        severity: "error",
        gate: "reasoning",
        findingId: finding.findingId,
        message: "Policy risk must not be represented as legal advice."
      });
    }
  }

  for (const assumption of output.assumptions) {
    if (!output.findings.some((f) => f.classification === "assumption" || f.statement === assumption)) {
      // Soft check — assumptions collection may list standalone assumptions.
      void assumption;
    }
  }

  // Decision readiness
  if (!output.summary.trim()) {
    issues.push({
      code: "MISSING_SUMMARY",
      severity: "error",
      gate: "decision_readiness",
      message: "Output must include a summary the caller can act on."
    });
  }
  if (output.nextActions.length === 0 && output.unknowns.length === 0) {
    issues.push({
      code: "MISSING_NEXT_ACTION",
      severity: "warning",
      gate: "decision_readiness",
      message: "Output should identify a next decision or collection action."
    });
  }
  if (blockedAreas.size > 0 && output.unknowns.length === 0 && output.blockedAreasSkipped.length === 0) {
    issues.push({
      code: "BLOCKED_AREAS_NOT_DISCLOSED",
      severity: "error",
      gate: "decision_readiness",
      message: "Blocked analysis areas must be disclosed as skipped/unknown."
    });
  }

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const score = Math.max(0, 1 - errors.length * 0.25 - warnings.length * 0.05);

  return {
    passed: errors.length === 0,
    score: Math.round(score * 100) / 100,
    issues,
    evaluatedAt: now
  };
}
