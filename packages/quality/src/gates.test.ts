import { describe, expect, it } from "vitest";
import { IdPrefix, newId, type EvidenceItem, type AnalysisOutput } from "@maa/contracts";
import { runQualityGates } from "./gates";

const listingEvidence: EvidenceItem = {
  evidenceId: "evid_listing_only",
  sourceType: "listing",
  platform: "amazon",
  marketplace: "US",
  subjectId: "B1",
  title: "Sample listing",
  textContent: "Cozy rainy day coloring",
  fields: { price: 12.99, format: "paperback", currency: "USD" },
  provenance: {
    collector: "fixture",
    collectorVersion: "1",
    observedAt: "2026-07-20T12:00:00.000Z",
    sourceUrl: "https://example.com/1"
  },
  confidence: 1,
  validationStatus: "valid"
};

function freshnessNow() {
  return {
    status: "current" as const,
    evaluatedAt: "2026-07-20T12:00:00.000Z"
  };
}

describe("quality gates", () => {
  it("fails unsupported customer claim from rating count", () => {
    const output: AnalysisOutput = {
      schemaVersion: "analysis-output.v1",
      summary: "Customers prefer thicker paper.",
      readyAreasAnalyzed: ["customer_evidence"],
      blockedAreasSkipped: [],
      findings: [
        {
          findingId: newId(IdPrefix.finding),
          statement: "Customers prefer thicker paper based on star ratings alone.",
          analysisArea: "customer_evidence",
          classification: "observed_fact",
          scope: { subjectIds: ["B1"] },
          evidenceRefs: [listingEvidence.evidenceId],
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
    const report = runQualityGates({
      output,
      evidenceItems: [listingEvidence],
      requestedAreas: ["customer_evidence"]
    });
    expect(report.passed).toBe(false);
    expect(report.issues.some((i) => i.code === "CUSTOMER_PREFERENCE_FROM_RATING_COUNT")).toBe(
      true
    );
    expect(report.issues.some((i) => i.code === "CUSTOMER_CLAIM_WITHOUT_REVIEW_TEXT")).toBe(true);
  });

  it("fails mixed-format unsegmented price", () => {
    const output: AnalysisOutput = {
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
    const report = runQualityGates({
      output,
      evidenceItems: [listingEvidence],
      requestedAreas: ["pricing"]
    });
    expect(report.passed).toBe(false);
    expect(report.issues.some((i) => i.code === "MIXED_FORMAT_PRICE_UNSEGMENTED")).toBe(true);
    expect(report.issues.some((i) => i.code === "EVIDENCE_REF_UNRESOLVED")).toBe(true);
  });
});
