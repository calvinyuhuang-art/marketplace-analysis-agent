import { describe, expect, it } from "vitest";
import {
  completeKdpFixture,
  listingsWithoutReviewsFixture,
  mixedFormatsFixture,
  promptInjectionFixture,
  staleEvidenceFixture
} from "../../../fixtures/evidence/kdp-fixtures";
import { evaluateReadiness, buildCollectionRequests } from "./readiness";

const AREAS = [
  "market_structure",
  "competitor_set",
  "customer_evidence",
  "pricing",
  "positioning",
  "keywords_categories"
] as const;

describe("Amazon KDP readiness evaluator", () => {
  it("marks expected areas ready for a complete fixture", () => {
    const pkg = completeKdpFixture();
    const report = evaluateReadiness({
      items: pkg.items,
      requestedAreas: [...AREAS],
      packageIds: [pkg.packageId!],
      platform: "amazon",
      marketplace: "US",
      now: new Date("2026-07-20T12:00:00.000Z")
    });
    expect(report.overallStatus).toBe("ready");
    expect(report.readyAreas).toContain("customer_evidence");
    expect(report.readyAreas).toContain("pricing");
    expect(report.blockedAreas).toHaveLength(0);
  });

  it("blocks customer_evidence when reviews are missing", () => {
    const pkg = listingsWithoutReviewsFixture();
    const report = evaluateReadiness({
      items: pkg.items,
      requestedAreas: ["market_structure", "customer_evidence", "pricing"],
      packageIds: [pkg.packageId!],
      platform: "amazon",
      marketplace: "US",
      now: new Date("2026-07-20T12:00:00.000Z")
    });
    const customer = report.areas.find((a) => a.area === "customer_evidence")!;
    expect(customer.status).toBe("insufficient");
    expect(customer.allowedOutputLevel).toBe("none");
    expect(report.readyAreas).toContain("market_structure");
    expect(report.overallStatus).toBe("partial");

    const collections = buildCollectionRequests(report, {
      platform: "amazon",
      marketplace: "US"
    });
    const customerReq = collections.find((c) =>
      c.analysisAreasBlocked.includes("customer_evidence")
    );
    expect(customerReq).toBeTruthy();
    expect(customerReq!.requiredEvidence).toContain("review_text");
    expect(customerReq!.completionRule.minimumReviews).toBe(5);
    expect(customerReq!.completionRule.requiredFields.length).toBeGreaterThan(0);
  });

  it("warns or blocks unsegmented mixed-format pricing", () => {
    const pkg = mixedFormatsFixture();
    // Keep mixed formats but strip format from one priced listing.
    const items = pkg.items.map((i) => {
      if (i.evidenceId.endsWith("evid_mf3")) {
        const fields = { ...i.fields };
        delete fields.format;
        return { ...i, fields };
      }
      return i;
    });
    const report = evaluateReadiness({
      items,
      requestedAreas: ["pricing"],
      packageIds: [pkg.packageId!],
      platform: "amazon",
      marketplace: "US",
      now: new Date("2026-07-20T12:00:00.000Z")
    });
    const pricing = report.areas.find((a) => a.area === "pricing")!;
    expect(["blocked", "insufficient"]).toContain(pricing.status);
    expect(pricing.gaps.some((g) => g.field === "format")).toBe(true);
  });

  it("warns on mixed formats when all listings are segmented", () => {
    const pkg = mixedFormatsFixture();
    const report = evaluateReadiness({
      items: pkg.items,
      requestedAreas: ["pricing"],
      packageIds: [pkg.packageId!],
      platform: "amazon",
      marketplace: "US",
      now: new Date("2026-07-20T12:00:00.000Z")
    });
    const pricing = report.areas.find((a) => a.area === "pricing")!;
    expect(pricing.warnings.some((w) => w.includes("Mixed formats"))).toBe(true);
    expect(pricing.allowedOutputLevel).not.toBe("none");
  });

  it("treats stale evidence as non-fresh", () => {
    const pkg = staleEvidenceFixture();
    const report = evaluateReadiness({
      items: pkg.items,
      requestedAreas: ["market_structure", "customer_evidence"],
      packageIds: [pkg.packageId!],
      platform: "amazon",
      marketplace: "US",
      now: new Date("2026-07-20T12:00:00.000Z")
    });
    expect(report.warnings.some((w) => w.includes("stale"))).toBe(true);
    expect(report.overallStatus).toBe("insufficient");
  });

  it("keeps prompt-injection review text as inert data and still scores coverage", () => {
    const pkg = promptInjectionFixture();
    expect(pkg.items.some((i) => (i.textContent ?? "").includes("Ignore previous instructions"))).toBe(
      true
    );
    const report = evaluateReadiness({
      items: pkg.items,
      requestedAreas: ["customer_evidence"],
      packageIds: [pkg.packageId!],
      platform: "amazon",
      marketplace: "US",
      now: new Date("2026-07-20T12:00:00.000Z")
    });
    // Injection text still counts as review text — it does not override rules.
    expect(report.areas[0]!.status).toBe("ready");
  });
});
