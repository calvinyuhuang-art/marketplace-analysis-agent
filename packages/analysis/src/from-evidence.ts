import {
  IdPrefix,
  newId,
  type AnalysisArea,
  type AnalysisOutput,
  type Finding
} from "@maa/contracts";
import type { AnalysisPromptPayload } from "./prompt";

function freshnessNow(): Finding["freshness"] {
  const evaluatedAt = new Date().toISOString();
  return { status: "current", evaluatedAt, newestEvidenceAt: evaluatedAt };
}

/**
 * Deterministic structured analysis used by the fake provider fixture
 * `analysis.v1.from-evidence`. Builds findings only from supplied evidence —
 * never invents customer preferences without review text.
 */
export function generateFromEvidence(payload: AnalysisPromptPayload): AnalysisOutput {
  const listings = payload.evidenceItems.filter((i) => i.sourceType === "listing");
  const reviews = payload.evidenceItems.filter(
    (i) => i.sourceType === "review" || i.sourceType === "qa"
  );
  const findings: Finding[] = [];
  const assumptions: string[] = [];
  const unknowns: string[] = [];
  const nowFresh = freshnessNow();

  const areaSet = new Set(payload.plan.areasToAnalyze);
  const approvedMemory = payload.approvedMemory ?? [];
  const failureCorrections = payload.failureCorrections ?? [];

  // Cite approved project memory when present (second-run continuity).
  for (const mem of approvedMemory.slice(0, 3)) {
    const preferred =
      (mem.analysisArea as AnalysisArea | undefined) &&
      areaSet.has(mem.analysisArea as AnalysisArea)
        ? (mem.analysisArea as AnalysisArea)
        : areaSet.has("opportunity_summary")
          ? ("opportunity_summary" as AnalysisArea)
          : areaSet.has("market_structure")
            ? ("market_structure" as AnalysisArea)
            : ([...areaSet][0] as AnalysisArea | undefined);
    if (!preferred) continue;
    findings.push({
      findingId: newId(IdPrefix.finding),
      statement: `Prior project memory: ${mem.statement}`,
      analysisArea: preferred,
      classification: "validated_memory",
      scope: { subjectIds: [] },
      evidenceRefs: [],
      memoryRefs: [mem.memoryId],
      confidence: Math.min(0.85, mem.confidence),
      freshness: nowFresh,
      contradictions: [],
      downstreamImplications: ["Reaffirm or revise against current evidence."],
      validationStatus: "unreviewed",
      tags: ["from_project_memory"]
    });
  }

  for (const corr of failureCorrections.slice(0, 2)) {
    unknowns.push(`Failure correction in effect: ${corr.statement}`);
  }

  if (areaSet.has("market_structure") && listings.length > 0) {
    findings.push({
      findingId: newId(IdPrefix.finding),
      statement: `Observed ${listings.length} comparable listings in the supplied evidence package.`,
      analysisArea: "market_structure",
      classification: "observed_fact",
      scope: {
        subjectIds: [...new Set(listings.map((l) => l.subjectId))],
        platform: "amazon",
        marketplace: "US"
      },
      evidenceRefs: listings.slice(0, 5).map((l) => l.evidenceId),
      memoryRefs: [],
      confidence: 0.9,
      freshness: nowFresh,
      contradictions: [],
      downstreamImplications: ["Competitor set size is sufficient for structure discussion."],
      validationStatus: "unreviewed",
      tags: []
    });
  }

  if (areaSet.has("pricing")) {
    const priced = listings.filter((l) => typeof l.fields.price === "number");
    const formats = new Set(
      priced.map((l) => String(l.fields.format ?? "").toLowerCase()).filter(Boolean)
    );
    if (priced.length > 0) {
      const prices = priced.map((l) => Number(l.fields.price));
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      const segmented = formats.size <= 1;
      findings.push({
        findingId: newId(IdPrefix.finding),
        statement: segmented
          ? `Observed price band ${min.toFixed(2)}–${max.toFixed(2)} ${String(priced[0]?.fields.currency ?? "USD")} within format '${[...formats][0] ?? "unspecified"}'.`
          : `Observed prices spanning formats (${[...formats].join(", ")}); compare only within format segments.`,
        analysisArea: "pricing",
        classification: "observed_fact",
        scope: { subjectIds: priced.map((p) => p.subjectId) },
        evidenceRefs: priced.map((p) => p.evidenceId),
        memoryRefs: [],
        confidence: segmented ? 0.85 : 0.7,
        freshness: nowFresh,
        contradictions: [],
        downstreamImplications: segmented
          ? ["Use the observed band as a pricing reference for the same format."]
          : ["Do not blend paperback and hardcover into one band."],
        validationStatus: "unreviewed",
        tags: segmented ? ["format_segmented"] : ["mixed_format_segmented"]
      });
    } else {
      unknowns.push("No priced listings available for pricing analysis.");
    }
  }

  if (areaSet.has("customer_evidence")) {
    const withText = reviews.filter((r) => (r.textContent ?? "").trim().length > 0);
    if (withText.length > 0) {
      findings.push({
        findingId: newId(IdPrefix.finding),
        statement:
          "Customer reviews mention paper quality / marker bleed and relaxing or cozy mood as recurring themes in the supplied review text.",
        analysisArea: "customer_evidence",
        classification: "source_reported_claim",
        scope: { subjectIds: [...new Set(withText.map((r) => r.subjectId))] },
        evidenceRefs: withText.slice(0, 6).map((r) => r.evidenceId),
        memoryRefs: [],
        confidence: 0.7,
        freshness: nowFresh,
        contradictions: [],
        downstreamImplications: [
          "Validate paper expectations in listing copy if bleed-through is common."
        ],
        validationStatus: "unreviewed",
        tags: []
      });
    } else {
      unknowns.push("Customer preferences cannot be concluded without direct review/Q&A text.");
    }
  }

  if (areaSet.has("positioning") && listings.length > 0) {
    const withPos = listings.filter(
      (l) => typeof l.fields.positioningText === "string" || (l.textContent ?? "").length > 0
    );
    if (withPos.length > 0) {
      findings.push({
        findingId: newId(IdPrefix.finding),
        statement:
          "Listing positioning text emphasizes cozy/atmospheric themes among the supplied competitors.",
        analysisArea: "positioning",
        classification: "inference",
        scope: { subjectIds: withPos.map((l) => l.subjectId) },
        evidenceRefs: withPos.map((l) => l.evidenceId),
        memoryRefs: [],
        confidence: 0.6,
        freshness: nowFresh,
        contradictions: [],
        downstreamImplications: ["Theme coherence is a plausible differentiation axis."],
        validationStatus: "unreviewed",
        tags: []
      });
    }
  }

  for (const area of payload.plan.areasToSkip) {
    unknowns.push(`Analysis area '${area}' was skipped due to insufficient evidence.`);
  }

  if (findings.length === 0 && payload.plan.areasToAnalyze.length > 0) {
    assumptions.push("No concrete findings could be derived from the ready evidence set.");
  }

  return {
    schemaVersion: payload.outputSchemaVersion,
    summary:
      findings.length > 0
        ? `Structured marketplace analysis produced ${findings.length} finding(s) across ${payload.plan.areasToAnalyze.length} ready area(s).`
        : "No findings produced; evidence gaps dominate.",
    readyAreasAnalyzed: payload.plan.areasToAnalyze,
    blockedAreasSkipped: payload.plan.areasToSkip,
    findings,
    assumptions,
    unknowns,
    contradictions: [],
    nextActions:
      payload.plan.areasToSkip.length > 0
        ? ["Collect supplemental evidence for blocked areas, then revise."]
        : ["Review findings and decide whether to proceed to strategy handoff."],
    limitations:
      payload.plan.areasToSkip.length > 0
        ? ["Blocked areas must not be treated as complete conclusions."]
        : []
  };
}

