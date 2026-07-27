import {
  IdPrefix,
  newId,
  type AnalysisArea,
  type AreaReadiness,
  type CollectionRequest,
  type EvidenceGap,
  type EvidenceItem,
  type EvidenceRequirementResult,
  type ReadinessReport
} from "@maa/contracts";
import { AREA_REQUIREMENTS, type AreaRequirementConfig } from "./capability";

export interface ReadinessInput {
  items: EvidenceItem[];
  requestedAreas: AnalysisArea[];
  packageIds: string[];
  platform: string;
  marketplace: string;
  /** Evaluation clock — injectable for stale-evidence tests. */
  now?: Date;
  runId?: string;
}

function ageDays(observedAt: string, now: Date): number {
  const observed = Date.parse(observedAt);
  if (Number.isNaN(observed)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - observed) / (1000 * 60 * 60 * 24);
}

function listings(items: EvidenceItem[]): EvidenceItem[] {
  return items.filter((i) => i.sourceType === "listing");
}

function reviews(items: EvidenceItem[]): EvidenceItem[] {
  return items.filter((i) => i.sourceType === "review" || i.sourceType === "qa");
}

function fieldValue(item: EvidenceItem, field: string): unknown {
  if (field === "title") return item.title ?? item.fields.title;
  if (field === "subjectId") return item.subjectId;
  if (field === "textContent") return item.textContent;
  return item.fields[field];
}

function hasField(item: EvidenceItem, field: string): boolean {
  const v = fieldValue(item, field);
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  return true;
}

