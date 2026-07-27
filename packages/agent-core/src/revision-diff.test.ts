import { describe, expect, it } from "vitest";
import { buildRevisionDiff } from "./revision-diff";

describe("buildRevisionDiff", () => {
  it("marks replaced findings in affected areas", () => {
    const diff = buildRevisionDiff({
      priorRunId: "run_a",
      revisionRunId: "run_b",
      affectedAreas: ["pricing"],
      priorFindings: [
        {
          findingId: "fnd_1",
          analysisArea: "pricing",
          statement: "Band is $9–$12",
          validationStatus: "reviewer_rejected"
        },
        {
          findingId: "fnd_2",
          analysisArea: "positioning",
          statement: "Cozy theme",
          validationStatus: "system_validated"
        }
      ],
      newFindings: [
        {
          findingId: "fnd_3",
          analysisArea: "pricing",
          statement: "Band is $9.99–$12.99 paperback",
          validationStatus: "system_validated"
        }
      ]
    });
    expect(diff.entries).toHaveLength(1);
    expect(diff.entries[0]?.change).toBe("replaced");
    expect(diff.entries[0]?.priorFindingId).toBe("fnd_1");
    expect(diff.entries[0]?.newFindingId).toBe("fnd_3");
  });
});
