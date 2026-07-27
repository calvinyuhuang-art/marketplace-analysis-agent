import { describe, expect, it } from "vitest";
import { AnalysisOutputSchema } from "@maa/contracts";
import { coerceAnalysisCandidate } from "./coerce";

describe("coerceAnalysisCandidate", () => {
  it("flattens nested areas shape from live LLM drift", () => {
    const raw = {
      schemaVersion: "analysis-output.v1",
      areas: {
        market_structure: {
          status: "complete",
          findings: [
            {
              type: "observed_fact",
              claim: "Three listings observed.",
              confidence: "high",
              evidenceRefs: ["evid_1"]
            }
          ],
          gaps: ["No market size data."]
        },
        pricing: {
          findings: [
            {
              type: "inference",
              claim: "Price band is roughly $10-$13.",
              confidence: "medium",
              evidenceRefs: ["evid_1"]
            }
          ]
        }
      }
    };

    const coerced = coerceAnalysisCandidate(raw);
    const parsed = AnalysisOutputSchema.safeParse(coerced);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.readyAreasAnalyzed).toEqual(["market_structure", "pricing"]);
    expect(parsed.data.findings).toHaveLength(2);
    expect(parsed.data.findings[0]?.classification).toBe("observed_fact");
    expect(parsed.data.findings[0]?.confidence).toBeGreaterThan(0.8);
    expect(parsed.data.unknowns).toContain("No market size data.");
  });

  it("fills missing finding ids and freshness on flat findings", () => {
    const coerced = coerceAnalysisCandidate({
      summary: "ok",
      readyAreasAnalyzed: ["pricing"],
      blockedAreasSkipped: [],
      findings: [
        {
          statement: "Price is $9.99",
          analysisArea: "pricing",
          classification: "observed_fact",
          evidenceRefs: ["e1"],
          confidence: 0.7
        }
      ]
    });
    const parsed = AnalysisOutputSchema.safeParse(coerced);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.findings[0]?.findingId).toMatch(/^fnd_/);
    expect(parsed.data.findings[0]?.freshness.status).toBe("current");
  });
});