/**
 * Deterministic comparative analysis: contrast baseline vs compare packages.
 */
export function generateComparativeFromEvidence(
  payload: AnalysisPromptPayload
): AnalysisOutput {
  const baseline = payload.baselineEvidenceItems ?? [];
  const compare = payload.compareEvidenceItems ?? payload.evidenceItems;
  const baselineListings = baseline.filter((i) => i.sourceType === "listing");
  const compareListings = compare.filter((i) => i.sourceType === "listing");
  const nowFresh = freshnessNow();
  const findings: Finding[] = [];
  const areaSet = new Set(payload.plan.areasToAnalyze);

  if (areaSet.has("market_structure") || areaSet.has("competitor_set")) {
    findings.push({
      findingId: newId(IdPrefix.finding),
      statement: `Comparative set sizes: baseline ${baselineListings.length} listing(s) vs compare ${compareListings.length} listing(s).`,
      analysisArea: areaSet.has("market_structure") ? "market_structure" : "competitor_set",
      classification: "observed_fact",
      scope: {
        subjectIds: [
          ...new Set([
            ...baselineListings.map((l) => l.subjectId),
            ...compareListings.map((l) => l.subjectId)
          ])
        ],
        platform: "amazon",
        marketplace: "US"
      },
      evidenceRefs: [
        ...baselineListings.slice(0, 3).map((l) => l.evidenceId),
        ...compareListings.slice(0, 3).map((l) => l.evidenceId)
      ],
      memoryRefs: [],
      confidence: 0.9,
      freshness: nowFresh,
      contradictions: [],
      downstreamImplications: ["Use size delta only within the same capability pack."],
      validationStatus: "unreviewed",
      tags: ["comparative_baseline", "comparative_compare"]
    });
  }

  if (areaSet.has("pricing")) {
    const avg = (items: typeof baselineListings): number | null => {
      const prices = items
        .map((i) => i.fields.price)
        .filter((p): p is number => typeof p === "number");
      if (prices.length === 0) return null;
      return prices.reduce((a, b) => a + b, 0) / prices.length;
    };
    const baseAvg = avg(baselineListings);
    const cmpAvg = avg(compareListings);
    if (baseAvg != null && cmpAvg != null) {
      const delta = Math.round((cmpAvg - baseAvg) * 100) / 100;
      findings.push({
        findingId: newId(IdPrefix.finding),
        statement: `Compare-side mean price is $${cmpAvg.toFixed(2)} vs baseline $${baseAvg.toFixed(2)} (delta $${delta.toFixed(2)}).`,
        analysisArea: "pricing",
        classification: "inference",
        scope: {
          subjectIds: [
            ...new Set([
              ...baselineListings.map((l) => l.subjectId),
              ...compareListings.map((l) => l.subjectId)
            ])
          ]
        },
        evidenceRefs: [
          ...baselineListings.filter((l) => typeof l.fields.price === "number").map((l) => l.evidenceId),
          ...compareListings.filter((l) => typeof l.fields.price === "number").map((l) => l.evidenceId)
        ],
        memoryRefs: [],
        confidence: 0.75,
        freshness: nowFresh,
        contradictions: [],
        downstreamImplications: ["Segment by binding/format before pricing decisions."],
        validationStatus: "unreviewed",
        tags: ["comparative_pricing"]
      });
    } else {
      findings.push({
        findingId: newId(IdPrefix.finding),
        statement:
          "Comparative pricing could not be computed because one side lacks numeric prices.",
        analysisArea: "pricing",
        classification: "unknown",
        scope: { subjectIds: [] },
        evidenceRefs: [],
        memoryRefs: [],
        confidence: 0.4,
        freshness: nowFresh,
        contradictions: [],
        downstreamImplications: [],
        validationStatus: "unreviewed",
        tags: ["comparative_pricing"]
      });
    }
  }

  return {
    schemaVersion: payload.outputSchemaVersion,
    summary: `Comparative analysis across baseline (${baselineListings.length}) and compare (${compareListings.length}) listing sets.`,
    readyAreasAnalyzed: payload.plan.areasToAnalyze,
    blockedAreasSkipped: payload.plan.areasToSkip,
    findings,
    assumptions: [],
    unknowns: payload.plan.areasToSkip.map(
      (a) => `Area '${a}' skipped in comparative run due to readiness.`
    ),
    contradictions: [],
    nextActions: ["Review comparative deltas before strategy handoff."],
    limitations: ["Comparison is valid only within matching capability coordinates."]
  };
}

