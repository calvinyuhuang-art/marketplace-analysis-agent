import {
  IdPrefix,
  newId,
  type AnalysisArea,
  type FindingClassification
} from "@maa/contracts";

const ANALYSIS_AREAS = new Set<string>([
  "market_structure",
  "competitor_set",
  "customer_evidence",
  "pricing",
  "positioning",
  "keywords_categories",
  "format_product_expectations",
  "listing_conversion",
  "risk_ip_policy",
  "opportunity_summary",
  "evidence_sufficiency"
]);

const CLASSIFICATIONS = new Set<string>([
  "observed_fact",
  "source_reported_claim",
  "validated_memory",
  "inference",
  "assumption",
  "unknown"
]);

function mapConfidence(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(1, Math.max(0, value));
  }
  if (typeof value === "string") {
    const key = value.trim().toLowerCase();
    if (key === "high" || key === "very_high" || key === "very-high") return 0.85;
    if (key === "medium" || key === "moderate") return 0.6;
    if (key === "low" || key === "very_low" || key === "very-low") return 0.35;
    const asNum = Number(key);
    if (Number.isFinite(asNum)) return Math.min(1, Math.max(0, asNum));
  }
  return 0.5;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function coerceFinding(raw: unknown, fallbackArea?: string): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  const statement =
    (typeof f.statement === "string" && f.statement) ||
    (typeof f.claim === "string" && f.claim) ||
    (typeof f.text === "string" && f.text) ||
    "";
  if (!statement) return null;

  const areaCandidate =
    (typeof f.analysisArea === "string" && f.analysisArea) ||
    (typeof f.area === "string" && f.area) ||
    fallbackArea ||
    "";
  if (!ANALYSIS_AREAS.has(areaCandidate)) return null;

  const classCandidate =
    (typeof f.classification === "string" && f.classification) ||
    (typeof f.type === "string" && f.type) ||
    "inference";
  const classification = (
    CLASSIFICATIONS.has(classCandidate) ? classCandidate : "inference"
  ) as FindingClassification;

  const freshnessRaw =
    f.freshness && typeof f.freshness === "object"
      ? (f.freshness as Record<string, unknown>)
      : {};
  const evaluatedAt =
    typeof freshnessRaw.evaluatedAt === "string" && freshnessRaw.evaluatedAt
      ? freshnessRaw.evaluatedAt
      : new Date().toISOString();

  const scopeRaw =
    f.scope && typeof f.scope === "object" ? (f.scope as Record<string, unknown>) : {};

  return {
    findingId:
      typeof f.findingId === "string" && f.findingId
        ? f.findingId
        : newId(IdPrefix.finding),
    statement,
    analysisArea: areaCandidate as AnalysisArea,
    classification,
    scope: {
      platform: typeof scopeRaw.platform === "string" ? scopeRaw.platform : undefined,
      marketplace:
        typeof scopeRaw.marketplace === "string" ? scopeRaw.marketplace : undefined,
      category: typeof scopeRaw.category === "string" ? scopeRaw.category : undefined,
      productType:
        typeof scopeRaw.productType === "string" ? scopeRaw.productType : undefined,
      projectId: typeof scopeRaw.projectId === "string" ? scopeRaw.projectId : undefined,
      subjectIds: asStringArray(scopeRaw.subjectIds)
    },
    evidenceRefs: asStringArray(f.evidenceRefs),
    memoryRefs: asStringArray(f.memoryRefs),
    confidence: mapConfidence(f.confidence),
    freshness: {
      status:
        typeof freshnessRaw.status === "string" &&
        ["current", "aging", "stale", "unknown"].includes(freshnessRaw.status)
          ? freshnessRaw.status
          : "current",
      evaluatedAt,
      oldestEvidenceAt:
        typeof freshnessRaw.oldestEvidenceAt === "string"
          ? freshnessRaw.oldestEvidenceAt
          : undefined,
      newestEvidenceAt:
        typeof freshnessRaw.newestEvidenceAt === "string"
          ? freshnessRaw.newestEvidenceAt
          : evaluatedAt
    },
    contradictions: asStringArray(f.contradictions),
    downstreamImplications: asStringArray(f.downstreamImplications),
    validationStatus:
      typeof f.validationStatus === "string" ? f.validationStatus : "unreviewed",
    tags: asStringArray(f.tags)
  };
}

/**
 * Soft-coerces model JSON toward AnalysisOutputSchema before zod validation.
 * Handles common LLM drift (nested areas, claim/type aliases, string confidence).
 */
export function coerceAnalysisCandidate(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as Record<string, unknown>;

  if (Array.isArray(obj.findings)) {
    return {
      schemaVersion:
        typeof obj.schemaVersion === "string" && obj.schemaVersion
          ? obj.schemaVersion
          : "analysis-output.v1",
      summary:
        typeof obj.summary === "string" && obj.summary
          ? obj.summary
          : "Structured marketplace analysis.",
      readyAreasAnalyzed: asStringArray(obj.readyAreasAnalyzed).filter((a) =>
        ANALYSIS_AREAS.has(a)
      ),
      blockedAreasSkipped: asStringArray(obj.blockedAreasSkipped).filter((a) =>
        ANALYSIS_AREAS.has(a)
      ),
      findings: obj.findings
        .map((f) => coerceFinding(f))
        .filter((f): f is Record<string, unknown> => f !== null),
      assumptions: asStringArray(obj.assumptions),
      unknowns: asStringArray(obj.unknowns),
      contradictions: asStringArray(obj.contradictions),
      nextActions: asStringArray(obj.nextActions),
      limitations: asStringArray(obj.limitations)
    };
  }

  if (obj.areas && typeof obj.areas === "object") {
    const areas = obj.areas as Record<string, unknown>;
    const findings: Record<string, unknown>[] = [];
    const readyAreasAnalyzed: string[] = [];
    const unknowns: string[] = [...asStringArray(obj.unknowns)];
    const limitations: string[] = [...asStringArray(obj.limitations)];

    for (const [area, blockRaw] of Object.entries(areas)) {
      if (!ANALYSIS_AREAS.has(area) || !blockRaw || typeof blockRaw !== "object") continue;
      const block = blockRaw as Record<string, unknown>;
      readyAreasAnalyzed.push(area);
      const nested = Array.isArray(block.findings) ? block.findings : [];
      for (const f of nested) {
        const coerced = coerceFinding(f, area);
        if (coerced) findings.push(coerced);
      }
      unknowns.push(...asStringArray(block.gaps));
      limitations.push(...asStringArray(block.warnings));
    }

    return {
      schemaVersion:
        typeof obj.schemaVersion === "string" && obj.schemaVersion
          ? obj.schemaVersion
          : "analysis-output.v1",
      summary:
        typeof obj.summary === "string" && obj.summary
          ? obj.summary
          : `Marketplace analysis for: ${readyAreasAnalyzed.join(", ") || "requested areas"}.`,
      readyAreasAnalyzed,
      blockedAreasSkipped: asStringArray(obj.blockedAreasSkipped).filter((a) =>
        ANALYSIS_AREAS.has(a)
      ),
      findings,
      assumptions: asStringArray(obj.assumptions),
      unknowns,
      contradictions: asStringArray(obj.contradictions),
      nextActions: asStringArray(obj.nextActions).length
        ? asStringArray(obj.nextActions)
        : ["Review findings against evidence and project memory."],
      limitations
    };
  }

  return obj;
}