function evaluateArea(
  config: AreaRequirementConfig,
  items: EvidenceItem[],
  now: Date
): AreaReadiness {
  const required: EvidenceRequirementResult[] = [];
  const gaps: EvidenceGap[] = [];
  const warnings: string[] = [];
  const refs: string[] = [];

  const listingItems = listings(items);
  const reviewItems = reviews(items);
  const maxAge = config.maxAgeDays;

  const freshListings = listingItems.filter((i) => {
    const age = ageDays(i.provenance.observedAt, now);
    if (maxAge !== undefined && age > maxAge) {
      warnings.push(
        `Listing ${i.evidenceId} is stale (${Math.floor(age)} days old; max ${maxAge}).`
      );
      return false;
    }
    refs.push(i.evidenceId);
    return true;
  });

  const freshReviews = reviewItems.filter((i) => {
    const age = ageDays(i.provenance.observedAt, now);
    if (maxAge !== undefined && age > maxAge) {
      warnings.push(
        `Review/Q&A ${i.evidenceId} is stale (${Math.floor(age)} days old; max ${maxAge}).`
      );
      return false;
    }
    refs.push(i.evidenceId);
    return true;
  });

  // Market / competitor / opportunity listing counts
  if (config.minimumListings !== undefined) {
    const ok = freshListings.length >= config.minimumListings;
    required.push({
      requirementId: "min_listings",
      description: `At least ${config.minimumListings} comparable listings`,
      satisfied: ok,
      detail: `found ${freshListings.length}`
    });
    if (!ok) {
      gaps.push({
        gapId: newId(IdPrefix.gap),
        field: "listings",
        description: `Need at least ${config.minimumListings} fresh listings (have ${freshListings.length}).`,
        severity: "high"
      });
    }
  }

  if (config.requiredListingFields) {
    for (const field of config.requiredListingFields) {
      const withField = freshListings.filter((i) => hasField(i, field));
      const ok =
        field === "title" || field === "subjectId"
          ? withField.length >= (config.minimumListings ?? 1)
          : withField.length >= Math.min(config.minimumListings ?? 1, freshListings.length || 1) &&
            (freshListings.length === 0 ? false : withField.length > 0);

      // More precise: majority of listings should have the field when listings exist.
      const ratioOk =
        freshListings.length === 0
          ? false
          : withField.length / freshListings.length >= 0.8 ||
            withField.length >= (config.minimumListings ?? 1);

      const satisfied =
        field === "price" || field === "currency" || field === "format" || field === "pageCount"
          ? ratioOk
          : ok && ratioOk;

      required.push({
        requirementId: `listing_field_${field}`,
        description: `Listings include ${field}`,
        satisfied,
        detail: `${withField.length}/${freshListings.length} listings`
      });
      if (!satisfied) {
        gaps.push({
          gapId: newId(IdPrefix.gap),
          field,
          description: `Missing required listing field '${field}'.`,
          severity: field === "price" || field === "format" ? "critical" : "high"
        });
      }
    }
  }

  if (config.requireDirectCustomerText) {
    const withText = freshReviews.filter(
      (i) => typeof i.textContent === "string" && i.textContent.trim().length > 0
    );
    const ok = withText.length > 0;
    required.push({
      requirementId: "direct_review_text",
      description: "Direct review or Q&A text is present",
      satisfied: ok,
      detail: `${withText.length} items with text`
    });
    if (!ok) {
      gaps.push({
        gapId: newId(IdPrefix.gap),
        field: "review_text",
        description: "Direct customer review/Q&A text is required.",
        severity: "critical"
      });
    }
  }

  if (config.minimumReviews !== undefined) {
    const withText = freshReviews.filter(
      (i) => typeof i.textContent === "string" && i.textContent.trim().length > 0
    );
    const ok = withText.length >= config.minimumReviews;
    required.push({
      requirementId: "min_reviews",
      description: `At least ${config.minimumReviews} review/Q&A items with text`,
      satisfied: ok,
      detail: `found ${withText.length}`
    });
    if (!ok) {
      gaps.push({
        gapId: newId(IdPrefix.gap),
        field: "reviews",
        description: `Need at least ${config.minimumReviews} reviews with text (have ${withText.length}).`,
        severity: "critical"
      });
    }
  }

  if (config.minimumProductsWithReviews !== undefined) {
    const withText = freshReviews.filter(
      (i) => typeof i.textContent === "string" && i.textContent.trim().length > 0
    );
    const products = new Set(withText.map((i) => i.subjectId));
    const ok = products.size >= config.minimumProductsWithReviews;
    required.push({
      requirementId: "multi_product_coverage",
      description: `Reviews cover at least ${config.minimumProductsWithReviews} products`,
      satisfied: ok,
      detail: `${products.size} products`
    });
    if (!ok) {
      gaps.push({
        gapId: newId(IdPrefix.gap),
        field: "review_product_coverage",
        description: `Need reviews across ${config.minimumProductsWithReviews} products (have ${products.size}).`,
        severity: "high"
      });
    }
  }

  if (config.blockUnsegmentedMixedFormats) {
    const formats = new Set(
      freshListings
        .map((i) => String(fieldValue(i, "format") ?? "").toLowerCase().trim())
        .filter((f) => f.length > 0)
    );
    const mixed = formats.size > 1;
    const segmented = freshListings.every((i) => hasField(i, "format"));
    const ok = !mixed || segmented;
    required.push({
      requirementId: "format_segmented",
      description: "Comparable prices share format or are explicitly segmented",
      satisfied: ok,
      detail: mixed
        ? `mixed formats detected: ${[...formats].join(", ")}`
        : "single format or none"
    });
    if (mixed && segmented) {
      warnings.push(
        `Mixed formats present (${[...formats].join(", ")}). Pricing analysis must segment by format.`
      );
    }
    if (mixed && !segmented) {
      gaps.push({
        gapId: newId(IdPrefix.gap),
        field: "format",
        description:
          "Mixed paperback/hardcover (or other) prices without format segmentation are blocked.",
        severity: "critical"
      });
    }
  }

  if (config.area === "risk_ip_policy") {
    const riskItems = items.filter(
      (i) =>
        i.sourceType === "policy_page" ||
        Boolean(i.fields.brandSignal) ||
        Boolean(i.fields.trademarkSignal) ||
        Boolean(i.fields.policyReference)
    );
    for (const i of riskItems) refs.push(i.evidenceId);
    const ok = riskItems.length > 0;
    required.push({
      requirementId: "risk_signals_or_policy",
      description: "Brand/trademark indicators or policy references present",
      satisfied: ok,
      detail: `${riskItems.length} risk/policy items`
    });
    if (!ok) {
      gaps.push({
        gapId: newId(IdPrefix.gap),
        field: "risk_signals",
        description: "No brand/trademark/policy evidence available.",
        severity: "medium"
      });
    }
  }

  if (config.area === "evidence_sufficiency") {
    const ok = items.length > 0;
    required.push({
      requirementId: "package_present",
      description: "At least one evidence item is available",
      satisfied: ok
    });
    if (!ok) {
      gaps.push({
        gapId: newId(IdPrefix.gap),
        field: "evidence",
        description: "No evidence items available.",
        severity: "critical"
      });
    }
  }

  // Ensure every declared requirement has a result entry (fill any missed).
  for (const def of config.requirements) {
    if (!required.some((r) => r.requirementId === def.requirementId)) {
      // Already covered by specialized checks above; skip duplicates.
    }
  }

  const unsatisfied = required.filter((r) => !r.satisfied);
  const criticalGaps = gaps.filter((g) => g.severity === "critical");
  let status: AreaReadiness["status"];
  let allowedOutputLevel: AreaReadiness["allowedOutputLevel"];
  let score: number;

  if (required.length === 0) {
    status = "ready";
    allowedOutputLevel = "complete";
    score = 1;
  } else if (unsatisfied.length === 0) {
    status = warnings.some((w) => w.includes("stale")) ? "partial" : "ready";
    allowedOutputLevel = status === "ready" ? "complete" : "limited";
    score = status === "ready" ? 1 : 0.75;
  } else if (criticalGaps.length > 0 || unsatisfied.length === required.length) {
    status = "insufficient";
    allowedOutputLevel = "none";
    score = Math.max(0, 1 - unsatisfied.length / required.length);
  } else {
    status = "partial";
    allowedOutputLevel = "limited";
    score = Math.max(0.2, 1 - unsatisfied.length / required.length);
  }

  // Mixed-format block elevates to blocked for pricing.
  if (
    config.blockUnsegmentedMixedFormats &&
    gaps.some((g) => g.field === "format" && g.severity === "critical")
  ) {
    status = "blocked";
    allowedOutputLevel = "none";
  }

  return {
    area: config.area,
    status,
    score: Math.round(score * 100) / 100,
    required,
    availableEvidenceRefs: [...new Set(refs)],
    gaps,
    warnings,
    allowedOutputLevel
  };
}

