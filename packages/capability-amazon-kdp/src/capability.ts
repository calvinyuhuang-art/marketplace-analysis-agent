import type { AnalysisArea, CapabilitySummary } from "@maa/contracts";

export const CAPABILITY_ID = "amazon-kdp-adult-coloring-book";
export const CAPABILITY_VERSION = "0.1.0";

/**
 * First capability pack coordinates. These describe which marketplace niche
 * this pack knows how to analyze — they are not request defaults. Upstream
 * still supplies the concrete product, goal, and evidence.
 */
export const AMAZON_KDP_CAPABILITY: CapabilitySummary = {
  id: CAPABILITY_ID,
  version: CAPABILITY_VERSION,
  platform: "amazon",
  marketplace: "US",
  category: "books",
  productType: "adult_coloring_book",
  supportedOperations: [
    "full_marketplace_analysis",
    "focused_analysis_question",
    "revise_analysis",
    "comparative_analysis",
    "evaluate_evidence_readiness",
    "review_evidence_plan",
    "reassess_with_outcome"
  ],
  supportedAnalysisAreas: [
    "market_structure",
    "competitor_set",
    "customer_evidence",
    "pricing",
    "positioning",
    "keywords_categories",
    "format_product_expectations",
    "listing_conversion",
    "risk_ip_policy",
    "opportunity_summary",
    "evidence_sufficiency"
  ]
};

/** Maximum age in days before listing/review evidence is considered stale. */
export const DEFAULT_MAX_AGE_DAYS = 90;

export interface EvidenceRequirementDef {
  requirementId: string;
  description: string;
}

export interface AreaRequirementConfig {
  area: AnalysisArea;
  minimumListings?: number;
  minimumReviews?: number;
  minimumProductsWithReviews?: number;
  requiredListingFields?: string[];
  requireDirectCustomerText?: boolean;
  requireFormatOnPrice?: boolean;
  blockUnsegmentedMixedFormats?: boolean;
  maxAgeDays?: number;
  requirements: EvidenceRequirementDef[];
}

export const AREA_REQUIREMENTS: AreaRequirementConfig[] = [
  {
    area: "market_structure",
    minimumListings: 3,
    requiredListingFields: ["title", "subjectId"],
    maxAgeDays: DEFAULT_MAX_AGE_DAYS,
    requirements: [
      { requirementId: "min_listings", description: "At least 3 comparable listings" },
      { requirementId: "stable_subject_ids", description: "Listings have stable subject IDs" },
      { requirementId: "titles", description: "Listings include titles" }
    ]
  },
  {
    area: "competitor_set",
    minimumListings: 3,
    requiredListingFields: ["title", "subjectId"],
    maxAgeDays: DEFAULT_MAX_AGE_DAYS,
    requirements: [
      { requirementId: "min_competitors", description: "At least 3 competitor listings" }
    ]
  },
  {
    area: "customer_evidence",
    minimumReviews: 5,
    minimumProductsWithReviews: 2,
    requireDirectCustomerText: true,
    maxAgeDays: DEFAULT_MAX_AGE_DAYS,
    requirements: [
      {
        requirementId: "direct_review_text",
        description: "Direct review or Q&A text is present"
      },
      {
        requirementId: "multi_product_coverage",
        description: "Reviews cover at least 2 products"
      },
      {
        requirementId: "min_reviews",
        description: "At least 5 review/Q&A items"
      }
    ]
  },
  {
    area: "pricing",
    minimumListings: 2,
    requiredListingFields: ["price", "currency", "format"],
    requireFormatOnPrice: true,
    blockUnsegmentedMixedFormats: true,
    maxAgeDays: DEFAULT_MAX_AGE_DAYS,
    requirements: [
      { requirementId: "price_present", description: "Listings include current price" },
      { requirementId: "format_present", description: "Listings include format/binding" },
      {
        requirementId: "format_segmented",
        description: "Comparable prices share format or are explicitly segmented"
      }
    ]
  },
  {
    area: "positioning",
    minimumListings: 2,
    requiredListingFields: ["title", "positioningText"],
    maxAgeDays: DEFAULT_MAX_AGE_DAYS,
    requirements: [
      {
        requirementId: "positioning_text",
        description: "Listings include positioning/subtitle/description text"
      }
    ]
  },
  {
    area: "keywords_categories",
    minimumListings: 2,
    requiredListingFields: ["title"],
    maxAgeDays: DEFAULT_MAX_AGE_DAYS,
    requirements: [
      {
        requirementId: "title_phrases",
        description: "Title/subtitle phrases available for keyword analysis"
      }
    ]
  },
  {
    area: "format_product_expectations",
    minimumListings: 2,
    requiredListingFields: ["format", "pageCount"],
    maxAgeDays: DEFAULT_MAX_AGE_DAYS,
    requirements: [
      { requirementId: "format_fields", description: "Format and page count present" }
    ]
  },
  {
    area: "listing_conversion",
    minimumListings: 2,
    requiredListingFields: ["title", "positioningText"],
    maxAgeDays: DEFAULT_MAX_AGE_DAYS,
    requirements: [
      {
        requirementId: "listing_copy",
        description: "Listing copy available for conversion analysis"
      }
    ]
  },
  {
    area: "risk_ip_policy",
    maxAgeDays: DEFAULT_MAX_AGE_DAYS,
    requirements: [
      {
        requirementId: "risk_signals_or_policy",
        description: "Brand/trademark indicators or policy references present"
      }
    ]
  },
  {
    area: "opportunity_summary",
    minimumListings: 2,
    maxAgeDays: DEFAULT_MAX_AGE_DAYS,
    requirements: [
      {
        requirementId: "base_coverage",
        description: "Enough listing coverage to summarize opportunity"
      }
    ]
  },
  {
    area: "evidence_sufficiency",
    requirements: [
      {
        requirementId: "package_present",
        description: "At least one evidence package is available"
      }
    ]
  }
];
