import { describe, expect, it } from "vitest";
import { CUSTOMER_EVIDENCE_REGRESSION_TEST_ID, extractLessonFromRejection } from "./index";

describe("lesson extraction", () => {
  it("maps unsupported customer rejection to Error Book class and regression id", () => {
    const extracted = extractLessonFromRejection({
      findingStatement: "Customers love rainy day themes.",
      analysisArea: "customer_evidence",
      reasonCode: "unsupported_conclusion",
      projectId: "proj_x"
    });
    expect(extracted.errorClass).toBe("unsupported_customer_claim");
    expect(extracted.requireDirectCustomerEvidence).toBe(true);
    expect(extracted.regressionTestIds).toContain(CUSTOMER_EVIDENCE_REGRESSION_TEST_ID);
    expect(extracted.ruleStatement.toLowerCase()).toContain("collection request");
  });
});