export function evaluateReadiness(input: ReadinessInput): ReadinessReport {
  const now = input.now ?? new Date();
  const areas: AreaReadiness[] = [];

  for (const area of input.requestedAreas) {
    const config = AREA_REQUIREMENTS.find((c) => c.area === area);
    if (!config) {
      areas.push({
        area,
        status: "blocked",
        score: 0,
        required: [],
        availableEvidenceRefs: [],
        gaps: [
          {
            gapId: newId(IdPrefix.gap),
            field: "capability",
            description: `No readiness rules for area '${area}'.`,
            severity: "high"
          }
        ],
        warnings: [],
        allowedOutputLevel: "none"
      });
      continue;
    }
    areas.push(evaluateArea(config, input.items, now));
  }

  const readyAreas = areas
    .filter((a) => a.status === "ready" || a.status === "partial")
    .filter((a) => a.allowedOutputLevel !== "none")
    .map((a) => a.area);
  const blockedAreas = areas
    .filter(
      (a) =>
        a.status === "insufficient" ||
        a.status === "blocked" ||
        a.allowedOutputLevel === "none"
    )
    .map((a) => a.area);

  let overallStatus: ReadinessReport["overallStatus"];
  if (areas.every((a) => a.status === "ready")) {
    overallStatus = "ready";
  } else if (readyAreas.length === 0) {
    overallStatus = "insufficient";
  } else if (areas.some((a) => a.status === "blocked")) {
    overallStatus = "partial";
  } else {
    overallStatus = "partial";
  }

  return {
    runId: input.runId,
    packageIds: input.packageIds,
    evaluatedAt: now.toISOString(),
    overallStatus,
    areas,
    readyAreas,
    blockedAreas,
    warnings: areas.flatMap((a) => a.warnings)
  };
}

export function buildCollectionRequests(
  report: ReadinessReport,
  coords: { platform: string; marketplace: string },
  ids?: { runId?: string; requestId?: string }
): CollectionRequest[] {
  const requests: CollectionRequest[] = [];
  const now = new Date().toISOString();

  for (const area of report.areas) {
    if (area.gaps.length === 0) continue;
    if (area.status === "ready") continue;

    const requiredEvidence = [...new Set(area.gaps.map((g) => g.field))];
    const priority =
      area.gaps.some((g) => g.severity === "critical")
        ? "critical"
        : area.gaps.some((g) => g.severity === "high")
          ? "high"
          : "medium";

    const completionRule: CollectionRequest["completionRule"] = {
      requiredFields: requiredEvidence
    };
    if (area.area === "customer_evidence") {
      completionRule.minimumReviews = 5;
      completionRule.minimumProducts = 2;
    }
    if (area.area === "market_structure" || area.area === "competitor_set") {
      completionRule.minimumProducts = 3;
      completionRule.minimumItems = 3;
    }
    if (area.area === "pricing") {
      completionRule.minimumProducts = 2;
      completionRule.requiredFields = [
        ...new Set([...(completionRule.requiredFields ?? []), "price", "currency", "format"])
      ];
    }
    completionRule.maximumAgeDays = 90;

    requests.push({
      collectionRequestId: newId(IdPrefix.collectionRequest),
      requestType: "supplemental_collection",
      status: "proposed",
      priority,
      platform: coords.platform,
      marketplace: coords.marketplace,
      targetSet: [],
      requiredEvidence,
      reason: `Evidence gaps for analysis area '${area.area}': ${area.gaps
        .map((g) => g.description)
        .join(" ")}`,
      analysisAreasBlocked: [area.area],
      completionRule,
      suggestedCollectorCapability: "mcec-amazon-listings-reviews",
      runId: ids?.runId,
      requestId: ids?.requestId,
      createdAt: now
    });
  }

  return requests;
}
