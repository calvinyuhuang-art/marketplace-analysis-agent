import { describe, expect, it } from "vitest";
import { judgeOutcomeMetrics } from "./outcome-service";

describe("judgeOutcomeMetrics responsibility filter", () => {
  it("treats no-traffic as inconclusive, not analysis failure", () => {
    const r = judgeOutcomeMetrics({ noTraffic: true, traffic: 0, sales: 0 });
    expect(r.judgment).toBe("inconclusive_traffic_or_execution");
  });

  it("treats execution-only failure as outside MAA responsibility", () => {
    const r = judgeOutcomeMetrics({ listingPublished: false, executionBlocked: true });
    expect(r.judgment).toBe("outside_maa_responsibility");
  });

  it("supports explicit contradiction / support flags", () => {
    expect(judgeOutcomeMetrics({ contradictsAnalysis: true }).judgment).toBe("contradicted");
    expect(judgeOutcomeMetrics({ supportsAnalysis: true, traffic: 10, sales: 2 }).judgment).toBe(
      "supported"
    );
  });
});
