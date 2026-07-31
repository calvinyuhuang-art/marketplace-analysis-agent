import type { FakeProvider } from "@maa/model-router";
import {
  generateFromEvidence,
  generateComparativeFromEvidence,
  mixedFormatPriceOutput,
  unsupportedCustomerClaimOutput
} from "./from-evidence";
import type { AnalysisPromptPayload } from "./prompt";

/**
 * Registers deterministic analysis fixtures on a FakeProvider.
 * Call once at composition time so analysis runs never invent live model calls.
 */
export function registerAnalysisFixtures(provider: FakeProvider): void {
  provider.register("analysis.v1.from-evidence", {
    build: (request) => generateFromEvidence(request.promptPayload as AnalysisPromptPayload),
    inputTokens: 250,
    outputTokens: 400,
    costUsd: 0
  });

  provider.register("analysis.v1.comparative", {
    build: (request) =>
      generateComparativeFromEvidence(request.promptPayload as AnalysisPromptPayload),
    inputTokens: 280,
    outputTokens: 420,
    costUsd: 0
  });

  provider.register("analysis.v1.repair", {
    build: (request) => {
      const payload = request.promptPayload as { previousRaw?: string };
      if (payload.previousRaw) {
        try {
          const parsed = JSON.parse(payload.previousRaw) as Record<string, unknown>;
          // Minimal structural repair: ensure required arrays exist.
          return {
            schemaVersion: parsed.schemaVersion ?? "analysis-output.v1",
            summary: typeof parsed.summary === "string" ? parsed.summary : "Repaired output.",
            readyAreasAnalyzed: Array.isArray(parsed.readyAreasAnalyzed)
              ? parsed.readyAreasAnalyzed
              : [],
            blockedAreasSkipped: Array.isArray(parsed.blockedAreasSkipped)
              ? parsed.blockedAreasSkipped
              : [],
            findings: Array.isArray(parsed.findings) ? parsed.findings : [],
            assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions : [],
            unknowns: Array.isArray(parsed.unknowns) ? parsed.unknowns : [],
            contradictions: Array.isArray(parsed.contradictions) ? parsed.contradictions : [],
            nextActions: Array.isArray(parsed.nextActions)
              ? parsed.nextActions
              : ["Review repaired output."],
            limitations: Array.isArray(parsed.limitations) ? parsed.limitations : []
          };
        } catch {
          // fall through
        }
      }
      return {
        schemaVersion: "analysis-output.v1",
        summary: "Repaired empty analysis output.",
        readyAreasAnalyzed: [],
        blockedAreasSkipped: [],
        findings: [],
        assumptions: [],
        unknowns: ["Prior model output could not be parsed."],
        contradictions: [],
        nextActions: ["Re-run analysis with valid evidence."],
        limitations: ["Repair produced a minimal placeholder."]
      };
    },
    inputTokens: 100,
    outputTokens: 150,
    costUsd: 0
  });

  provider.register("analysis.v1.unsupported-customer-claim", {
    build: () => unsupportedCustomerClaimOutput(),
    inputTokens: 50,
    outputTokens: 80,
    costUsd: 0
  });

  provider.register("analysis.v1.mixed-format-price", {
    build: () => mixedFormatPriceOutput(),
    inputTokens: 50,
    outputTokens: 80,
    costUsd: 0
  });

  provider.register("analysis.v1.invalid-then-repair", {
    data: { not: "a valid analysis output" },
    inputTokens: 40,
    outputTokens: 20,
    costUsd: 0
  });
}
