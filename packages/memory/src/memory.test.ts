import { describe, expect, it } from "vitest";
import { buildFtsMatchQuery } from "./fts";
import { rankMemoryItem, scopeMatchScore } from "./rank";

describe("buildFtsMatchQuery", () => {
  it("quotes tokens for AND match", () => {
    expect(buildFtsMatchQuery("paperback pricing band")).toBe(
      '"paperback" AND "pricing" AND "band"'
    );
  });

  it("supports phrase queries", () => {
    expect(buildFtsMatchQuery('look for "marker bleed" issues')).toBe('"marker bleed"');
  });
});

describe("ranking", () => {
  it("narrow project scope outranks broad", () => {
    const narrow = scopeMatchScore(
      [
        { dimension: "project", value: "proj_a" },
        { dimension: "analysis_area", value: "pricing" }
      ],
      { projectId: "proj_a", analysisAreas: ["pricing"] }
    );
    const broad = scopeMatchScore(
      [
        { dimension: "project", value: "proj_a" },
        { dimension: "platform", value: "amazon" },
        { dimension: "marketplace", value: "US" },
        { dimension: "category", value: "books" },
        { dimension: "product_type", value: "adult_coloring_book" },
        { dimension: "analysis_area", value: "pricing" }
      ],
      { projectId: "proj_a", analysisAreas: ["pricing"] }
    );
    expect(narrow.breadth).toBeLessThan(broad.breadth);

    const narrowRank = rankMemoryItem({
      item: {
        memoryId: "m1",
        memoryType: "accepted_finding",
        authorityStatus: "reviewed_project",
        title: "t",
        statement: "s",
        summary: null,
        confidence: 0.9,
        supportCount: 1,
        contradictionCount: 0,
        validFrom: null,
        validUntil: null,
        lastReaffirmedAt: new Date().toISOString(),
        createdFromRunId: null,
        createdFromLearningEventId: null,
        currentVersionId: null,
        payloadJson: "{}",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      scopes: [
        { dimension: "project", value: "proj_a" },
        { dimension: "analysis_area", value: "pricing" }
      ],
      query: { projectId: "proj_a", analysisAreas: ["pricing"] },
      textRelevance: 0.8
    });
    const broadRank = rankMemoryItem({
      item: {
        memoryId: "m2",
        memoryType: "accepted_finding",
        authorityStatus: "reviewed_project",
        title: "t",
        statement: "s",
        summary: null,
        confidence: 0.9,
        supportCount: 1,
        contradictionCount: 0,
        validFrom: null,
        validUntil: null,
        lastReaffirmedAt: new Date().toISOString(),
        createdFromRunId: null,
        createdFromLearningEventId: null,
        currentVersionId: null,
        payloadJson: "{}",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      scopes: [
        { dimension: "project", value: "proj_a" },
        { dimension: "platform", value: "amazon" },
        { dimension: "marketplace", value: "US" },
        { dimension: "category", value: "books" },
        { dimension: "product_type", value: "x" },
        { dimension: "analysis_area", value: "pricing" }
      ],
      query: { projectId: "proj_a", analysisAreas: ["pricing"] },
      textRelevance: 0.8
    });
    expect(narrowRank.score).toBeGreaterThan(broadRank.score);
  });
});