/** Malicious/bad fixtures for quality-gate tests. */
export function unsupportedCustomerClaimOutput(
  areas: AnalysisArea[] = ["customer_evidence"],
  /** Listing-only evidence id — schema-valid but not review/Q&A text. */
  listingEvidenceId = "evid_listing_only"
): AnalysisOutput {
  return {
    schemaVersion: "analysis-output.v1",
    summary: "Customers prefer thicker paper.",
    readyAreasAnalyzed: areas,
    blockedAreasSkipped: [],
    findings: [
      {
        findingId: newId(IdPrefix.finding),
        statement: "Customers prefer thicker paper based on star ratings alone.",
        analysisArea: "customer_evidence",
        classification: "observed_fact",
        scope: { subjectIds: ["B1"] },
        evidenceRefs: [listingEvidenceId],
        memoryRefs: [],
        confidence: 0.95,
        freshness: freshnessNow(),
        contradictions: [],
        downstreamImplications: [],
        validationStatus: "unreviewed",
        tags: ["from_rating_count_only"]
      }
    ],
    assumptions: [],
    unknowns: [],
    contradictions: [],
    nextActions: ["Ship product"],
    limitations: []
  };
}

export function mixedFormatPriceOutput(): AnalysisOutput {
  return {
    schemaVersion: "analysis-output.v1",
    summary: "Average market price is $14.99 across formats.",
    readyAreasAnalyzed: ["pricing"],
    blockedAreasSkipped: [],
    findings: [
      {
        findingId: newId(IdPrefix.finding),
        statement: "Average price across paperback and hardcover is $14.99.",
        analysisArea: "pricing",
        classification: "observed_fact",
        scope: { subjectIds: ["B1", "B2"] },
        evidenceRefs: ["evid_missing"],
        memoryRefs: [],
        confidence: 0.9,
        freshness: freshnessNow(),
        contradictions: [],
        downstreamImplications: [],
        validationStatus: "unreviewed",
        tags: ["mixed_format_unsegmented"]
      }
    ],
    assumptions: [],
    unknowns: [],
    contradictions: [],
    nextActions: [],
    limitations: []
  };
}
