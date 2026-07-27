import type { AnalysisArea, ReadinessReport } from "@maa/contracts";

export interface AnalysisPlan {
  promptVersion: string;
  schemaVersion: string;
  areasToAnalyze: AnalysisArea[];
  areasToSkip: AnalysisArea[];
  fixtureKey: string;
}

/**
 * Deterministic planner: areas come from readiness, not from the model.
 */
export function planAnalysis(input: {
  requestedAreas: AnalysisArea[];
  readiness?: ReadinessReport;
  operation: string;
  fixtureKey?: string;
}): AnalysisPlan {
  const areasToAnalyze: AnalysisArea[] = [];
  const areasToSkip: AnalysisArea[] = [];

  if (input.readiness) {
    for (const area of input.requestedAreas) {
      const row = input.readiness.areas.find((a) => a.area === area);
      if (!row || row.allowedOutputLevel === "none") {
        areasToSkip.push(area);
      } else {
        areasToAnalyze.push(area);
      }
    }
  } else {
    areasToAnalyze.push(...input.requestedAreas);
  }

  return {
    promptVersion: "full-analysis.v1",
    schemaVersion: "analysis-output.v1",
    areasToAnalyze,
    areasToSkip,
    fixtureKey: input.fixtureKey ?? "analysis.v1.from-evidence"
  };
}
