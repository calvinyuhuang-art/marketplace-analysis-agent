import { describe, expect, it } from "vitest";
import { phaseDisplayLabel, PHASE_DISPLAY_LABELS } from "./phase-aliases";

describe("phase display aliases", () => {
  it("maps known phases to human labels", () => {
    expect(phaseDisplayLabel("analyzing")).toBe("Analyzing");
    expect(phaseDisplayLabel("awaiting_evidence")).toBe("Awaiting evidence");
    expect(phaseDisplayLabel("completed")).toBe("Completed");
  });

  it("falls back for unknown values", () => {
    expect(phaseDisplayLabel("custom_phase")).toBe("custom_phase");
    expect(phaseDisplayLabel(null)).toBe("Unknown");
  });

  it("covers core run statuses", () => {
    expect(PHASE_DISPLAY_LABELS.failed).toBe("Failed");
    expect(PHASE_DISPLAY_LABELS.evidence_insufficient).toBe("Evidence insufficient");
  });
});
