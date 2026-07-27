import { describe, expect, it } from "vitest";
import { mapRunStatusToResearchTaskState, type RunStatus } from "@maa/contracts";
import {
  isResearchTeamMaaEnabled,
  wrapEvidenceArtifact,
  unwrapEvidenceArtifact
} from "./index.js";
import { completeKdpFixture } from "../../../fixtures/evidence/kdp-fixtures";

describe("M9 research task state mapping", () => {
  const cases: Array<[RunStatus, string]> = [
    ["accepted", "queued"],
    ["planning", "running"],
    ["analyzing", "running"],
    ["evidence_insufficient", "needs_orchestrator_decision"],
    ["awaiting_evidence", "needs_orchestrator_decision"],
    ["blocked", "needs_orchestrator_decision"],
    ["completed", "ready_for_review"],
    ["failed", "failed"],
    ["cancelled", "cancelled"]
  ];

  for (const [status, expected] of cases) {
    it(`maps ${status} → ${expected}`, () => {
      expect(mapRunStatusToResearchTaskState(status)).toBe(expected);
    });
  }

  it("maps partial with collection requests to orchestrator", () => {
    expect(
      mapRunStatusToResearchTaskState("partial", { hasCollectionRequests: true })
    ).toBe("needs_orchestrator_decision");
    expect(
      mapRunStatusToResearchTaskState("partial", { hasCollectionRequests: false })
    ).toBe("ready_for_review");
  });
});

describe("M9 evidence artifact exchange", () => {
  it("wraps and unwraps packages without MCEC coupling", () => {
    const pkg = completeKdpFixture("evpkg_exchange");
    const envelope = wrapEvidenceArtifact({
      artifactId: "art_rt_1",
      package: pkg,
      correlationId: "corr_test",
      externalWorkOrderId: "wo_1"
    });
    expect(envelope.schemaVersion).toBe("maa-evidence-artifact.v1");
    expect(unwrapEvidenceArtifact(envelope).packageId).toBe("evpkg_exchange");
  });
});

describe("M9 feature flag", () => {
  it("defaults to disabled", () => {
    expect(isResearchTeamMaaEnabled({})).toBe(false);
  });
  it("enables on true/1/yes", () => {
    expect(isResearchTeamMaaEnabled({ RESEARCH_TEAM_MAA_ENABLED: "true" })).toBe(true);
    expect(isResearchTeamMaaEnabled({ RESEARCH_TEAM_MAA_ENABLED: "1" })).toBe(true);
    expect(isResearchTeamMaaEnabled({ MAA_RESEARCH_TEAM_ADAPTER: "yes" })).toBe(true);
  });
});
